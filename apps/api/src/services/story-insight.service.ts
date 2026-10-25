import { prisma } from '../utils/prisma';
import { redisClient } from '../utils/redis';
import { HttpError } from '../utils/httpError';
import { StoryVisibilityService } from './story-visibility.service';

/**
 * Part 3, section 7-8 (`STORY_ARCHIVE_SPEC.md`): reach, views, navigation
 * (forward/back/next-story/exit taps) and interactions on a Story, visible
 * only to its owner. Nobody, including the owner, can see who produced any
 * of these numbers - they are plain totals, incremented by
 * `INSERT ... ON CONFLICT DO UPDATE`-style upserts, never a row per event.
 */

export type InsightEvent = { storyId: string; views?: number; forward?: number; back?: number; nextStory?: number; exited?: number };

const FIELDS = ['views', 'forward', 'back', 'nextStory', 'exited'] as const;
type Field = (typeof FIELDS)[number];

// Section 7.5: lifetime caps per viewer per Story, so a script cannot inflate
// or deflate anyone's numbers. A Story is only ever live for 24 hours, so
// there is no need for these to survive much beyond that.
const CAPS: Record<Field, number> = { views: 50, forward: 50, back: 50, nextStory: 10, exited: 10 };
const CAP_TTL_SECONDS = 26 * 60 * 60;
const BATCH_DEDUPE_TTL_SECONDS = 24 * 60 * 60;
const MAX_STORIES_PER_BATCH = 100;
const MAX_PER_EVENT = 1000; // A generous ceiling before the real per-story cap (<=50) applies.

// Clamps each field's increment to whatever room is left under its cap for
// this (viewer, story) pair, applies only that much, and returns how much of
// each was actually allowed - the amount the caller then adds to Postgres.
const CLAMP_SCRIPT = `
local key = KEYS[1]
local n = tonumber(ARGV[1])
local allowed = {}
for i = 1, n do
  local field = ARGV[1 + i]
  local requested = tonumber(ARGV[1 + n + i])
  local cap = tonumber(ARGV[1 + 2 * n + i])
  local current = tonumber(redis.call('HGET', key, field) or '0')
  local room = cap - current
  local take = requested
  if take > room then take = room end
  if take < 0 then take = 0 end
  if take > 0 then redis.call('HINCRBY', key, field, take) end
  allowed[i] = take
end
redis.call('EXPIRE', key, ${CAP_TTL_SECONDS})
return allowed
`;

export class StoryInsightService {
  /**
   * Records a viewer's batch of navigation events (section 7.4). Silently
   * drops anything for a Story the sender cannot currently see, an ended
   * Story, or their own Story (section 7.5) - the response is always 202
   * either way, so it reveals nothing about visibility.
   */
  static async recordEvents(viewerId: string, batchId: string, rawEvents: InsightEvent[]) {
    if (!batchId || !rawEvents.length) return;
    const claimed = await redisClient.set(`story:insight-batch:${batchId}`, '1', 'EX', BATCH_DEDUPE_TTL_SECONDS, 'NX');
    if (!claimed) return; // Already processed - most likely a retry after a timeout (section 7.4).

    const ids = [...new Set(rawEvents.map((event) => event.storyId))].slice(0, MAX_STORIES_PER_BATCH);
    const stories = ids.length ? await prisma.story.findMany({
      where: { id: { in: ids }, state: 'published', deletedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, ownerId: true, audience: true },
    }) : [];
    const candidates = stories.filter((story) => story.ownerId !== viewerId);
    if (!candidates.length) return;
    const visibility = await StoryVisibilityService.load(viewerId);
    const allowedStoryIds = new Set(candidates.filter((story) => StoryVisibilityService.canSee(visibility, story)).map((story) => story.id));
    if (!allowedStoryIds.size) return;

    for (const event of rawEvents) {
      if (!allowedStoryIds.has(event.storyId)) continue;
      const requested: Record<Field, number> = {
        views: clampCount(event.views), forward: clampCount(event.forward), back: clampCount(event.back),
        nextStory: clampCount(event.nextStory), exited: clampCount(event.exited),
      };
      if (!FIELDS.some((field) => requested[field] > 0)) continue;
      const capKey = `story:insight-caps:${viewerId}:${event.storyId}`;
      const args = [
        String(FIELDS.length), ...FIELDS, ...FIELDS.map((field) => String(requested[field])), ...FIELDS.map((field) => String(CAPS[field])),
      ];
      const allowed = (await redisClient.eval(CLAMP_SCRIPT, 1, capKey, ...args).catch(() => FIELDS.map(() => 0))) as number[];
      const [views, forward, back, nextStory, exited] = allowed.map((value) => Number(value) || 0);
      if (!views && !forward && !back && !nextStory && !exited) continue;
      await prisma.storyInsight.upsert({
        where: { storyId: event.storyId },
        create: { storyId: event.storyId, views, forwardTaps: forward, backTaps: back, nextStory, exits: exited },
        update: { views: { increment: views }, forwardTaps: { increment: forward }, backTaps: { increment: back }, nextStory: { increment: nextStory }, exits: { increment: exited } },
      }).catch(() => undefined);
    }
  }

  /** Every Insight metric for the owner (sections 7.2 and 7.8). */
  static async get(ownerId: string, storyId: string) {
    const story = await prisma.story.findFirst({ where: { id: storyId, ownerId } });
    if (!story) throw new HttpError(404, 'Story is unavailable', 'STORY_UNAVAILABLE');
    const insight = await prisma.storyInsight.findUnique({ where: { storyId } });
    // Before the 48-hour freeze (Phase C), reach/likes/sticker taps are read
    // live, same as the rest of the app; afterwards they come from the frozen
    // columns, since the source rows they were computed from are gone.
    const frozen = story.viewersClosedAt !== null;
    const [reach, likes, stickerTaps] = frozen
      ? [insight?.reach ?? 0, insight?.likes ?? 0, insight?.stickerTaps ?? 0]
      : await Promise.all([
        prisma.storyView.count({ where: { storyId } }),
        prisma.storyLike.count({ where: { storyId } }),
        this.liveStickerTaps(storyId),
      ]);
    return {
      reach,
      views: insight?.views ?? 0,
      forwardTaps: insight?.forwardTaps ?? 0,
      backTaps: insight?.backTaps ?? 0,
      nextStory: insight?.nextStory ?? 0,
      exits: insight?.exits ?? 0,
      replies: insight?.replies ?? 0,
      reactions: insight?.reactions ?? 0,
      likes,
      stickerTaps,
      // Not recorded until "tap the name to open the profile" exists (STORY_AUDIENCE_SPEC.md, section 17.3).
      profileVisits: insight?.profileVisits ?? 0,
      closed: frozen,
    };
  }

  private static async liveStickerTaps(storyId: string): Promise<number> {
    const [responses, questions, linkTaps] = await Promise.all([
      prisma.storyStickerResponse.count({ where: { storyId } }),
      prisma.storyQuestionReply.count({ where: { storyId } }),
      prisma.storyLinkTap.count({ where: { storyId } }),
    ]);
    return responses + questions + linkTaps;
  }
}

function clampCount(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(MAX_PER_EVENT, Math.floor(value));
}
