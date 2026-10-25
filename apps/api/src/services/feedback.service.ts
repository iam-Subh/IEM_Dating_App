import { randomUUID } from 'crypto';
import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client } from '../middlewares/upload.middleware';
import { privateMediaBucket } from '../config/storage';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { logger } from '../utils/logger';
import { NotificationService } from './notification.service';
import { PrivateMediaInspectionService } from './private-media-inspection.service';
import { NudityService, verdictOf } from './nudity.service';

/**
 * Bug reports and the in-app rating (docs/FEEDBACK.md).
 *
 * A report is made in two steps so a slow upload never loses the words: the
 * report is saved first and answers with upload links for its files; the phone
 * uploads them, then confirms each (`completeAttachment`). Files live in the
 * private bucket, are seen only by staff, and are deleted 90 days after the
 * report or when it is closed.
 */
export const FEEDBACK_AREAS = ['chat', 'photos', 'matches', 'explore', 'stories', 'login', 'notifications', 'other'] as const;
export const REPORT_STATUSES = ['received', 'investigating', 'fixed', 'closed', 'duplicate'] as const;
export type ReportStatus = typeof REPORT_STATUSES[number];

/** Photos (the screenshot counts as one) and one screen recording. */
export const MAX_PHOTOS = 5;
export const MAX_VIDEOS = 1;
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
/** Spam limits, per person. */
export const REPORTS_PER_HOUR = 5;
export const REPORTS_PER_DAY = 20;
const FILE_DAYS = 90;
const STATUS_TEXT: Record<Exclude<ReportStatus, 'received'>, (reference: string, version?: string | null) => { title: string; body: string }> = {
  investigating: (reference) => ({ title: 'We are looking into your report', body: `Report ${reference}: our team is working on it.` }),
  fixed: (reference, version) => ({ title: 'Fixed - thank you', body: version ? `Report ${reference} is fixed in version ${version}. Update the app to get it.` : `Report ${reference} is fixed. Thanks for telling us.` }),
  closed: (reference) => ({ title: 'Your report is closed', body: `Report ${reference}: thanks for telling us.` }),
  duplicate: (reference) => ({ title: 'We already know about this', body: `Report ${reference} is the same as one we're working on. We'll tell you when it's fixed.` }),
};

export const referenceOf = (reference: number) => `#B-${reference}`;

type NewReport = {
  clientId: string; area: typeof FEEDBACK_AREAS[number]; description: string; source: 'form' | 'shake' | 'error' | 'rating';
  diagnostics?: Record<string, unknown> | null;
  attachments: { kind: 'photo' | 'video' }[];
};

function bucket() {
  const value = privateMediaBucket();
  if (!value) throw new HttpError(503, 'Reports with files are not available right now', 'FEEDBACK_STORAGE_UNAVAILABLE');
  return value;
}

async function uploadTicket(reportId: string, userId: string, kind: 'photo' | 'video') {
  const contentType = kind === 'photo' ? 'image/jpeg' : 'video/mp4';
  const key = `feedback/${userId}/${reportId}/${randomUUID()}.${kind === 'photo' ? 'jpg' : 'mp4'}`;
  const attachment = await prisma.bugReportAttachment.create({
    data: { reportId, kind, objectKey: key, contentType, maxBytes: kind === 'photo' ? PHOTO_MAX_BYTES : VIDEO_MAX_BYTES },
  });
  const uploadUrl = await getSignedUrl(s3Client, new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }), { expiresIn: 30 * 60 });
  return { attachmentId: attachment.id, kind, uploadUrl, contentType, maxBytes: attachment.maxBytes };
}

export class FeedbackService {
  static async createReport(userId: string, input: NewReport) {
    // A retry (no signal, the app closed) is the same report: its files get fresh links.
    const existing = await prisma.bugReport.findUnique({ where: { userId_clientId: { userId, clientId: input.clientId } }, include: { attachments: true } });
    if (existing) {
      const pending = existing.attachments.filter((item) => item.status === 'requested');
      const uploads = await Promise.all(pending.map(async (item) => ({
        attachmentId: item.id, kind: item.kind, contentType: item.contentType, maxBytes: item.maxBytes,
        uploadUrl: await getSignedUrl(s3Client, new PutObjectCommand({ Bucket: bucket(), Key: item.objectKey, ContentType: item.contentType }), { expiresIn: 30 * 60 }),
      })));
      return { id: existing.id, reference: referenceOf(existing.reference), uploads, repeated: true };
    }
    const photos = input.attachments.filter((item) => item.kind === 'photo').length;
    const videos = input.attachments.filter((item) => item.kind === 'video').length;
    if (photos > MAX_PHOTOS || videos > MAX_VIDEOS) {
      throw new HttpError(400, `Add up to ${MAX_PHOTOS} photos and ${MAX_VIDEOS} screen recording.`, 'FEEDBACK_TOO_MANY_FILES');
    }
    const now = Date.now();
    const [lastHour, lastDay] = await Promise.all([
      prisma.bugReport.count({ where: { userId, createdAt: { gte: new Date(now - 60 * 60_000) } } }),
      prisma.bugReport.count({ where: { userId, createdAt: { gte: new Date(now - 24 * 60 * 60_000) } } }),
    ]);
    if (lastHour >= REPORTS_PER_HOUR || lastDay >= REPORTS_PER_DAY) {
      throw new HttpError(429, "You've sent a lot of reports today. Try again later, or write to us by email.", 'FEEDBACK_RATE_LIMITED');
    }
    if (input.attachments.length) bucket();
    const report = await prisma.bugReport.create({
      data: {
        userId, clientId: input.clientId, area: input.area, description: input.description.trim(), source: input.source,
        diagnostics: (input.diagnostics ?? undefined) as any,
      },
    });
    const uploads = [];
    for (const item of input.attachments) uploads.push(await uploadTicket(report.id, userId, item.kind));
    return { id: report.id, reference: referenceOf(report.reference), uploads, repeated: false };
  }

  /** The phone uploaded a file: check it is what was promised, and look at it for nudity. */
  static async completeAttachment(userId: string, reportId: string, attachmentId: string) {
    const attachment = await prisma.bugReportAttachment.findFirst({ where: { id: attachmentId, reportId, report: { userId } } });
    if (!attachment) throw new HttpError(404, 'This file is not part of your report', 'FEEDBACK_FILE_NOT_FOUND');
    if (attachment.status !== 'requested') return { status: attachment.status };
    const files = bucket();
    let size = 0;
    try { size = Number((await s3Client.send(new HeadObjectCommand({ Bucket: files, Key: attachment.objectKey }))).ContentLength ?? 0); }
    catch { throw new HttpError(400, 'The file did not arrive. Try again.', 'FEEDBACK_FILE_MISSING'); }
    const detected = await PrivateMediaInspectionService.detect(files, attachment.objectKey).catch(() => null);
    const expected = attachment.kind === 'photo' ? detected?.startsWith('image/') : detected === 'video/mp4';
    if (!size || size > attachment.maxBytes || !expected) {
      await prisma.bugReportAttachment.update({ where: { id: attachment.id }, data: { status: 'rejected', sizeBytes: size || null } });
      await this.deleteObjects([attachment.objectKey]);
      throw new HttpError(400, attachment.kind === 'video' ? 'Screen recordings can be up to 50 MB.' : 'Photos can be up to 10 MB.', 'FEEDBACK_FILE_INVALID');
    }
    const score = await NudityService.scoreObject(files, attachment.objectKey, attachment.kind === 'photo' ? 'image/jpeg' : 'video/mp4');
    await prisma.bugReportAttachment.update({
      where: { id: attachment.id },
      data: { status: 'ready', sizeBytes: size, nudityScore: score, sensitive: verdictOf(score) === 'review' || verdictOf(score) === 'block' },
    });
    return { status: 'ready' };
  }

  static async myReports(userId: string) {
    const rows = await prisma.bugReport.findMany({
      where: { userId }, orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, reference: true, area: true, description: true, status: true, fixedInVersion: true, createdAt: true, updatedAt: true, _count: { select: { attachments: true } } },
    });
    return rows.map(({ _count, reference, ...row }) => ({ ...row, reference: referenceOf(reference), files: _count.attachments }));
  }

  static async rate(userId: string, input: { score: number; comment?: string | null; appVersion?: string | null }) {
    // One a day is plenty: a second tap replaces the first.
    const recent = await prisma.appRating.findFirst({ where: { userId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) } }, orderBy: { createdAt: 'desc' } });
    const data = { score: input.score, comment: input.comment?.trim() || null, appVersion: input.appVersion ?? null };
    return recent ? prisma.appRating.update({ where: { id: recent.id }, data }) : prisma.appRating.create({ data: { userId, ...data } });
  }

  // ── Staff ───────────────────────────────────────────────────────────

  static async list(filter: { status?: string; area?: string }) {
    const rows = await prisma.bugReport.findMany({
      where: {
        ...(filter.status === 'open' ? { status: { in: ['received', 'investigating'] } } : filter.status ? { status: filter.status } : {}),
        ...(filter.area ? { area: filter.area } : {}),
      },
      orderBy: { createdAt: 'desc' }, take: 200,
      include: { attachments: { where: { status: 'ready' }, select: { id: true } } },
    });
    const people = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.userId))] } }, select: { id: true, name: true } });
    return rows.map(({ attachments, reference, ...row }) => ({
      ...row, reference: referenceOf(reference), files: attachments.length,
      user: people.find((person) => person.id === row.userId) ?? null,
    }));
  }

  static async detail(id: string) {
    const report = await prisma.bugReport.findUnique({ where: { id }, include: { attachments: { where: { status: 'ready' }, orderBy: { createdAt: 'asc' } } } });
    if (!report) throw new HttpError(404, 'Report not found', 'FEEDBACK_NOT_FOUND');
    const [user, earlier, duplicateOf] = await Promise.all([
      prisma.user.findUnique({ where: { id: report.userId }, select: { id: true, name: true, email: true } }),
      prisma.bugReport.count({ where: { userId: report.userId, id: { not: report.id } } }),
      report.duplicateOf ? prisma.bugReport.findUnique({ where: { id: report.duplicateOf }, select: { reference: true } }) : null,
    ]);
    const files = privateMediaBucket();
    const attachments = await Promise.all(report.attachments.map(async (item) => ({
      id: item.id, kind: item.kind, sizeBytes: item.sizeBytes, sensitive: item.sensitive,
      url: files ? await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: files, Key: item.objectKey }), { expiresIn: 600 }).catch(() => null) : null,
    })));
    return {
      ...report, reference: referenceOf(report.reference), attachments, user, earlierReports: earlier,
      duplicateOfReference: duplicateOf ? referenceOf(duplicateOf.reference) : null,
    };
  }

  /** A new status, told to the person. Closing (or a duplicate) deletes the files. */
  static async setStatus(id: string, input: { status: Exclude<ReportStatus, 'received'>; fixedInVersion?: string | null; note?: string | null; duplicateOf?: string | null }) {
    const report = await prisma.bugReport.findUnique({ where: { id } });
    if (!report) throw new HttpError(404, 'Report not found', 'FEEDBACK_NOT_FOUND');
    let duplicateOf: string | null = null;
    if (input.status === 'duplicate') {
      const match = (input.duplicateOf ?? '').match(/(\d+)/);
      const original = match ? await prisma.bugReport.findUnique({ where: { reference: Number(match[1]) } }) : null;
      if (!original || original.id === report.id) throw new HttpError(400, 'Give the reference of the report this repeats, like #B-1001', 'FEEDBACK_DUPLICATE_UNKNOWN');
      duplicateOf = original.id;
    }
    const finished = input.status === 'closed' || input.status === 'duplicate' || input.status === 'fixed';
    const updated = await prisma.bugReport.update({
      where: { id },
      data: {
        status: input.status, staffNote: input.note?.trim() || report.staffNote,
        fixedInVersion: input.status === 'fixed' ? (input.fixedInVersion?.trim() || null) : report.fixedInVersion,
        duplicateOf, closedAt: finished ? new Date() : null,
      },
    });
    if (input.status === 'closed' || input.status === 'duplicate') await this.purgeFiles(report.id);
    const text = STATUS_TEXT[input.status](referenceOf(report.reference), updated.fixedInVersion);
    await NotificationService.sendSystemNotification(report.userId, text.title, input.note?.trim() ? `${text.body} ${input.note.trim()}` : text.body);
    return { status: updated.status };
  }

  static async ratings() {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60_000);
    const rows = await prisma.appRating.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 500 });
    const people = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.userId))] } }, select: { id: true, name: true } });
    const counts = [1, 2, 3, 4, 5].map((score) => rows.filter((row) => row.score === score).length);
    // Weeks, oldest first: the average and how many answered.
    const weeks = Array.from({ length: 12 }, (_, index) => {
      const start = new Date(Date.now() - (12 - index) * 7 * 24 * 60 * 60_000);
      const end = new Date(start.getTime() + 7 * 24 * 60 * 60_000);
      const inWeek = rows.filter((row) => row.createdAt >= start && row.createdAt < end);
      return { start, count: inWeek.length, average: inWeek.length ? inWeek.reduce((sum, row) => sum + row.score, 0) / inWeek.length : null };
    });
    return {
      count: rows.length,
      average: rows.length ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : null,
      counts, weeks,
      comments: rows.filter((row) => row.comment).slice(0, 100).map((row) => ({
        id: row.id, score: row.score, comment: row.comment, appVersion: row.appVersion, createdAt: row.createdAt,
        user: people.find((person) => person.id === row.userId) ?? null,
      })),
    };
  }

  // ── Retention ───────────────────────────────────────────────────────

  private static async deleteObjects(keys: string[]) {
    const files = privateMediaBucket();
    if (!files || !keys.length) return;
    for (let start = 0; start < keys.length; start += 1000) {
      await s3Client.send(new DeleteObjectsCommand({ Bucket: files, Delete: { Objects: keys.slice(start, start + 1000).map((Key) => ({ Key })), Quiet: true } }))
        .catch((error: Error) => logger.warn(`[FEEDBACK] files not deleted: ${error.message}`));
    }
  }

  private static async purgeFiles(reportId: string) {
    const items = await prisma.bugReportAttachment.findMany({ where: { reportId, status: { not: 'purged' } }, select: { id: true, objectKey: true } });
    await this.deleteObjects(items.map((item) => item.objectKey));
    await prisma.bugReportAttachment.updateMany({ where: { id: { in: items.map((item) => item.id) } }, data: { status: 'purged' } });
  }

  /** Hourly: files older than 90 days, and uploads never finished within a day. */
  static async purgeOldFiles(now = new Date()) {
    const items = await prisma.bugReportAttachment.findMany({
      where: {
        OR: [
          { status: { in: ['ready', 'rejected'] }, createdAt: { lt: new Date(now.getTime() - FILE_DAYS * 24 * 60 * 60_000) } },
          { status: 'requested', createdAt: { lt: new Date(now.getTime() - 24 * 60 * 60_000) } },
        ],
      },
      select: { id: true, objectKey: true }, take: 500,
    });
    if (!items.length) return 0;
    await this.deleteObjects(items.map((item) => item.objectKey));
    await prisma.bugReportAttachment.updateMany({ where: { id: { in: items.map((item) => item.id) } }, data: { status: 'purged' } });
    logger.info(`[FEEDBACK] deleted ${items.length} old report files`);
    return items.length;
  }
}
