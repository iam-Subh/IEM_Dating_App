/**
 * Adds renditions to profile media uploaded before renditions existed.
 *
 *   npx tsx scripts/backfill-profile-media.ts --dry-run
 *   npx tsx scripts/backfill-profile-media.ts
 *
 * Additive: writes card and thumbnail photos, and video posters and playback
 * files, next to the originals and records their URLs. Originals are left as
 * they are unless --sanitize-originals is passed, which re-encodes each
 * original photo in place without metadata (not reversible).
 */
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import {
  objectKeyFromUrl,
  ProfileMediaProcessingService,
  s3ObjectUrl,
} from '../src/services/profile-media-processing.service';

const dryRun = process.argv.includes('--dry-run');
const sanitizeOriginals = process.argv.includes('--sanitize-originals');

/**
 * The object a stored URL points at, if it is one this script may read.
 *
 * Current uploads live under `profiles/<userId>/`; accounts from before that
 * layout point at top-level `photos/` and `videos/`. Web test sessions also
 * saved `blob:` page URLs that never reached storage, which are skipped.
 */
function readableKey(url: string, userId: string, folder: 'photos' | 'videos'): { key: string } | { skip: string } {
  if (url.includes('blob:')) return { skip: 'a browser blob URL that was never uploaded' };
  const key = objectKeyFromUrl(url);
  if (!key) return { skip: 'not a URL' };
  if (key.startsWith(`profiles/${userId}/`) || key.startsWith(`${folder}/`)) return { key };
  return { skip: 'outside profile media storage' };
}

async function main() {
  const photos = await prisma.profilePhoto.findMany({
    where: { cardUrl: null },
    select: { id: true, userId: true, photoUrl: true },
  });
  const users = await prisma.user.findMany({
    where: { profileVideoUrl: { not: null }, videoPlaybackUrl: null },
    select: { id: true, profileVideoUrl: true },
  });
  console.log(`photos without renditions: ${photos.length}; videos without playback: ${users.length}`);
  if (dryRun) return;

  const done = new Map<string, { cardUrl: string; thumbUrl: string }>();
  for (const photo of photos) {
    const target = readableKey(photo.photoUrl, photo.userId, 'photos');
    if ('skip' in target) {
      console.warn(`skip photo ${photo.id}: ${target.skip}`);
      continue;
    }
    const { key } = target;
    try {
      let urls = done.get(key);
      if (!urls) {
        const result = await ProfileMediaProcessingService.processPhoto(key, { rewriteOriginal: sanitizeOriginals });
        urls = { cardUrl: s3ObjectUrl(result.cardObjectKey), thumbUrl: s3ObjectUrl(result.thumbObjectKey) };
        done.set(key, urls);
      }
      await prisma.profilePhoto.update({ where: { id: photo.id }, data: urls });
      console.log(`photo ${photo.id}: ok`);
    } catch (error) {
      console.warn(`photo ${photo.id}: failed - ${(error as Error).message}`);
    }
  }

  for (const user of users) {
    const target = readableKey(user.profileVideoUrl!, user.id, 'videos');
    if ('skip' in target) {
      console.warn(`skip video for ${user.id}: ${target.skip}`);
      continue;
    }
    const { key } = target;
    try {
      const result = await ProfileMediaProcessingService.processVideo(key);
      await prisma.user.update({
        where: { id: user.id },
        data: { videoPosterUrl: s3ObjectUrl(result.posterObjectKey), videoPlaybackUrl: s3ObjectUrl(result.playbackObjectKey) },
      });
      console.log(`video for ${user.id}: ok`);
    } catch (error) {
      console.warn(`video for ${user.id}: failed - ${(error as Error).message}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await redisClient.quit().catch(() => undefined);
  });
