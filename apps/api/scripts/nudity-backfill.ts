/**
 * One-time nudity check of profile photos and videos already up
 * (docs/NUDITY_CHECK.md). Nothing is taken down: anything borderline or
 * explicit goes to the admin panel's Flagged media queue for the team.
 *
 *   npx tsx scripts/nudity-backfill.ts          # report only
 *   npx tsx scripts/nudity-backfill.ts --write  # queue the flagged ones
 */
import 'dotenv/config';
import { prisma } from '../src/utils/prisma';
import { publicMediaBucket } from '../src/config/storage';
import { objectKeyFromUrl } from '../src/services/profile-media-processing.service';
import { NudityService, verdictOf } from '../src/services/nudity.service';

const write = process.argv.includes('--write');

(async () => {
  const bucket = publicMediaBucket();
  if (!bucket) throw new Error('No public media bucket configured');
  const photos = await prisma.profilePhoto.findMany({ select: { userId: true, photoUrl: true } });
  const videos = await prisma.user.findMany({ where: { profileVideoUrl: { not: null } }, select: { id: true, profileVideoUrl: true } });
  const items = [
    ...photos.map((photo) => ({ userId: photo.userId, url: photo.photoUrl, kind: 'profile_photo' as const })),
    ...videos.map((user) => ({ userId: user.id, url: user.profileVideoUrl!, kind: 'profile_video' as const })),
  ];
  const tally = { clear: 0, review: 0, block: 0, unchecked: 0, skipped: 0 };
  for (const item of items) {
    const already = await prisma.mediaModeration.findFirst({ where: { userId: item.userId, mediaUrl: item.url } });
    const key = objectKeyFromUrl(item.url);
    if (already || !key) { tally.skipped++; continue; }
    const score = await NudityService.scoreObject(bucket, key, item.kind === 'profile_video' ? 'video/mp4' : 'image/jpeg');
    const verdict = verdictOf(score);
    tally[verdict]++;
    console.log(`${verdict.padEnd(9)} ${score ?? '-'}  ${item.kind}  ${item.url.slice(-60)}`);
    if (write && (verdict === 'review' || verdict === 'block')) {
      await prisma.mediaModeration.create({ data: { userId: item.userId, kind: item.kind, objectKey: key, mediaUrl: item.url, score, status: 'pending', note: 'Found by the backfill' } });
    }
  }
  console.log(`\n${items.length} checked:`, JSON.stringify(tally), write ? '(flagged ones queued)' : '(report only; --write to queue)');
  await prisma.$disconnect();
})().catch((error) => { console.error(error); process.exit(1); });
