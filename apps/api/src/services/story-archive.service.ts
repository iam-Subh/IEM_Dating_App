import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client } from '../middlewares/upload.middleware';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { privateMediaBucket } from '../config/storage';

const PAGE_SIZE = 60;
// Long enough to browse a page of the grid without a still going stale.
const STILL_URL_SECONDS = 15 * 60;
// The app's audience is one Indian college; every date shown to a person
// (the calendar, "On this day") is bucketed by their own clock, not UTC.
const IST_OFFSET_MS = 5.5 * 60 * 60_000;

function istDateKey(at: Date): string {
  const shifted = new Date(at.getTime() + IST_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

type ArchiveCursor = { publishedAt: string; id: string };

function decodeCursor(cursor: string): ArchiveCursor {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!decoded?.publishedAt || !decoded?.id) throw new Error('missing fields');
    if (Number.isNaN(new Date(decoded.publishedAt).getTime())) throw new Error('bad date');
    return decoded;
  } catch {
    throw new HttpError(400, 'Archive cursor is invalid', 'INVALID_ARCHIVE_CURSOR');
  }
}

/**
 * The owner's private Archive (Part 3, `STORY_ARCHIVE_SPEC.md`): Stories that
 * have ended, were posted with "Save story to archive" on, and were not
 * deleted. This is never shown to anyone but the owner - see
 * `StoryVisibilityService.canSeeEnded`, which every other Story route relies
 * on to keep an ended Story private once it leaves the tray.
 */
export class StoryArchiveService {
  private static get bucket() {
    const value = privateMediaBucket();
    if (!value) throw new Error('AWS_PRIVATE_MEDIA_BUCKET is required for Stories');
    return value;
  }

  /**
   * The grid: ended, archived stories, newest first. With `date` (YYYY-MM-DD,
   * the owner's clock), only that day - what tapping a day in the calendar
   * asks for, since posting time is bucketed in IST but stored in UTC and so
   * cannot be filtered directly in the query.
   */
  static async list(ownerId: string, cursor?: string, limit = PAGE_SIZE, date?: string) {
    const take = Math.min(Math.max(limit, 1), 100);
    const decoded = cursor ? decodeCursor(cursor) : null;
    const cursorPublishedAt = decoded ? new Date(decoded.publishedAt) : null;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'date must be YYYY-MM-DD', 'INVALID_ARCHIVE_DATE');
    // A day in IST spans two UTC calendar days either side; fetch that window
    // and narrow to the exact day below, in the owner's own timezone.
    const dayWindow = date ? { gte: new Date(`${date}T00:00:00.000Z`).getTime() - IST_OFFSET_MS - 24 * 60 * 60_000, lt: new Date(`${date}T00:00:00.000Z`).getTime() - IST_OFFSET_MS + 48 * 60 * 60_000 } : null;
    const stories = await prisma.story.findMany({
      where: {
        ownerId, state: 'published', deletedAt: null, archive: true,
        expiresAt: { lte: new Date() },
        ...(dayWindow ? { publishedAt: { gte: new Date(dayWindow.gte), lt: new Date(dayWindow.lt) } } : {}),
        ...(cursorPublishedAt && decoded
          ? { OR: [{ publishedAt: { lt: cursorPublishedAt } }, { publishedAt: cursorPublishedAt, id: { lt: decoded.id } }] }
          : {}),
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: date ? 200 : take + 1,
    }).then((rows) => (date ? rows.filter((row) => istDateKey(row.publishedAt) === date) : rows));
    // A single day's stories fit on one screen; no cursor needed for it.
    const hasMore = !date && stories.length > take;
    const page = date ? stories : (hasMore ? stories.slice(0, take) : stories);
    const items = await this.withStills(page);
    const last = page[page.length - 1];
    return {
      items,
      nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ publishedAt: last.publishedAt.toISOString(), id: last.id })).toString('base64url') : null,
    };
  }

  /** Days in the given month (YYYY-MM, the owner's clock) that have archived stories. */
  static async calendar(ownerId: string, month: string) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'Month must be YYYY-MM', 'INVALID_ARCHIVE_MONTH');
    // A generous UTC window around the requested month; exact bucketing happens
    // below, in the owner's own timezone, so a story near midnight lands right.
    const start = new Date(`${month}-01T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) throw new HttpError(400, 'Month must be YYYY-MM', 'INVALID_ARCHIVE_MONTH');
    const rangeStart = new Date(start.getTime() - 24 * 60 * 60_000);
    const rangeEnd = new Date(start.getTime() + 32 * 24 * 60 * 60_000);
    const stories = await prisma.story.findMany({
      where: { ownerId, state: 'published', deletedAt: null, archive: true, expiresAt: { lte: new Date() }, publishedAt: { gte: rangeStart, lt: rangeEnd } },
      select: { publishedAt: true },
    });
    const counts = new Map<string, number>();
    for (const story of stories) {
      const key = istDateKey(story.publishedAt);
      if (!key.startsWith(month)) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return { days: [...counts.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)) };
  }

  /** Archived stories first posted on today's date in an earlier year. No push, no tray badge - just this list. */
  static async memories(ownerId: string) {
    const todayKey = istDateKey(new Date()).slice(5); // "MM-DD"
    // A story can only be a memory once it is at least a year old; bound the
    // scan generously rather than filtering every archived story ever posted.
    const before = new Date(Date.now() - 350 * 24 * 60 * 60_000);
    const stories = await prisma.story.findMany({
      where: { ownerId, state: 'published', deletedAt: null, archive: true, expiresAt: { lte: new Date() }, publishedAt: { lt: before } },
      orderBy: [{ publishedAt: 'desc' }],
      take: 500,
    });
    const matches = stories.filter((story) => istDateKey(story.publishedAt).slice(5) === todayKey);
    const items = await this.withStills(matches);
    return { items };
  }

  /** Signed still-image URLs for a page of stories, from their attached asset's thumbnail (or the photo itself). */
  private static async withStills<T extends { id: string; assetId: string; audience: string; publishedAt: Date; composition: unknown }>(stories: T[]) {
    if (!stories.length) return [];
    const assets = await prisma.storyMediaAsset.findMany({
      where: { id: { in: stories.map((story) => story.assetId) }, status: 'attached' },
      select: { id: true, objectKey: true, thumbnailObjectKey: true, contentType: true },
    });
    const assetOf = new Map(assets.map((asset) => [asset.id, asset]));
    return Promise.all(stories.map(async (story) => {
      const asset = assetOf.get(story.assetId);
      const key = asset?.thumbnailObjectKey ?? (asset?.contentType.startsWith('image/') ? asset.objectKey : null);
      const stillUrl = key ? await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: STILL_URL_SECONDS }).catch(() => null) : null;
      return {
        id: story.id,
        stillUrl,
        contentType: asset?.contentType ?? null,
        publishedAt: story.publishedAt.toISOString(),
        audience: story.audience === 'close_friends' ? 'close_friends' as const : 'followers' as const,
      };
    }));
  }
}
