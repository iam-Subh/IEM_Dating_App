import { randomUUID } from 'crypto';
import { announceOwnProfile } from './verification-live';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { logger } from '../utils/logger';
import { s3Client } from '../middlewares/upload.middleware';
import { privateMediaBucket } from '../config/storage';
import { ageAt } from './eligibility.service';

/**
 * A birthday change after the one allowed in the app
 * (apps/mobile/src/features/auth/GOOGLE_SIGNUP_PLAN.md 6.2): asked through
 * support with a photo of an ID. The photo lives in the private bucket, is
 * readable only by an admin through a short-lived link, and is deleted as
 * soon as the request is decided.
 */

const ID_PREFIX = 'id-documents/';

function bucket() {
  const name = privateMediaBucket();
  if (!name) throw new HttpError(503, 'ID uploads are not set up yet', 'ID_UPLOAD_UNAVAILABLE');
  return name;
}

function adultBirthday(value: string) {
  const birthday = new Date(value);
  const age = ageAt(birthday);
  if (age === null || age < 18 || age > 120) throw new HttpError(400, 'A valid adult birthday is required', 'BIRTHDAY_INVALID');
  return { birthday, age };
}

export class BirthdayChangeService {
  /** Where the app uploads the ID photo: a key of this person's own, valid for five minutes. */
  static async uploadUrl(userId: string) {
    const key = `${ID_PREFIX}${userId}/${randomUUID()}.jpg`;
    const uploadUrl = await getSignedUrl(s3Client, new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: 'image/jpeg' }), { expiresIn: 300 });
    return { uploadUrl, idObjectKey: key, contentType: 'image/jpeg' };
  }

  static async create(userId: string, newBirthday: string, idObjectKey: string) {
    adultBirthday(newBirthday);
    if (!idObjectKey.startsWith(`${ID_PREFIX}${userId}/`)) throw new HttpError(400, 'Upload a photo of your ID first', 'ID_PHOTO_REQUIRED');
    const pending = await prisma.birthdayChangeRequest.findFirst({ where: { userId, status: 'pending' }, select: { id: true } });
    if (pending) throw new HttpError(409, 'Your earlier request is still being reviewed.', 'BIRTHDAY_REQUEST_PENDING');
    return prisma.birthdayChangeRequest.create({
      data: { userId, newBirthday: new Date(newBirthday), idObjectKey },
      select: { id: true, status: true, createdAt: true },
    });
  }

  static async mine(userId: string) {
    return prisma.birthdayChangeRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, newBirthday: true, createdAt: true, decidedAt: true, note: true },
    });
  }

  /** Admin: pending requests, oldest first, each with a five-minute link to the ID photo. */
  static async pending() {
    const rows = await prisma.birthdayChangeRequest.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, take: 50 });
    const users = await prisma.user.findMany({
      where: { id: { in: rows.map((row) => row.userId) } },
      select: { id: true, name: true, birthday: true },
    });
    return Promise.all(rows.map(async (row) => ({
      id: row.id,
      user: users.find((user) => user.id === row.userId) ?? null,
      newBirthday: row.newBirthday,
      createdAt: row.createdAt,
      idPhotoUrl: row.idObjectKey
        ? await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: bucket(), Key: row.idObjectKey }), { expiresIn: 300 })
        : null,
    })));
  }

  /** Admin: approve or refuse. Either way the ID photo is deleted. */
  static async decide(adminId: string, requestId: string, approve: boolean, note?: string) {
    const request = await prisma.birthdayChangeRequest.findUnique({ where: { id: requestId } });
    if (!request || request.status !== 'pending') throw new HttpError(404, 'Request is unavailable', 'BIRTHDAY_REQUEST_UNAVAILABLE');
    await prisma.$transaction(async (tx) => {
      if (approve) {
        const { birthday, age } = adultBirthday(request.newBirthday.toISOString());
        await tx.user.update({
          where: { id: request.userId },
          data: { birthday, age, birthdayChangedAt: new Date(), eligibilityVersion: { increment: 1 } },
        });
      }
      await tx.birthdayChangeRequest.update({
        where: { id: requestId },
        data: { status: approve ? 'approved' : 'rejected', decidedAt: new Date(), decidedBy: adminId, note: note?.slice(0, 300) ?? null, idObjectKey: null },
      });
      await tx.notification.create({
        data: {
          userId: request.userId, type: 'system',
          title: approve ? 'Your birthday was updated' : "We couldn't change your birthday",
          body: approve ? 'Thanks - your profile shows the new date.' : (note || "The ID didn't match the new date. Write to support if you think this is a mistake."),
        },
      });
    });
    if (request.idObjectKey) {
      await s3Client.send(new DeleteObjectCommand({ Bucket: bucket(), Key: request.idObjectKey }))
        .catch((error) => logger.warn(`[BIRTHDAY] ID photo not deleted: ${(error as Error).message}`));
    }
    if (approve) announceOwnProfile(request.userId);
    return { status: approve ? 'approved' : 'rejected' };
  }
}
