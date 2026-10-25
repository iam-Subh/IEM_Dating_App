import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { publicMediaBucket } from '../config/storage';
import { s3Client } from '../middlewares/upload.middleware';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { logger } from '../utils/logger';
import { NudityService, verdictOf, type NudityVerdict } from './nudity.service';

/**
 * The nudity check for profile photos and the profile video (docs/NUDITY_CHECK.md).
 *
 * - Explicit: refused at upload with a reason; counted towards a report case.
 * - Borderline: the upload goes through, but saving the profile keeps it off
 *   until the team approves it (heldMedia) - so nobody else sees it anywhere,
 *   without every screen that shows photos needing to know.
 * - Unchecked (the check was down): goes through, and is checked within the hour.
 */
export class ProfileNudity {
  static async check(userId: string, asset: { id: string; objectKey: string; contentType: string; purpose: string }, url: string): Promise<NudityVerdict> {
    const bucket = publicMediaBucket() || '';
    const score = await NudityService.scoreObject(bucket, asset.objectKey, asset.contentType);
    const verdict = verdictOf(score);
    const kind = asset.purpose === 'video' ? 'profile_video' : 'profile_photo';
    await prisma.profileMediaAsset.update({ where: { id: asset.id }, data: { nudityScore: score } });
    if (verdict === 'block') {
      // Not kept: no address, so there is nothing for anyone to open later.
      await prisma.mediaModeration.create({ data: { userId, kind, assetId: asset.id, score, status: 'blocked' } });
      await this.deleteRenditions(asset.id);
      void NudityService.recordStrike(userId).catch(() => undefined);
      throw new HttpError(422, kind === 'profile_video'
        ? "This video can't be used. Profile videos must follow our Community Guidelines."
        : "This photo can't be used. Profile photos must follow our Community Guidelines.", 'MEDIA_EXPLICIT');
    }
    if (verdict === 'review' || verdict === 'unchecked') {
      await prisma.mediaModeration.create({ data: { userId, kind, assetId: asset.id, objectKey: asset.objectKey, mediaUrl: url, score, status: verdict === 'review' ? 'pending' : 'unchecked' } });
    }
    return verdict;
  }

  /** Of these addresses, the ones waiting for the team: kept off the profile when it is saved. */
  static async heldMedia(userId: string, urls: string[]) {
    if (!urls.length) return new Set<string>();
    const rows = await prisma.mediaModeration.findMany({
      where: { userId, status: 'pending', kind: { in: ['profile_photo', 'profile_video'] }, mediaUrl: { in: urls } },
      select: { mediaUrl: true },
    });
    return new Set(rows.map((row) => row.mediaUrl!).filter(Boolean));
  }

  /**
   * What the owner sees in Edit profile: photos and a video they saved that
   * wait for the team. One picked but not saved yet shows on its own tile.
   */
  static async pendingFor(userId: string) {
    const rows = await prisma.mediaModeration.findMany({
      where: { userId, status: 'pending', kind: { in: ['profile_photo', 'profile_video'] } },
      select: { id: true, kind: true, mediaUrl: true, createdAt: true, assetId: true },
      orderBy: { createdAt: 'asc' },
    });
    const saved = new Set((await prisma.profileMediaAsset.findMany({
      where: { id: { in: rows.map((row) => row.assetId).filter((id): id is string => !!id) }, status: 'held' }, select: { id: true },
    })).map((asset) => asset.id));
    return rows.filter((row) => row.assetId && saved.has(row.assetId)).map(({ assetId: _assetId, ...row }) => row);
  }

  /** The owner changed their mind about a held photo or video. */
  static async withdraw(userId: string, id: string) {
    const row = await prisma.mediaModeration.findFirst({ where: { id, userId, status: 'pending' } });
    if (!row) throw new HttpError(404, 'Nothing to withdraw', 'MODERATION_NOT_FOUND');
    await prisma.mediaModeration.update({ where: { id }, data: { status: 'withdrawn', decidedAt: new Date() } });
    if (row.assetId) await this.deleteRenditions(row.assetId, true);
  }

  /** Removes a refused or withdrawn upload's files (the original and its sizes). */
  static async deleteRenditions(assetId: string, original = false) {
    const asset = await prisma.profileMediaAsset.findUnique({ where: { id: assetId } });
    if (!asset) return;
    const keys = [asset.cardObjectKey, asset.thumbObjectKey, asset.previewObjectKey, asset.posterObjectKey, asset.playbackObjectKey, ...(original ? [asset.objectKey] : [])]
      .filter((key): key is string => !!key);
    if (keys.length) {
      await s3Client.send(new DeleteObjectsCommand({ Bucket: publicMediaBucket() || '', Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }))
        .catch((error: Error) => logger.warn(`[NUDITY] files not deleted: ${(error as Error).message}`));
    }
    await prisma.profileMediaAsset.update({ where: { id: assetId }, data: { status: 'rejected' } }).catch(() => undefined);
  }
}
