import { VerificationLimitsService } from './verification-limits.service';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { redisClient } from '../utils/redis';
import { HttpError } from '../utils/httpError';
import { logger } from '../utils/logger';
import { interactiveStickerSchema, type InteractiveSticker } from '../schemas/story-composition.schema';
import { PushService } from './push.service';
import { StoryService } from './story.service';
import { StoryVisibilityService, type StoryAudience } from './story-visibility.service';

type StickerRow = { id: string; storyId: string; stickerKey: string; type: string; config: Prisma.JsonValue; endsAt: Date | null };

/** Types a viewer acts on, and what each accepts. */
const RESPONSE_TYPES = new Set(['poll', 'quiz', 'slider']);

function configOf(row: StickerRow): InteractiveSticker | null {
  const parsed = interactiveStickerSchema.safeParse(row.config);
  return parsed.success ? parsed.data : null;
}

async function people(ids: string[]) {
  if (!ids.length) return new Map<string, { id: string; name: string; avatarUrl: string | null }>();
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, avatarUrl: true } });
  return new Map(users.map((user) => [user.id, user]));
}

/**
 * Interactive stickers on published Stories: poll votes, quiz answers, slider
 * ratings, question replies, countdown reminders, link taps and mentions.
 *
 * Answers are final, as on Instagram: a vote or rating cannot be changed.
 * Results appear to a viewer once they have answered, and to the owner always.
 */
export class StoryStickerService {
  /**
   * People you may mention on a Story with this audience. They must be able to
   * see it (followers and matches, minus blocks and your hidden list, and only
   * your Close Friends on a Close Friends Story), have an active account, and
   * allow your mentions: "everyone", or "following" when they follow you.
   */
  static async mentionableIds(ownerId: string, audience: StoryAudience = 'followers', candidateIds?: string[]) {
    const recipients = await StoryVisibilityService.recipientsFor(ownerId, audience);
    const ids = (candidateIds ?? [...recipients]).filter((id) => id !== ownerId && recipients.has(id));
    if (!ids.length) return new Set<string>();
    const [users, followsOwner] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: ids }, accountStatus: 'active' }, select: { id: true, storyMentions: true } }),
      prisma.follow.findMany({ where: { followeeId: ownerId, followerId: { in: ids }, status: 'accepted' }, select: { followerId: true } }),
    ]);
    const followers = new Set(followsOwner.map((row) => row.followerId));
    // Before verifying, only people they have matched with (GOOGLE_SIGNUP_PLAN.md 2.7).
    const matched = (await VerificationLimitsService.isLimited(ownerId)) ? await VerificationLimitsService.matchedIds(ownerId) : null;
    return new Set(users
      .filter((user) => !matched || matched.has(user.id))
      .filter((user) => user.storyMentions === 'everyone' || (user.storyMentions === 'following' && followers.has(user.id)))
      .map((user) => user.id));
  }

  static async assertMentionable(ownerId: string, userIds: string[], audience: StoryAudience = 'followers') {
    const unique = [...new Set(userIds)];
    if (!unique.length) return;
    const allowed = await this.mentionableIds(ownerId, audience, unique);
    if (unique.some((id) => !allowed.has(id)) && (await VerificationLimitsService.isLimited(ownerId))) {
      const matched = await VerificationLimitsService.matchedIds(ownerId);
      if (unique.some((id) => !matched.has(id))) {
        throw new HttpError(403, 'Verify your college to mention people you have not matched with.', 'MENTION_VERIFY_REQUIRED');
      }
    }
    if (unique.some((id) => !allowed.has(id))) {
      throw new HttpError(422, 'You can only mention people who can see this story and allow mentions', 'STORY_MENTION_NOT_ALLOWED');
    }
  }

  static async searchMentions(ownerId: string, query: string, audience: StoryAudience = 'followers') {
    const ids = [...await this.mentionableIds(ownerId, audience)];
    if (!ids.length) return { people: [] };
    const q = query.trim();
    const users = await prisma.user.findMany({
      where: { id: { in: ids }, accountStatus: 'active', ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
      select: { id: true, name: true, avatarUrl: true },
      orderBy: { name: 'asc' },
      take: 20,
    });
    return { people: users };
  }

  /**
   * The card shown when a mention sticker is tapped: who it is, and the match
   * to open if there is one. Hidden when either person has blocked the other.
   */
  static async person(viewerId: string, userId: string, storyId?: string) {
    const [user, blocked, match] = await Promise.all([
      prisma.user.findFirst({ where: { id: userId, accountStatus: 'active' }, select: { id: true, name: true, avatarUrl: true } }),
      prisma.userBlock.count({ where: { OR: [{ blockerId: viewerId, blockedId: userId }, { blockerId: userId, blockedId: viewerId }] } }),
      prisma.match.findFirst({
        where: { status: 'active', OR: [{ user1Id: viewerId, user2Id: userId }, { user1Id: userId, user2Id: viewerId }] },
        select: { id: true },
      }),
    ]);
    if (!user || blocked) throw new HttpError(404, 'This person is unavailable', 'PERSON_UNAVAILABLE');
    // "Add to your story" on a mention of you: never on a Close Friends Story,
    // and only when its owner allows resharing.
    let canReshare = false;
    if (storyId && userId === viewerId) {
      const story = await StoryService.requireVisibleStory(viewerId, storyId).catch(() => null);
      if (story && story.ownerId !== viewerId && story.audience !== 'close_friends') {
        const [owner, mention] = await Promise.all([
          prisma.user.findUnique({ where: { id: story.ownerId }, select: { storyResharing: true } }),
          prisma.storyMention.findFirst({ where: { storyId, mentionedUserId: viewerId }, select: { id: true } }),
        ]);
        canReshare = !!owner?.storyResharing && !!mention;
      }
    }
    return { ...user, isYou: userId === viewerId, matchId: match?.id ?? null, canReshare };
  }

  private static async stickerFor(viewerId: string, storyId: string, stickerId: string) {
    const story = await StoryService.requireVisibleStory(viewerId, storyId);
    const row = await prisma.storySticker.findFirst({ where: { id: stickerId, storyId } });
    const config = row ? configOf(row) : null;
    if (!row || !config) throw new HttpError(404, 'Sticker is unavailable', 'STICKER_UNAVAILABLE');
    return { story, row, config };
  }

  /** Every interactive sticker on a Story with the viewer's own answer and the results they may see. */
  static async forStory(viewerId: string, storyId: string) {
    const story = await StoryService.requireVisibleStory(viewerId, storyId);
    const isOwner = story.ownerId === viewerId;
    const rows = await prisma.storySticker.findMany({ where: { storyId }, orderBy: { createdAt: 'asc' } });
    const ids = rows.map((row) => row.id);
    const threadIds = rows.flatMap((row) => {
      const config = configOf(row);
      return config?.type === 'addYours' && config.threadId ? [config.threadId] : [];
    });
    const [responses, subscriptions, subscriberCounts, replyCounts, tapCounts, unlocks, entryCounts] = await Promise.all([
      prisma.storyStickerResponse.findMany({ where: { stickerId: { in: ids } }, select: { stickerId: true, viewerId: true, value: true } }),
      prisma.storyCountdownSubscription.findMany({ where: { stickerId: { in: ids }, userId: viewerId }, select: { stickerId: true } }),
      isOwner ? prisma.storyCountdownSubscription.groupBy({ by: ['stickerId'], where: { stickerId: { in: ids } }, _count: { _all: true } }) : Promise.resolve([]),
      isOwner ? prisma.storyQuestionReply.groupBy({ by: ['stickerId'], where: { stickerId: { in: ids } }, _count: { _all: true } }) : Promise.resolve([]),
      isOwner ? prisma.storyLinkTap.groupBy({ by: ['stickerId'], where: { stickerId: { in: ids } }, _count: { _all: true } }) : Promise.resolve([]),
      isOwner ? prisma.storyRevealUnlock.count({ where: { storyId } }) : Promise.resolve(0),
      threadIds.length ? prisma.storyAddYoursEntry.groupBy({ by: ['threadId'], where: { threadId: { in: threadIds } }, _count: { _all: true } }) : Promise.resolve([]),
    ]);
    const participants = new Map((entryCounts as Array<{ threadId: string; _count: { _all: number } }>).map((row) => [row.threadId, row._count._all]));
    const subscribed = new Set(subscriptions.map((row) => row.stickerId));
    const count = (list: Array<{ stickerId: string; _count: { _all: number } }>) => new Map(list.map((row) => [row.stickerId, row._count._all]));
    const subscribers = count(subscriberCounts as any);
    const replies = count(replyCounts as any);
    const taps = count(tapCounts as any);

    const stickers = rows.flatMap((row) => {
      const config = configOf(row);
      if (!config) return [];
      const all = responses.filter((response) => response.stickerId === row.id);
      const mine = all.find((response) => response.viewerId === viewerId)?.value as Record<string, unknown> | undefined;
      const canSeeResults = isOwner || Boolean(mine);
      let results: Record<string, unknown> | null = null;
      if (canSeeResults && (config.type === 'poll' || config.type === 'quiz')) {
        const counts = config.options.map((_, index) => all.filter((response) => (response.value as any)?.option === index).length);
        results = { counts, total: all.length, ...(config.type === 'quiz' ? { correctIndex: config.correctIndex } : {}) };
      }
      if (canSeeResults && config.type === 'slider') {
        const values = all.map((response) => Number((response.value as any)?.value)).filter((value) => Number.isFinite(value));
        results = { average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, total: values.length };
      }
      if (isOwner && config.type === 'countdown') results = { subscribers: subscribers.get(row.id) ?? 0 };
      if (isOwner && config.type === 'question') results = { replies: replies.get(row.id) ?? 0 };
      if (isOwner && config.type === 'link') results = { taps: taps.get(row.id) ?? 0 };
      if (isOwner && config.type === 'reveal') results = { unlocks };
      // Everyone sees how many joined an Add Yours.
      if (config.type === 'addYours') results = { threadId: config.threadId ?? null, count: config.threadId ? participants.get(config.threadId) ?? 0 : 0 };
      // A viewer who has not answered a quiz must not be able to read the answer.
      const publicConfig = config.type === 'quiz' && !canSeeResults ? { ...config, correctIndex: undefined } : config;
      return [{
        id: row.id,
        key: row.stickerKey,
        type: row.type,
        config: publicConfig,
        myResponse: mine ?? null,
        subscribed: config.type === 'countdown' ? subscribed.has(row.id) : undefined,
        results,
      }];
    });
    return { isOwner, stickers };
  }

  static async respond(viewerId: string, storyId: string, stickerId: string, body: { option?: number; value?: number; text?: string; subscribe?: boolean }) {
    const { story, row, config } = await this.stickerFor(viewerId, storyId, stickerId);
    if (story.ownerId === viewerId) throw new HttpError(403, 'You cannot answer your own sticker', 'STICKER_OWNER');

    if (RESPONSE_TYPES.has(config.type)) {
      let value: Prisma.InputJsonValue;
      if (config.type === 'poll' || config.type === 'quiz') {
        if (!Number.isInteger(body.option) || body.option! < 0 || body.option! >= config.options.length) {
          throw new HttpError(400, 'Choose one of the options', 'STICKER_RESPONSE_INVALID');
        }
        value = { option: body.option! };
      } else {
        if (typeof body.value !== 'number' || !Number.isFinite(body.value) || body.value < 0 || body.value > 1) {
          throw new HttpError(400, 'A rating is between 0 and 1', 'STICKER_RESPONSE_INVALID');
        }
        value = { value: Math.round(body.value * 1000) / 1000 };
      }
      // The first answer stands; a repeat is accepted and changes nothing.
      await prisma.storyStickerResponse.createMany({ data: [{ stickerId: row.id, storyId, viewerId, value }], skipDuplicates: true });
    } else if (config.type === 'question') {
      const text = String(body.text ?? '').trim();
      if (!text || text.length > 300) throw new HttpError(400, 'Replies are 1 to 300 characters', 'STICKER_RESPONSE_INVALID');
      await prisma.storyQuestionReply.create({ data: { stickerId: row.id, storyId, viewerId, text } });
      void this.notifyQuestionReply(story.ownerId, storyId, row.id).catch((error) => logger.warn('Question reply push failed', { error: (error as Error)?.message }));
    } else if (config.type === 'countdown') {
      if (row.endsAt && row.endsAt.getTime() <= Date.now()) throw new HttpError(409, 'This countdown has ended', 'COUNTDOWN_ENDED');
      if (body.subscribe === false) {
        await prisma.storyCountdownSubscription.deleteMany({ where: { stickerId: row.id, userId: viewerId } });
      } else {
        await prisma.storyCountdownSubscription.createMany({ data: [{ stickerId: row.id, userId: viewerId }], skipDuplicates: true });
      }
    } else {
      throw new HttpError(400, 'This sticker does not take answers', 'STICKER_NOT_INTERACTIVE');
    }
    const state = await this.forStory(viewerId, storyId);
    return state.stickers.find((sticker) => sticker.id === row.id) ?? null;
  }

  /** Owner only: who answered, and how. */
  static async results(ownerId: string, storyId: string, stickerId: string) {
    const { story, row, config } = await this.stickerFor(ownerId, storyId, stickerId).catch(async (error) => {
      // An owner can read results for a few days after the Story expires.
      const expired = await prisma.story.findFirst({ where: { id: storyId, ownerId, deletedAt: null } });
      const sticker = expired ? await prisma.storySticker.findFirst({ where: { id: stickerId, storyId } }) : null;
      const parsed = sticker ? configOf(sticker) : null;
      if (!expired || !sticker || !parsed) throw error;
      return { story: expired, row: sticker, config: parsed };
    });
    if (story.ownerId !== ownerId) throw new HttpError(404, 'Sticker is unavailable', 'STICKER_UNAVAILABLE');

    if (config.type === 'question') {
      const rows = await prisma.storyQuestionReply.findMany({ where: { stickerId: row.id }, orderBy: { createdAt: 'desc' }, take: 500 });
      const users = await people(rows.map((reply) => reply.viewerId));
      return { type: config.type, items: rows.map((reply) => ({ id: reply.id, text: reply.text, createdAt: reply.createdAt, person: users.get(reply.viewerId) ?? null })) };
    }
    if (config.type === 'countdown') {
      const rows = await prisma.storyCountdownSubscription.findMany({ where: { stickerId: row.id }, orderBy: { createdAt: 'desc' }, take: 500 });
      const users = await people(rows.map((subscription) => subscription.userId));
      return { type: config.type, items: rows.map((subscription) => ({ id: subscription.id, createdAt: subscription.createdAt, person: users.get(subscription.userId) ?? null })) };
    }
    if (config.type === 'link') {
      const rows = await prisma.storyLinkTap.findMany({ where: { stickerId: row.id }, orderBy: { tappedAt: 'desc' }, take: 500 });
      const users = await people(rows.map((tap) => tap.viewerId));
      return { type: config.type, items: rows.map((tap) => ({ id: tap.id, createdAt: tap.tappedAt, person: users.get(tap.viewerId) ?? null })) };
    }
    if (config.type === 'addYours') {
      const rows = config.threadId
        ? await prisma.storyAddYoursEntry.findMany({ where: { threadId: config.threadId }, orderBy: { createdAt: 'desc' }, take: 500 })
        : [];
      const users = await people([...new Set(rows.map((entry) => entry.ownerId))]);
      return { type: config.type, items: rows.map((entry) => ({ id: entry.id, createdAt: entry.createdAt, person: users.get(entry.ownerId) ?? null })) };
    }
    if (config.type === 'reveal') {
      const rows = await prisma.storyRevealUnlock.findMany({ where: { storyId: row.storyId }, orderBy: { createdAt: 'desc' }, take: 500 });
      const users = await people(rows.map((unlock) => unlock.viewerId));
      return { type: config.type, items: rows.map((unlock) => ({ id: unlock.id, createdAt: unlock.createdAt, person: users.get(unlock.viewerId) ?? null })) };
    }
    if (RESPONSE_TYPES.has(config.type)) {
      const rows = await prisma.storyStickerResponse.findMany({ where: { stickerId: row.id }, orderBy: { createdAt: 'desc' }, take: 1000 });
      const users = await people(rows.map((response) => response.viewerId));
      return { type: config.type, items: rows.map((response) => ({ id: response.id, value: response.value, createdAt: response.createdAt, person: users.get(response.viewerId) ?? null })) };
    }
    throw new HttpError(400, 'This sticker has no results', 'STICKER_NOT_INTERACTIVE');
  }

  static async linkTap(viewerId: string, storyId: string, stickerId: string) {
    const { story, row, config } = await this.stickerFor(viewerId, storyId, stickerId);
    if (config.type !== 'link') throw new HttpError(400, 'This sticker is not a link', 'STICKER_NOT_INTERACTIVE');
    if (story.ownerId !== viewerId) {
      await prisma.storyLinkTap.createMany({ data: [{ stickerId: row.id, storyId, viewerId }], skipDuplicates: true });
    }
    return { url: config.url };
  }

  /** Tells an Add Yours creator someone joined: at most one push per thread per ten minutes. */
  static async notifyAddYoursJoin(creatorId: string, threadId: string, prompt: string, storyId: string) {
    const fresh = await redisClient.set(`story:add-yours-push:${threadId}`, '1', 'EX', 600, 'NX').catch(() => 'OK');
    if (fresh !== 'OK') return;
    await PushService.send(creatorId, {
      title: 'Someone joined your Add Yours',
      body: prompt,
      data: { url: `iemdating://stories/${storyId}`, storyId, kind: 'story_add_yours' },
      category: 'story_activity',
    });
  }

  /** One push per question per ten minutes, however many replies arrive. */
  private static async notifyQuestionReply(ownerId: string, storyId: string, stickerId: string) {
    const fresh = await redisClient.set(`story:question-push:${stickerId}`, '1', 'EX', 600, 'NX').catch(() => 'OK');
    if (fresh !== 'OK') return;
    await PushService.send(ownerId, {
      title: 'New reply to your question',
      body: 'Open your story to see it.',
      data: { url: `iemdating://stories/${storyId}`, storyId, kind: 'story_question_reply' },
      category: 'story_activity',
    });
  }

  /** Tells everyone who asked to be reminded when a countdown ends. */
  static async sweepCountdowns(limit = 50): Promise<number> {
    const due = await prisma.storySticker.findMany({
      where: { type: 'countdown', notifiedAt: null, endsAt: { lte: new Date() } },
      take: limit,
    });
    let notified = 0;
    for (const sticker of due) {
      const config = configOf(sticker);
      const title = config?.type === 'countdown' ? config.title : 'A countdown';
      const subscriptions = await prisma.storyCountdownSubscription.findMany({ where: { stickerId: sticker.id, notifiedAt: null }, take: 1000 });
      const story = await prisma.story.findUnique({ where: { id: sticker.storyId }, select: { ownerId: true, audience: true } });
      for (const subscription of subscriptions) {
        const deliveryKey = `countdown:${sticker.id}:${subscription.userId}`;
        try {
          // Only people who can still see the Story are reminded: someone since
          // hidden, blocked or taken off Close Friends hears nothing.
          const canSee = !!story && await StoryVisibilityService.check(subscription.userId, story);
          if (canSee) {
            const notification = await prisma.notification.upsert({
              where: { deliveryKey },
              create: {
                userId: subscription.userId, type: 'story_countdown', title: 'Countdown ended',
                body: `${title} has started.`.slice(0, 200), data: { storyId: sticker.storyId }, deliveryKey,
              },
              update: {},
            });
            if (!notification.pushSentAt) {
              await PushService.send(subscription.userId, { title: 'Countdown ended', body: `${title} has started.`.slice(0, 200), data: { url: 'iemdating://discover', kind: 'story_countdown' }, category: 'story_countdowns' });
              await prisma.notification.update({ where: { id: notification.id }, data: { pushSentAt: new Date() } });
            }
          }
          await prisma.storyCountdownSubscription.update({ where: { id: subscription.id }, data: { notifiedAt: new Date() } });
          notified += 1;
        } catch (error) {
          logger.warn('Countdown reminder failed', { stickerId: sticker.id, error: (error as Error)?.message });
        }
      }
      const remaining = await prisma.storyCountdownSubscription.count({ where: { stickerId: sticker.id, notifiedAt: null } });
      if (!remaining) await prisma.storySticker.update({ where: { id: sticker.id }, data: { notifiedAt: new Date() } });
    }
    return notified;
  }
}
