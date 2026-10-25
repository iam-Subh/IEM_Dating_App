import { User } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { prisma } from '../utils/prisma';
import { redisClient } from '../utils/redis';
import { AlgorithmConfigService } from './algorithm-config.service';
import { discoveryProfileSelect, publicProfile } from './public-profile.service';

/**
 * The pieces Explore and Standouts both need: a day boundary in the reader's
 * own clock, a cache that can never hold a page up, and cards in the deck's
 * shape with an impression receipt attached.
 *
 * These live here rather than in either service because the two surfaces have
 * to agree on them - a Standouts pick and an Explore pick must expire at the
 * same midnight, and both must be countable by the same fairness metrics.
 */

/** The day in the reader's own clock (IST), so daily sets turn over at their midnight. */
export function istDay() {
  return new Date(Date.now() + 5.5 * 60 * 60_000).toISOString().slice(0, 10);
}

export function secondsLeftToday() {
  const shifted = new Date(Date.now() + 5.5 * 60 * 60_000);
  const midnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 1);
  return Math.max(60, Math.floor((midnight - shifted.getTime()) / 1000));
}

/**
 * A cache read that cannot hold the page up. ioredis queues commands while it
 * is offline, so a Redis outage would otherwise hang a browse surface rather
 * than degrade it - it should lose its cache, not its response.
 */
export async function cacheGet(key: string): Promise<string | null> {
  return Promise.race([
    redisClient.get(key).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
  ]);
}

/** Fire and forget, for the same reason: the page never waits on the cache. */
export function cacheSet(key: string, value: string, seconds: number) {
  void redisClient.set(key, value, 'EX', seconds).catch(() => undefined);
}

/**
 * Increments a counter and returns its new value, or null if Redis did not
 * answer in time. Callers must decide what an unknown count means for them;
 * there is no safe default here to pick on their behalf.
 */
export async function cacheIncr(key: string, seconds: number): Promise<number | null> {
  const bump = redisClient
    .multi()
    .incr(key)
    .expire(key, seconds)
    .exec()
    .then((replies) => {
      const value = replies?.[0]?.[1];
      return typeof value === 'number' ? value : null;
    })
    .catch(() => null);
  return Promise.race([bump, new Promise<null>((resolve) => setTimeout(() => resolve(null), 500))]);
}

/** A stable deck id per browse, so `(viewerId, deckId, sequence)` stays unique. */
export function deckIdFor(signature: string) {
  const hex = createHash('sha256').update(`explore-deck:${signature}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function sequenceFor(signature: string, candidateId: string) {
  // Stable per (browse, person), so a re-read of the same page reuses its receipt.
  return createHash('sha256').update(`${signature}:${candidateId}`).digest().readUInt32BE(0) % 2_000_000_000;
}

/**
 * Cards in the deck's own shape, in the order given, each with an impression
 * id so `/discover/visible` keeps working and the fairness metrics see these
 * surfaces alongside the deck.
 */
export async function buildCards(me: User, ids: string[], signature: string) {
  if (!ids.length) return [];
  const [viewer, profiles, config] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: me.id }, select: discoveryProfileSelect }),
    prisma.user.findMany({ where: { id: { in: ids } }, select: discoveryProfileSelect }),
    AlgorithmConfigService.get(),
  ]);
  const deckId = deckIdFor(signature);
  const ordered = ids.flatMap((id) => {
    const profile = profiles.find((entry) => entry.id === id);
    return profile ? [profile] : [];
  });
  await prisma.discoveryReceipt.createMany({
    data: ordered.map((profile) => ({
      id: randomUUID(),
      viewerId: me.id,
      candidateId: profile.id,
      deckId,
      sequence: sequenceFor(signature, profile.id),
      algorithm: 1,
    })),
    skipDuplicates: true,
  });
  const receipts = await prisma.discoveryReceipt.findMany({
    where: { viewerId: me.id, deckId, candidateId: { in: ordered.map((profile) => profile.id) } },
    select: { id: true, candidateId: true },
  });
  const receiptOf = new Map(receipts.map((receipt) => [receipt.candidateId, receipt.id]));
  const follows = await prisma.follow.findMany({
    where: {
      followerId: me.id,
      followeeId: { in: ordered.map((profile) => profile.id) },
      status: { in: ['pending', 'accepted'] },
    },
    select: { followeeId: true, status: true },
  });
  const followOf = new Map(follows.map((follow) => [follow.followeeId, follow.status]));
  return ordered.map((profile) => ({
    ...publicProfile(viewer, profile, config.weights),
    impressionId: receiptOf.get(profile.id) ?? null,
    followStatus: followOf.get(profile.id) ?? null,
  }));
}
