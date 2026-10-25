import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { prisma } from '../src/utils/prisma';
import { s3Client } from '../src/middlewares/upload.middleware';
import { privateMediaBucket } from '../src/config/storage';

async function main() {
  const now = new Date();
  const eventCutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const assetCutoff = new Date(Date.now() - 24 * 60 * 60_000);
  const bucket = privateMediaBucket();

  const expiredStories = await prisma.story.updateMany({
    where: { state: 'published', expiresAt: { lte: now } },
    data: { state: 'expired' },
  });
  const staleAssets = await prisma.storyMediaAsset.findMany({
    where: { status: { in: ['requested', 'processing', 'rejected'] }, expiresAt: { lte: assetCutoff } },
    take: 500,
  });
  const staleChatAssets = await prisma.chatMediaAsset.findMany({
    where: { status: { in: ['requested', 'processing', 'rejected'] }, expiresAt: { lte: assetCutoff } },
    take: 500,
  });
  if (bucket) {
    for (const asset of [...staleAssets, ...staleChatAssets]) {
      await Promise.all([
        s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: asset.objectKey })),
        ...('thumbnailObjectKey' in asset && asset.thumbnailObjectKey
          ? [s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: asset.thumbnailObjectKey }))]
          : []),
      ]).catch(() => undefined);
    }
  }
  const removedAssets = await prisma.storyMediaAsset.deleteMany({ where: { id: { in: staleAssets.map((item) => item.id) } } });
  const removedChatAssets = await prisma.chatMediaAsset.deleteMany({ where: { id: { in: staleChatAssets.map((item) => item.id) } } });
  const removedEvents = await prisma.chatEvent.deleteMany({ where: { createdAt: { lt: eventCutoff } } });
  const removedAccountEvents = await prisma.accountEvent.deleteMany({ where: { createdAt: { lt: eventCutoff } } });
  const removedDeviceCursors = await prisma.chatDeviceCursor.deleteMany({ where: { updatedAt: { lt: new Date(Date.now() - 90 * 24 * 60 * 60_000) } } });
  const removedDeliveryAttempts = await prisma.deliveryAttempt.deleteMany({ where: { updatedAt: { lt: eventCutoff }, status: { in: ['sent', 'failed'] } } });
  console.log(JSON.stringify({ expiredStories: expiredStories.count, removedAssets: removedAssets.count, removedChatAssets: removedChatAssets.count, removedEvents: removedEvents.count, removedAccountEvents: removedAccountEvents.count, removedDeviceCursors: removedDeviceCursors.count, removedDeliveryAttempts: removedDeliveryAttempts.count }));
}

main().finally(() => prisma.$disconnect());
