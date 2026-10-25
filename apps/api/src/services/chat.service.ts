import { PushService } from './push.service';
import { VerificationLimitsService } from './verification-limits.service';
import { Prisma } from '@prisma/client';
import { onlineAmong } from './presence.service';
import { prisma } from '../utils/prisma';
import { AnalyticsService } from './analytics.service';
import { MatchAccessService } from './match-access.service';
import { HttpError } from '../utils/httpError';
import { OUTBOX_TOPICS, OutboxService } from './outbox.service';
import { ChatEventService } from './chat-event.service';
import { createHash } from 'crypto';
import { redisClient } from '../utils/redis';
import { StoryReplyCardService } from './story-reply-card.service';
import { NotificationFeedService } from './notification-feed.service';

// Intl.Segmenter ships with Node, but this project's TypeScript lib predates it.
type GraphemeSegmenter = { segment(input: string): Iterable<unknown> };
const graphemes: GraphemeSegmenter = new (Intl as unknown as {
    Segmenter: new (locale: string, options: { granularity: 'grapheme' }) => GraphemeSegmenter;
}).Segmenter('en', { granularity: 'grapheme' });

/**
 * A reaction is any single emoji, as in Telegram.
 *
 * With the six-item allow-list gone this is the only thing between the database
 * and arbitrary text. One grapheme rules out "👍👍" and words; the pictographic
 * test rules out a lone letter or digit, which is also one grapheme. Keycaps
 * (1️⃣) and flags are built from non-pictographic parts, so they are recognised
 * first rather than rejected by that test. The length cap is the column's:
 * VARCHAR(16) counts code points.
 */
export function isSingleEmoji(value: unknown): value is string {
    if (typeof value !== 'string' || !value || [...value].length > 16) return false;
    if ([...graphemes.segment(value)].length !== 1) return false;
    if (/^[#*0-9]\uFE0F?\u20E3$/u.test(value)) return true;
    if (/^\p{Regional_Indicator}{2}$/u.test(value)) return true;
    return /\p{Extended_Pictographic}/u.test(value) && !/[\p{L}\p{N}]/u.test(value);
}
const MESSAGE_TYPES = new Set(['text', 'media', 'document', 'voice', 'story_reply']);

/**
 * Order-independent serialization for the idempotency fingerprint.
 *
 * JSON.stringify preserves insertion order, so a retry that serialized
 * client-supplied metadata or attachment keys in a different order produced a
 * different hash and was rejected as IDEMPOTENCY_MISMATCH. Clients treat that
 * as terminal and discard the message, so the same command must always hash to
 * the same value.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((out, key) => {
        const item = (value as Record<string, unknown>)[key];
        if (item !== undefined) out[key] = canonical(item);
        return out;
      }, Object.create(null));
  }
  return value;
}

function fingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export class ChatService {
    /**
     * Get all conversations for a user — returns matches with last message, unread count, and other user info.
     */
    static async getConversations(userId: string, query?: string) {
        const matches = await prisma.match.findMany({
            where: {
                status: 'active',
                OR: [
                    { user1Id: userId },
                    { user2Id: userId },
                ],
            },
            include: {
                user1: {
                    select: {
                        id: true,
                        name: true,
                        avatarUrl: true,
                        showOnlineStatus: true,
                        photos: {
                            where: { isPrimary: true },
                            select: { photoUrl: true },
                            take: 1,
                        },
                    },
                },
                user2: {
                    select: {
                        id: true,
                        name: true,
                        avatarUrl: true,
                        showOnlineStatus: true,
                        photos: {
                            where: { isPrimary: true },
                            select: { photoUrl: true },
                            take: 1,
                        },
                    },
                },
                messages: {
                    where: {
                        isDeleted: false,
                        NOT: {
                            hiddenBy: { has: userId },
                        },
                        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                    },
                    orderBy: { sentAt: 'desc' },
                    take: 1,
                    select: {
                        id: true,
                        content: true,
                        senderId: true,
                        sentAt: true,
                        readAt: true,
                        photoUrl: true,
                        messageSeq: true,
                        type: true,
                        metadata: true,
                        mediaKeys: true,
                        clientMessageId: true,
                        replyToId: true,
                        editedAt: true,
                        revision: true,
                        expiresAt: true,
                    },
                },
                chatSessions: {
                    orderBy: { lastMessageAt: 'desc' },
                    take: 1,
                    select: { lastMessageAt: true },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        const participants = await prisma.chatParticipant.findMany({
            where: { userId, matchId: { in: matches.map((match) => match.id) } },
            select: { matchId: true, mutedUntil: true, archivedAt: true, pinnedAt: true, markedUnread: true, clearedThroughSeq: true, hiddenAt: true },
        });
        const lastIds = matches.flatMap(match => match.messages.map(message => message.id));
        const receipts = lastIds.length ? await prisma.messageReceipt.findMany({
            where: { messageId: { in: lastIds } },
            select: { messageId: true, deliveredAt: true, readAt: true, playedAt: true },
        }) : [];
        const receiptById = new Map(receipts.map(receipt => [receipt.messageId, receipt]));
        // Only standing reactions to messages this user can still see may appear.
        const reactions = matches.length ? await prisma.$queryRaw<Array<{
            matchId: string; messageId: string; userId: string; emoji: string; at: Date;
            messageSenderId: string; content: string; type: string;
        }>>`
            SELECT DISTINCT ON (m.match_id) m.match_id AS "matchId", m.id AS "messageId",
                   r.user_id AS "userId", r.emoji, r.updated_at AS "at",
                   m.sender_id AS "messageSenderId", m.content, m.type
            FROM message_reactions r JOIN messages m ON m.id = r.message_id
            LEFT JOIN chat_participants p ON p.match_id = m.match_id AND p.user_id = ${userId}::uuid
            WHERE m.match_id = ANY(${matches.map(match => match.id)}::uuid[])
              AND m.is_deleted = false AND NOT (${userId} = ANY(m.hidden_by))
              AND (m.expires_at IS NULL OR m.expires_at > now())
              AND (m.message_seq > COALESCE(p.cleared_through_seq, 0)
                   OR (m.message_seq IS NULL AND COALESCE(p.cleared_through_seq, 0) = 0))
            ORDER BY m.match_id, r.updated_at DESC, r.id DESC` : [];
        const reactionByMatch = new Map(reactions.map(reaction => [reaction.matchId, reaction]));
        const stateByMatch = new Map(participants.map((row) => [row.matchId, row]));
        const now = new Date();
        // Format conversations
        // Online dots, both ways: only when you share yours and they share theirs.
        const me = await prisma.user.findUnique({ where: { id: userId }, select: { showOnlineStatus: true } });
        const sharing = matches
            .map((match) => (match.user1Id === userId ? match.user2 : match.user1))
            .filter((other) => other.showOnlineStatus)
            .map((other) => other.id);
        const online = me?.showOnlineStatus ? await onlineAmong(sharing) : new Set<string>();
        const conversations = matches.map((match) => {
            const otherUser = match.user1Id === userId ? match.user2 : match.user1;
            const state = stateByMatch.get(match.id);
            const clearedThroughSeq = state?.clearedThroughSeq ?? 0;
            const newest = match.messages[0] || null;
            // The newest message carries the highest sequence, so if it falls inside
            // what this user cleared, everything does: the chat reads as empty.
            const lastMessage = newest && !(clearedThroughSeq > 0 && (newest.messageSeq ?? 0) <= clearedThroughSeq) ? newest : null;
            // Count unread messages (messages sent by the OTHER user that haven't been read)
            return {
                matchId: match.id,
                user: {
                    id: otherUser.id,
                    name: otherUser.name,
                    avatar: otherUser.avatarUrl || otherUser.photos[0]?.photoUrl || null,
                    online: online.has(otherUser.id),
                },
                lastMessage: lastMessage
                    ? {
                        id: lastMessage.id,
                        content: lastMessage.content,
                        senderId: lastMessage.senderId,
                        sentAt: lastMessage.sentAt,
                        isRead: !!lastMessage.readAt,
                        readAt: lastMessage.readAt,
                        deliveredAt: receiptById.get(lastMessage.id)?.deliveredAt ?? null,
                        playedAt: receiptById.get(lastMessage.id)?.playedAt ?? null,
                        messageSeq: lastMessage.messageSeq,
                        mediaKeys: lastMessage.mediaKeys,
                        clientMessageId: lastMessage.clientMessageId,
                        replyToId: lastMessage.replyToId,
                        editedAt: lastMessage.editedAt,
                        revision: lastMessage.revision,
                        expiresAt: lastMessage.expiresAt,
                        mediaKey: lastMessage.photoUrl,
                        type: lastMessage.type,
                        metadata: lastMessage.metadata,
                    }
                    : null,
                reactionPreview: lastMessage && reactionByMatch.has(match.id) && reactionByMatch.get(match.id)!.at > lastMessage.sentAt
                    ? reactionByMatch.get(match.id)! : null,
                createdAt: match.createdAt,
                activityAt: match.chatSessions[0]?.lastMessageAt ?? lastMessage?.sentAt ?? match.createdAt,
                pinned: Boolean(state?.pinnedAt),
                pinnedAt: state?.pinnedAt ?? null,
                archived: Boolean(state?.archivedAt),
                mutedUntil: state?.mutedUntil ?? null,
                muted: Boolean(state?.mutedUntil && state.mutedUntil > now),
                markedUnread: state?.markedUnread ?? false,
                hiddenAt: state?.hiddenAt ?? null,
                messageTtlSeconds: match.messageTtlSeconds ?? null,
            };
        });
        // Sort by last message time (using ChatSession), fallback to match creation
        conversations.sort((a, b) => {
            const aMatch = matches.find(m => m.id === a.matchId);
            const bMatch = matches.find(m => m.id === b.matchId);
            const aTime = aMatch?.chatSessions?.[0]?.lastMessageAt?.getTime() || a.lastMessage?.sentAt?.getTime() || a.createdAt.getTime();
            const bTime = bMatch?.chatSessions?.[0]?.lastMessageAt?.getTime() || b.lastMessage?.sentAt?.getTime() || b.createdAt.getTime();
            return bTime - aTime || b.matchId.localeCompare(a.matchId);
        });
        // Add unread counts in a separate query for accuracy (N+1 query issue fixed)
        const matchIds = conversations.map(c => c.matchId);
        let unreadMap = new Map();
        if (matchIds.length > 0) {
            // One query across every chat, honouring each chat's own cleared-history
            // watermark, skipping messages past their auto-delete deadline, and not
            // counting service notices, which nobody wrote and nobody needs to read.
            const unreadCounts = await prisma.$queryRaw<{ match_id: string; n: number }[]>`
                SELECT m.match_id, count(*)::int AS n
                FROM messages m
                LEFT JOIN chat_participants p ON p.match_id = m.match_id AND p.user_id = ${userId}::uuid
                WHERE m.match_id = ANY(${matchIds}::uuid[])
                  AND m.sender_id <> ${userId}::uuid
                  AND m.read_at IS NULL
                  AND m.is_deleted = false
                  AND m.type <> 'service'
                  AND NOT (${userId} = ANY(m.hidden_by))
                  AND (m.expires_at IS NULL OR m.expires_at > now())
                  AND (m.message_seq > COALESCE(p.cleared_through_seq, 0)
                       OR (m.message_seq IS NULL AND COALESCE(p.cleared_through_seq, 0) = 0))
                GROUP BY m.match_id`;
            unreadCounts.forEach((item) => unreadMap.set(item.match_id, item.n));
        }
        const conversationsWithUnread = conversations
            // A chat deleted for this user stays out of the list until something new
            // is said in it - the same thing that brings a deleted chat back in Telegram.
            .filter((conv) => !conv.hiddenAt || new Date(conv.activityAt) > conv.hiddenAt)
            .map(({ hiddenAt: _hiddenAt, ...conv }) => ({
                ...conv,
                unreadCount: unreadMap.get(conv.matchId) || 0,
            }));
        const needle = query?.trim().toLocaleLowerCase();
        return needle ? conversationsWithUnread.filter((item) => item.user.name.toLocaleLowerCase().includes(needle) || item.lastMessage?.content.toLocaleLowerCase().includes(needle)) : conversationsWithUnread;
    }
    static async getConversationsPage(userId: string, query?: string, cursor?: string, limit = 30, folder: 'main' | 'archived' = 'main') {
        const everything = await this.getConversations(userId, query);
        // A search looks through every chat, archived ones included, as Telegram's does.
        const all = query?.trim() ? everything : everything.filter((item) => (folder === 'archived') === item.archived);
        // Pinned chats lead the first page, newest pin first, and are kept out of the
        // activity-ordered pages behind the cursor so paging can never repeat or skip one.
        const pinned = all
            .filter((item) => item.pinned)
            .sort((a, b) => new Date(b.pinnedAt!).getTime() - new Date(a.pinnedAt!).getTime());
        const unpinned = all.filter((item) => !item.pinned);
        let decoded = null;
        if (cursor) {
            try {
                decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
                if (!decoded?.highWater || !decoded.activityAt || !decoded.id)
                    throw new Error('missing fields');
            }
            catch {
                throw new HttpError(400, 'Conversation cursor is invalid', 'INVALID_CONVERSATION_CURSOR');
            }
        }
        const highWater = decoded ? new Date(decoded.highWater) : new Date();
        const lastTime = decoded ? new Date(decoded.activityAt) : null;
        if (Number.isNaN(highWater.getTime()) || (lastTime && Number.isNaN(lastTime.getTime())))
            throw new HttpError(400, 'Conversation cursor is invalid', 'INVALID_CONVERSATION_CURSOR');
        const eligible = unpinned.filter((item) => {
            const activity = new Date(item.activityAt);
            if (activity > highWater)
                return false;
            if (!decoded || !lastTime)
                return true;
            return activity < lastTime || (activity.getTime() === lastTime.getTime() && item.matchId < decoded.id);
        });
        const take = Math.min(Math.max(limit, 1), 100);
        const items = eligible.slice(0, take);
        const last = items[items.length - 1];
        const archived = everything.filter((item) => item.archived);
        return {
            items: decoded ? items : [...pinned, ...items],
            highWater: highWater.toISOString(),
            nextCursor: eligible.length > take && last ? Buffer.from(JSON.stringify({ highWater: highWater.toISOString(), activityAt: new Date(last.activityAt).toISOString(), id: last.matchId })).toString('base64url') : null,
            folder,
            archivedCount: archived.length,
            archivedUnreadCount: archived.reduce((sum, item) => sum + item.unreadCount, 0),
        };
    }
    /**
     * Get paginated messages for a match. Cursor-based pagination (newest first).
     * If `since` is provided, fetches only messages newer than that timestamp (for incremental sync).
     */
    /**
     * What this user may see of a conversation's messages.
     *
     * Two things are simply absent from every read: history the user cleared, and
     * messages past their auto-delete deadline that the sweeper has not reached
     * yet. The second keeps a disappearing message on time without depending on
     * how recently the sweep ran. Search, context and shared media use the same
     * rule, so a cleared or expired message cannot resurface through them.
     */
    private static async visibilityFor(matchId: string, userId: string) {
        const participant = await prisma.chatParticipant.findUnique({
            where: { matchId_userId: { matchId, userId } },
            select: { clearedThroughSeq: true },
        });
        const clearedThroughSeq = participant?.clearedThroughSeq ?? 0;
        return {
            clearedThroughSeq,
            clearedFilter: clearedThroughSeq > 0 ? { messageSeq: { gt: clearedThroughSeq } } : {},
            notExpired: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        };
    }
    static async getMessages(matchId: string, userId: string, cursor?: string, limit: number = 30, since?: string, sinceId?: string, cursorSentAt?: string) {
        await MatchAccessService.requireActiveMatch(userId, matchId);
        const boundedLimit = Math.min(Math.max(limit, 1), 100);
        const { clearedFilter, notExpired } = await this.visibilityFor(matchId, userId);
        // Incremental sync: fetch only new messages since a timestamp
        if (since) {
            const sinceDate = new Date(since);
            if (Number.isNaN(sinceDate.getTime()) || !sinceId)
                throw new HttpError(400, 'A valid sync cursor is required', 'INVALID_SYNC_CURSOR');
            const newMessages = await prisma.message.findMany({
                where: {
                    matchId,
                    isDeleted: false,
                    NOT: {
                        hiddenBy: { has: userId },
                    },
                    ...clearedFilter,
                    AND: [notExpired],
                    OR: [
                        { sentAt: { gt: sinceDate } },
                        { sentAt: sinceDate, id: { gt: sinceId } },
                    ],
                },
                orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
                take: 101,
                select: {
                    id: true,
                    content: true,
                    senderId: true,
                    sentAt: true,
                    readAt: true,
                    photoUrl: true,
                    mediaKeys: true,
                    matchId: true,
                    clientMessageId: true,
                    messageSeq: true,
                    type: true,
                    metadata: true,
                    replyToId: true,
                    storyId: true,
                    editedAt: true,
                    revision: true,
                    expiresAt: true,
                },
            });
            const hasMore = newMessages.length > 100;
            const page = hasMore ? newMessages.slice(0, 100) : newMessages;
            const reactions = await prisma.messageReaction.findMany({ where: { messageId: { in: page.map((message) => message.id) } } });
            const receipts = await prisma.messageReceipt.findMany({
                where: { messageId: { in: page.map((message) => message.id) } },
                select: { messageId: true, deliveredAt: true, readAt: true, playedAt: true },
            });
            const receiptByMessage = new Map(receipts.map((receipt) => [receipt.messageId, receipt]));
            // Which Story each Story reply answers, resolved now so an expired one reads "unavailable".
            const storyCards = await StoryReplyCardService.cardsFor(userId, page);
            const messages = page.map((message) => ({
                ...message,
                ...(message.type === 'story_reply' ? { story: StoryReplyCardService.cardOf(storyCards, message.storyId) } : {}),
                deliveredAt: receiptByMessage.get(message.id)?.deliveredAt ?? null,
                playedAt: receiptByMessage.get(message.id)?.playedAt ?? null,
                readAt: message.readAt ?? receiptByMessage.get(message.id)?.readAt ?? null,
                mediaKey: message.photoUrl,
                mediaKeys: message.mediaKeys || [],
                photoUrl: undefined,
                reactions: Object.fromEntries(reactions.filter((reaction) => reaction.messageId === message.id).map((reaction) => [reaction.userId, reaction.emoji])),
            }));
            const last = page[page.length - 1];
            return {
                messages,
                nextCursor: null,
                hasMore,
                syncCursor: last ? { sentAt: last.sentAt, id: last.id } : { sentAt: sinceDate, id: sinceId },
            };
        }
        // Full pagination fetch, keyset on (sentAt, id).
        //
        // Prisma's `cursor` needs the cursor row to still exist and the order to
        // be unique. Neither held: the order was sentAt alone, so an album sent
        // in one millisecond could be split across a page boundary and skipped,
        // and an auto-deleted or cleared cursor message made every later page
        // come back empty - history simply stopped scrolling. The anchor's
        // timestamp is looked up, falling back to the one the client sent, and
        // the page is everything strictly before (sentAt, id).
        let before: { sentAt: Date; id: string } | null = null;
        if (cursor) {
            const anchor = await prisma.message.findFirst({ where: { id: cursor, matchId }, select: { sentAt: true } });
            const fallback = cursorSentAt ? new Date(cursorSentAt) : null;
            const sentAt = anchor?.sentAt ?? (fallback && !Number.isNaN(fallback.getTime()) ? fallback : null);
            if (!sentAt) throw new HttpError(400, 'A valid history cursor is required', 'INVALID_HISTORY_CURSOR');
            before = { sentAt, id: cursor };
        }
        const messages = await prisma.message.findMany({
            where: {
                matchId,
                isDeleted: false,
                NOT: {
                    hiddenBy: { has: userId },
                },
                ...clearedFilter,
                AND: [
                    notExpired,
                    before
                        ? { OR: [{ sentAt: { lt: before.sentAt } }, { sentAt: before.sentAt, id: { lt: before.id } }] }
                        : {},
                ],
            },
            orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
            take: boundedLimit + 1,
            select: {
                id: true,
                content: true,
                senderId: true,
                sentAt: true,
                readAt: true,
                photoUrl: true,
                mediaKeys: true,
                matchId: true,
                clientMessageId: true,
                messageSeq: true,
                type: true,
                metadata: true,
                replyToId: true,
                storyId: true,
                editedAt: true,
                revision: true,
                expiresAt: true,
            },
        });
        const reactions = await prisma.messageReaction.findMany({ where: { messageId: { in: messages.map((message) => message.id) } } });
        const receipts = await prisma.messageReceipt.findMany({
            where: { messageId: { in: messages.map((message) => message.id) } },
            select: { messageId: true, deliveredAt: true, readAt: true, playedAt: true },
        });
        const receiptByMessage = new Map(receipts.map((receipt) => [receipt.messageId, receipt]));
        const storyCards = await StoryReplyCardService.cardsFor(userId, messages);
        const mappedMessages = messages.map(m => ({
            ...m,
            ...(m.type === 'story_reply' ? { story: StoryReplyCardService.cardOf(storyCards, m.storyId) } : {}),
            deliveredAt: receiptByMessage.get(m.id)?.deliveredAt ?? null,
            playedAt: receiptByMessage.get(m.id)?.playedAt ?? null,
            readAt: m.readAt ?? receiptByMessage.get(m.id)?.readAt ?? null,
            mediaKey: m.photoUrl,
            mediaKeys: m.mediaKeys || [],
            photoUrl: undefined,
            reactions: Object.fromEntries(reactions.filter((reaction) => reaction.messageId === m.id).map((reaction) => [reaction.userId, reaction.emoji])),
        }));
        const hasMore = mappedMessages.length > boundedLimit;
        const data = hasMore ? mappedMessages.slice(0, boundedLimit) : mappedMessages;
        const nextCursor = hasMore ? data[data.length - 1].id : null;
        return {
            messages: data,
            nextCursor,
            hasMore,
        };
    }
    /**
     * Save a new message and return it with sender info.
     */
    static async sendMessage(senderId: string, matchId: string, content: string, photoUrl?: string, mediaKeys: string[] = [], clientMessageId?: string, options: { type?: string; metadata?: Record<string, unknown>; replyToId?: string; storyId?: string } = {}) {
        const rateKey = `chat:send:${senderId}:${Math.floor(Date.now() / 60000)}`;
        try {
            const count = Number(await redisClient.eval("local n=redis.call('incr',KEYS[1]); if n==1 then redis.call('expire',KEYS[1],60) end return n", 1, rateKey));
            if (count > 120)
                throw new HttpError(429, 'Too many messages. Retry in one minute', 'RATE_LIMITED');
        }
        catch (error) {
            if (error instanceof HttpError)
                throw error;
            throw new HttpError(503, 'Chat is temporarily unavailable', 'CHAT_UNAVAILABLE');
        }
        // Validation
        if (typeof content !== 'string')
            throw new HttpError(400, 'Message content must be text', 'INVALID_MESSAGE_CONTENT');
        if (!Array.isArray(mediaKeys) || mediaKeys.length > 10 || mediaKeys.some((key) => typeof key !== 'string' || key.length < 1 || key.length > 500)) {
            throw new HttpError(400, 'Message attachments are invalid', 'INVALID_MESSAGE_MEDIA');
        }
        if (clientMessageId !== undefined && (typeof clientMessageId !== 'string' || clientMessageId.length < 1 || clientMessageId.length > 100)) {
            throw new HttpError(400, 'Message identifier is invalid', 'INVALID_MESSAGE_ID');
        }
        if (content.trim().length > 2000)
            throw new HttpError(400, 'Message content is too long', 'MESSAGE_TOO_LONG');
        if (!content?.trim() && (!mediaKeys || mediaKeys.length === 0)) {
            throw new Error('Message content or media is required');
        }
        // Sanitize content to prevent XSS
        const sanitizedContent = content?.trim()?.substring(0, 2000) || '';
        const messageType = options.type ?? (mediaKeys.length || photoUrl ? 'media' : 'text');
        if (!MESSAGE_TYPES.has(messageType))
            throw new HttpError(400, 'Message type is not supported', 'INVALID_MESSAGE_TYPE');
        if (JSON.stringify(options.metadata ?? {}).length > 4000)
            throw new HttpError(400, 'Message metadata is too large', 'INVALID_MESSAGE_METADATA');
        const metadataKeys = Object.keys(options.metadata ?? {});
        // No forwarding in a dating app: a message is written to this person,
        // not passed on from someone else's chat.
        if (metadataKeys.includes('forwarded'))
            throw new HttpError(400, 'Forwarding messages is not available', 'FORWARDING_NOT_AVAILABLE');
        if (messageType === 'voice') {
            const duration = options.metadata?.durationSeconds;
            const waveform = options.metadata?.waveform;
            const validWaveform = waveform === undefined || (Array.isArray(waveform) && waveform.length <= 64 && waveform.every((value) => typeof value === 'number' && value >= 0 && value <= 1));
            if (mediaKeys.length !== 1 || typeof duration !== 'number' || duration < 0 || duration > 60 || !validWaveform || metadataKeys.some((key) => !['durationSeconds', 'waveform'].includes(key))) {
                throw new HttpError(400, 'Voice message metadata is invalid', 'INVALID_MESSAGE_METADATA');
            }
        }
        if (messageType === 'document') {
            const document = options.metadata?.document as Record<string, unknown> | undefined;
            const validDocument = document &&
                typeof document.fileName === 'string' && document.fileName.length > 0 && document.fileName.length <= 255 &&
                typeof document.mimeType === 'string' && document.mimeType.length > 0 && document.mimeType.length <= 100 &&
                typeof document.size === 'number' && Number.isSafeInteger(document.size) && document.size >= 0;
            if (mediaKeys.length !== 1 || !validDocument || metadataKeys.some((key) => key !== 'document')) {
                throw new HttpError(400, 'Document message metadata is invalid', 'INVALID_MESSAGE_METADATA');
            }
        }
        if (messageType === 'story_reply' && metadataKeys.some((key) => !['storyOwnerId', 'storyReplyKind'].includes(key))) {
            throw new HttpError(400, 'Story reply metadata is invalid', 'INVALID_MESSAGE_METADATA');
        }
        await MatchAccessService.requireActiveMatch(senderId, matchId);
        if (options.replyToId) {
            const parent = await prisma.message.findFirst({ where: { id: options.replyToId, matchId, isDeleted: false }, select: { id: true } });
            if (!parent)
                throw new HttpError(404, 'Reply message is unavailable', 'REPLY_MESSAGE_UNAVAILABLE');
        }
        if (messageType === 'story_reply') {
            if (!options.storyId)
                throw new HttpError(400, 'Story reply context is required', 'STORY_REPLY_CONTEXT_REQUIRED');
            const match = await MatchAccessService.requireActiveMatch(senderId, matchId);
            const recipientId = match.user1Id === senderId ? match.user2Id : match.user1Id;
            const story = await prisma.story.findFirst({ where: { id: options.storyId, ownerId: recipientId, state: 'published', deletedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
            if (!story)
                throw new HttpError(404, 'Story is unavailable', 'STORY_UNAVAILABLE');
        }
        else if (options.storyId) {
            throw new HttpError(400, 'Story context requires a story reply', 'INVALID_STORY_CONTEXT');
        }
        const requestedKeys = [...new Set([...(mediaKeys || []), ...(photoUrl ? [photoUrl] : [])])];
        const commandFingerprint = fingerprint({ matchId, content: sanitizedContent, requestedKeys: [...requestedKeys].sort(), options: { ...options, type: messageType } });
        const select = {
            id: true,
            content: true,
            senderId: true,
            sentAt: true,
            readAt: true,
            matchId: true,
            sender: {
                select: {
                    id: true,
                    name: true,
                },
            },
            photoUrl: true,
            mediaKeys: true,
            clientMessageId: true,
            messageSeq: true,
            type: true,
            metadata: true,
            replyToId: true,
            storyId: true,
            editedAt: true,
            deletedForEveryoneAt: true,
            revision: true,
            commandFingerprint: true,
            expiresAt: true,
        };
        if (clientMessageId) {
            const existing = await prisma.message.findUnique({
                where: { senderId_clientMessageId: { senderId, clientMessageId } },
                select,
            });
            if (existing) {
                if (existing.matchId !== matchId)
                    throw new HttpError(409, 'Message identifier was already used', 'MESSAGE_ID_CONFLICT');
                if (existing.commandFingerprint && existing.commandFingerprint !== commandFingerprint) {
                    throw new HttpError(409, 'Message identifier has different content', 'IDEMPOTENCY_MISMATCH');
                }
                return { ...existing, mediaKey: existing.photoUrl, mediaKeys: existing.mediaKeys, photoUrl: undefined, repeated: true };
            }
        }
        // Before verifying: 30 messages, voice notes but no photos or videos
        // (GOOGLE_SIGNUP_PLAN.md 2.3). After the replay check above, so a
        // retried message is never refused or counted twice.
        await VerificationLimitsService.requireCanSend(senderId, messageType, requestedKeys.length > 0);
        if (requestedKeys.length) {
            const owned = await prisma.chatMediaAsset.count({
                where: { objectKey: { in: requestedKeys }, ownerId: senderId, matchId, status: 'uploaded', expiresAt: { gt: new Date() } },
            });
            if (owned !== requestedKeys.length)
                throw new HttpError(400, 'Chat media ticket is invalid or expired', 'INVALID_MEDIA_TICKET');
        }
        let message;
        try {
            message = await prisma.$transaction(async (tx) => {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 1))`;
                const activeMatch = await tx.match.findUnique({
                    where: { id: matchId },
                    select: { status: true, user1Id: true, user2Id: true, messageTtlSeconds: true },
                });
                if (!activeMatch ||
                    activeMatch.status !== 'active' ||
                    (activeMatch.user1Id !== senderId && activeMatch.user2Id !== senderId)) {
                    throw new HttpError(403, 'Match is unavailable', 'MATCH_UNAVAILABLE');
                }
                const session = await tx.chatSession.upsert({
                    where: { matchId },
                    create: { matchId, lastMessageAt: new Date(), lastMessageSeq: 1 },
                    update: { lastMessageAt: new Date(), lastMessageSeq: { increment: 1 } },
                    select: { lastMessageSeq: true },
                });
                // Media the nudity check marked: the receiver's app blurs these keys
                // until tapped (docs/NUDITY_CHECK.md).
                const sensitiveKeys = requestedKeys.length
                    ? (await tx.chatMediaAsset.findMany({ where: { objectKey: { in: requestedKeys }, ownerId: senderId, matchId, sensitive: true }, select: { objectKey: true } })).map((row) => row.objectKey)
                    : [];
                const metadata = sensitiveKeys.length ? { ...(options.metadata ?? {}), sensitive: sensitiveKeys } : options.metadata;
                const created = await tx.message.create({
                    data: {
                        senderId,
                        matchId,
                        content: sanitizedContent,
                        photoUrl,
                        mediaKeys,
                        clientMessageId,
                        messageSeq: session.lastMessageSeq,
                        type: messageType,
                        metadata: metadata as Prisma.InputJsonValue | undefined,
                        replyToId: options.replyToId,
                        storyId: options.storyId,
                        commandFingerprint,
                        // Read inside the same lock that changes the setting, so a
                        // message can never be sent under one switched off a moment ago.
                        expiresAt: activeMatch.messageTtlSeconds
                            ? new Date(Date.now() + activeMatch.messageTtlSeconds * 1000)
                            : null,
                    },
                    select,
                });
                if (requestedKeys.length) {
                    const attached = await tx.chatMediaAsset.updateMany({
                        where: { objectKey: { in: requestedKeys }, ownerId: senderId, matchId, status: 'uploaded', expiresAt: { gt: new Date() } },
                        data: { status: 'attached', attachedAt: created.sentAt },
                    });
                    if (attached.count !== requestedKeys.length)
                        throw new HttpError(400, 'Chat media ticket is invalid or expired', 'INVALID_MEDIA_TICKET');
                }
                const recipientId = activeMatch.user1Id === senderId ? activeMatch.user2Id : activeMatch.user1Id;
                await Promise.all([
                    tx.chatParticipant.upsert({
                        where: { matchId_userId: { matchId, userId: senderId } },
                        create: { matchId, userId: senderId },
                        update: {},
                    }),
                    tx.chatParticipant.upsert({
                        where: { matchId_userId: { matchId, userId: recipientId } },
                        create: { matchId, userId: recipientId, unreadCount: 1 },
                        update: { unreadCount: { increment: 1 } },
                    }),
                    tx.messageReceipt.create({ data: { messageId: created.id, recipientId } }),
                ]);
                // Telegram brings an archived chat back when a message arrives -
                // unless it is muted, which is exactly how people keep a noisy
                // conversation archived. Sending does not unarchive your own copy.
                // Leaving the archive drops the pin, since each folder pins apart.
                await tx.chatParticipant.updateMany({
                    where: {
                        matchId,
                        userId: recipientId,
                        archivedAt: { not: null },
                        OR: [{ mutedUntil: null }, { mutedUntil: { lte: new Date() } }],
                    },
                    data: { archivedAt: null, pinnedAt: null },
                });
                await OutboxService.enqueue(tx, {
                    topic: OUTBOX_TOPICS.MESSAGE_CREATED,
                    aggregateId: created.id,
                    deduplicationKey: `message.created:${created.id}`,
                    payload: { recipientId },
                });
                await ChatEventService.append(tx, {
                    matchId,
                    type: 'message.created',
                    actorId: senderId,
                    entityId: created.id,
                    payload: { messageId: created.id, messageSeq: created.messageSeq ?? 0 },
                });
                return created;
            });
        }
        catch (error: any) {
            if (error?.code !== 'P2002' || !clientMessageId)
                throw error;
            const existing = await prisma.message.findUniqueOrThrow({
                where: { senderId_clientMessageId: { senderId, clientMessageId } }, select,
            });
            if (existing.matchId !== matchId)
                throw new HttpError(409, 'Message identifier was already used', 'MESSAGE_ID_CONFLICT');
            if (existing.commandFingerprint && existing.commandFingerprint !== commandFingerprint) {
                throw new HttpError(409, 'Message identifier has different content', 'IDEMPOTENCY_MISMATCH');
            }
            return { ...existing, mediaKey: existing.photoUrl, mediaKeys: existing.mediaKeys, photoUrl: undefined, repeated: true };
        }
        const mappedMessage = {
            ...message,
            mediaKey: message.photoUrl,
            mediaKeys: message.mediaKeys || [],
            photoUrl: undefined,
            repeated: false,
        };
        // Track message metrics for algorithm (async, non-blocking)
        this.trackMessageMetrics(senderId, matchId).catch(() => { });
        return mappedMessage;
    }
    /**
     * Track message metrics for the recommendation algorithm.
     * Called after sendMessage completes — runs asynchronously.
     */
    private static async trackMessageMetrics(senderId: string, matchId: string): Promise<void> {
        try {
            AnalyticsService.trackMessage({ matchId, senderId });
        }
        catch (error) {
            // Non-critical — don't fail message sending if tracking fails
            console.error('[ChatService] Error tracking message metrics:', error);
        }
    }
    /**
     * Mark all unread messages in a match as read (for the given user, mark messages from the OTHER user).
     */
    static async markAsRead(matchId: string, userId: string, messageIds?: string[]) {
        await MatchAccessService.requireActiveMatch(userId, matchId);
        // Read in the chat, so read in the notification centre too.
        NotificationFeedService.readWhere(userId, ['message', 'reaction', 'match'], { path: 'matchId', equals: matchId });
        if (messageIds && messageIds.length > 100)
            throw new HttpError(400, 'A maximum of 100 messages can be marked', 'TOO_MANY_MESSAGE_IDS');
        const now = new Date();
        const result = await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 1))`;
            // Reading the chat is what clears Telegram's manual "mark as unread",
            // even when there is nothing new, so this runs before the early return.
            await tx.chatParticipant.updateMany({ where: { matchId, userId, markedUnread: true }, data: { markedUnread: false } });
            const messages = await tx.message.findMany({
                where: {
                    matchId,
                    senderId: { not: userId },
                    readAt: null,
                    isDeleted: false,
                    NOT: { hiddenBy: { has: userId } },
                    ...(messageIds ? { id: { in: [...new Set(messageIds)] } } : {}),
                },
                select: { id: true, messageSeq: true },
            });
            if (!messages.length)
                return { markedCount: 0 };
            const ids = messages.map((message) => message.id);
            await Promise.all([
                tx.message.updateMany({ where: { id: { in: ids }, readAt: null }, data: { readAt: now } }),
                tx.messageReceipt.updateMany({
                    where: { messageId: { in: ids }, recipientId: userId, readAt: null },
                    data: { readAt: now },
                }),
            ]);
            // Delivery is recorded separately so reading a message never
            // overwrites an earlier, truthful delivery time.
            await tx.messageReceipt.updateMany({
                where: { messageId: { in: ids }, recipientId: userId, deliveredAt: null },
                data: { deliveredAt: now },
            });
            const maxSeq = Math.max(0, ...messages.map((message) => message.messageSeq ?? 0));
            const previous = await tx.chatParticipant.findUnique({ where: { matchId_userId: { matchId, userId } } });
            // Recount from authoritative rows rather than zeroing: a partial
            // read must leave the remaining messages unread.
            const unreadCount = await tx.message.count({
                where: {
                    matchId,
                    senderId: { not: userId },
                    readAt: null,
                    isDeleted: false,
                    NOT: { hiddenBy: { has: userId } },
                },
            });
            // Progress markers are monotonic: an out-of-order receipt for an
            // older message must not move them backwards.
            const progress = {
                unreadCount,
                lastReadMessageSeq: Math.max(previous?.lastReadMessageSeq ?? 0, maxSeq),
                lastDeliveredMessageSeq: Math.max(previous?.lastDeliveredMessageSeq ?? 0, maxSeq),
            };
            await tx.chatParticipant.upsert({
                where: { matchId_userId: { matchId, userId } },
                create: { matchId, userId, ...progress },
                update: progress,
            });
            await ChatEventService.append(tx, {
                matchId,
                type: 'messages.read',
                actorId: userId,
                entityId: messages[messages.length - 1].id,
                audienceUserId: undefined,
                payload: { userId, messageIds: ids, throughMessageSeq: maxSeq, readAt: now.toISOString() },
            });
            return { markedCount: messages.length, throughMessageSeq: maxSeq, readAt: now };
        });
        // Read here: its notifications leave the status bar on this person's
        // other phones too (NOTIFICATIONS_PLAN.md 10).
        if ((result as { markedCount?: number }).markedCount)
            void PushService.clear(userId, { matchId }).catch(() => undefined);
        return result;
    }
    static async markDelivered(matchId: string, userId: string, messageIds: string[]) {
        await MatchAccessService.requireActiveMatch(userId, matchId);
        if (!messageIds.length || messageIds.length > 100)
            throw new HttpError(400, 'Provide 1 to 100 message identifiers', 'INVALID_MESSAGE_IDS');
        const now = new Date();
        return prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 1))`;
            const pendingReceipts = await tx.messageReceipt.findMany({
                where: { messageId: { in: [...new Set(messageIds)] }, recipientId: userId, deliveredAt: null },
                select: { messageId: true },
            });
            const messages = await tx.message.findMany({
                where: { id: { in: pendingReceipts.map((item) => item.messageId) }, matchId, senderId: { not: userId } },
                select: { id: true, messageSeq: true },
            });
            if (!messages.length)
                return { markedCount: 0, throughMessageSeq: 0 };
            const ids = messages.map((message) => message.id);
            await tx.messageReceipt.updateMany({
                where: { messageId: { in: ids }, recipientId: userId, deliveredAt: null },
                data: { deliveredAt: now },
            });
            const maxSeq = Math.max(0, ...messages.map((message) => message.messageSeq ?? 0));
            const previous = await tx.chatParticipant.findUnique({ where: { matchId_userId: { matchId, userId } } });
            // Monotonic: acknowledging an older message must not rewind progress.
            const lastDeliveredMessageSeq = Math.max(previous?.lastDeliveredMessageSeq ?? 0, maxSeq);
            await tx.chatParticipant.upsert({
                where: { matchId_userId: { matchId, userId } },
                create: { matchId, userId, lastDeliveredMessageSeq },
                update: { lastDeliveredMessageSeq },
            });
            await ChatEventService.append(tx, {
                matchId,
                type: 'messages.delivered',
                actorId: userId,
                entityId: messages[messages.length - 1]?.id ?? matchId,
                payload: { userId, messageIds: ids, throughMessageSeq: maxSeq, deliveredAt: now.toISOString() },
            });
            return { markedCount: ids.length, throughMessageSeq: maxSeq };
        });
    }
    /**
     * A voice note was listened to (MESSAGE_NOTIFICATIONS_PLAN.md 7): the
     * sender's blue microphone, like WhatsApp's. Once per note and listener;
     * playing it again changes nothing.
     */
    static async markPlayed(matchId: string, userId: string, messageId: string) {
        await MatchAccessService.requireActiveMatch(userId, matchId);
        const now = new Date();
        return prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 1))`;
            const message = await tx.message.findFirst({
                where: { id: messageId, matchId, type: 'voice', isDeleted: false, senderId: { not: userId } },
                select: { id: true },
            });
            if (!message) throw new HttpError(404, 'Voice message is unavailable', 'VOICE_MESSAGE_UNAVAILABLE');
            const { count } = await tx.messageReceipt.updateMany({
                where: { messageId, recipientId: userId, playedAt: null },
                data: { playedAt: now },
            });
            if (!count) return { played: false };
            await ChatEventService.append(tx, {
                matchId, type: 'message.played', actorId: userId, entityId: messageId,
                payload: { userId, messageId, playedAt: now.toISOString() },
            });
            return { played: true, playedAt: now };
        });
    }
    /**
     * Soft delete a message. Assumes validation is done.
     */
    static async deleteMessage(matchId: string, messageId: string, userId: string, mode: 'me' | 'everyone' = 'everyone') {
        if (mode !== 'me' && mode !== 'everyone') {
            throw new HttpError(400, 'Delete mode is invalid', 'INVALID_DELETE_MODE');
        }
        const msg = await MatchAccessService.requireMessage(userId, matchId, messageId);
        if (mode === 'everyone') {
            if (msg.senderId !== userId) {
                throw new HttpError(403, 'Only the sender can delete this message for everyone', 'MESSAGE_DELETE_FORBIDDEN');
            }
            if (Date.now() - msg.sentAt.getTime() > 15 * 60000) {
                throw new HttpError(409, 'The delete window has expired', 'MESSAGE_DELETE_WINDOW_EXPIRED');
            }
            return prisma.$transaction(async (tx) => {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 1))`;
                const updated = await tx.message.update({
                    where: { id: messageId },
                    data: { isDeleted: true, content: '', mediaKeys: [], photoUrl: null, deletedForEveryoneAt: new Date(), revision: { increment: 1 } },
                });
                await ChatEventService.append(tx, {
                    matchId, type: 'message.deleted', actorId: userId, entityId: messageId,
                    entityRevision: updated.revision, payload: { messageId, mode: 'everyone', revision: updated.revision },
                });
                return updated;
            });
        }
        else {
            return prisma.$transaction(async (tx) => {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 1))`;
                await tx.messageVisibility.upsert({
                    where: { messageId_userId: { messageId, userId } },
                    create: { messageId, userId },
                    update: {},
                });
                const currentHiddenBy = msg.hiddenBy || [];
                if (!currentHiddenBy.includes(userId)) {
                    await tx.message.update({ where: { id: messageId }, data: { hiddenBy: { push: userId } } });
                }
                await ChatEventService.append(tx, {
                    matchId, type: 'message.hidden', actorId: userId, entityId: messageId, audienceUserId: userId,
                    payload: { messageId, mode: 'me' },
                });
                return msg;
            });
        }
    }
    /**
     * Edit a message text.
     */
    static async updateMessage(matchId: string, messageId: string, userId: string, content: string, expectedRevision?: number) {
        const msg = await MatchAccessService.requireMessage(userId, matchId, messageId);
        if (!msg || msg.senderId !== userId) {
            throw new HttpError(403, 'Only the sender can edit this message', 'MESSAGE_EDIT_FORBIDDEN');
        }
        if (msg.isDeleted) {
            throw new HttpError(409, 'A deleted message cannot be edited', 'MESSAGE_DELETED');
        }
        const cleaned = content?.trim();
        if (!cleaned || cleaned.length > 2000)
            throw new HttpError(400, 'Message content must contain 1 to 2000 characters', 'INVALID_MESSAGE_CONTENT');
        if (Date.now() - msg.sentAt.getTime() > 15 * 60000) {
            throw new HttpError(409, 'The edit window has expired', 'MESSAGE_EDIT_WINDOW_EXPIRED');
        }
        return prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 1))`;
            const current = await tx.message.findUniqueOrThrow({ where: { id: messageId }, select: { revision: true, isDeleted: true } });
            if (current.isDeleted) throw new HttpError(409, 'A deleted message cannot be edited', 'MESSAGE_DELETED');
            if (expectedRevision !== undefined && current.revision !== expectedRevision) {
                throw new HttpError(409, 'The message changed on another device', 'REVISION_CONFLICT');
            }
            const result = await tx.message.update({
                where: { id: messageId },
                data: { content: cleaned, editedAt: new Date(), revision: { increment: 1 } },
            });
            await ChatEventService.append(tx, {
                matchId, type: 'message.edited', actorId: userId, entityId: messageId,
                entityRevision: result.revision, payload: { messageId, revision: result.revision },
            });
            return result;
        });
    }
    static getEvents(userId: string, matchId: string, afterSeq?: number, limit?: number) {
        return ChatEventService.list(userId, matchId, afterSeq, limit);
    }
    static async setReaction(matchId: string, messageId: string, userId: string, emoji: string | null) {
        const target = await MatchAccessService.requireMessage(userId, matchId, messageId);
        if (emoji !== null && !isSingleEmoji(emoji))
            throw new HttpError(400, 'Reaction must be a single emoji', 'INVALID_REACTION');
        // Service notices ("auto-delete turned on") are not messages anyone wrote,
        // and Telegram offers no reactions on them.
        if (target.isDeleted || target.type === 'service')
            throw new HttpError(409, 'This message cannot be reacted to', 'REACTION_NOT_ALLOWED');
        return prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 1))`;
            let revision = 1;
            if (emoji === null) {
                const current = await tx.messageReaction.findUnique({ where: { messageId_userId: { messageId, userId } } });
                revision = (current?.revision ?? 0) + 1;
                await tx.messageReaction.deleteMany({ where: { messageId, userId } });
            }
            else {
                const reaction = await tx.messageReaction.upsert({
                    where: { messageId_userId: { messageId, userId } },
                    create: { messageId, userId, emoji },
                    update: { emoji, revision: { increment: 1 } },
                });
                revision = reaction.revision;
            }
            const event = await ChatEventService.append(tx, {
                matchId, type: emoji === null ? 'reaction.removed' : 'reaction.set', actorId: userId,
                entityId: messageId, entityRevision: revision, payload: { messageId, userId, emoji, revision },
            });
            // Telegram tells the author when someone reacts to their message. The
            // delivery re-checks that this is still the standing reaction, so a quick
            // change of mind only announces what the author will actually see.
            if (emoji !== null && target.senderId !== userId) {
                await OutboxService.enqueue(tx, {
                    topic: OUTBOX_TOPICS.REACTION_ADDED,
                    aggregateId: messageId,
                    deduplicationKey: `reaction.added:${messageId}:${userId}:${revision}`,
                    payload: { reactorId: userId, emoji, revision },
                });
            }
            return { messageId, userId, emoji, revision, eventSeq: event.eventSeq };
        });
    }
    /**
     * Who reacted, and with what: Telegram's reacted-users list.
     *
     * A private chat holds at most two reactions (one each), so there is nothing
     * to page through; the per-emoji counts still drive the filter tabs.
     */
    static async listReactions(matchId: string, messageId: string, userId: string) {
        const message = await MatchAccessService.requireMessage(userId, matchId, messageId);
        if (message.isDeleted || message.hiddenBy.includes(userId))
            throw new HttpError(404, 'Message is unavailable', 'MESSAGE_UNAVAILABLE');
        const rows = await prisma.messageReaction.findMany({
            where: { messageId },
            orderBy: [{ updatedAt: 'desc' }, { userId: 'asc' }],
            select: { userId: true, emoji: true, updatedAt: true },
        });
        const users = rows.length
            ? await prisma.user.findMany({
                where: { id: { in: rows.map((row) => row.userId) } },
                select: { id: true, name: true, avatarUrl: true, photos: { where: { isPrimary: true }, select: { photoUrl: true }, take: 1 } },
            })
            : [];
        const byId = new Map(users.map((user) => [user.id, user]));
        const counts = new Map<string, number>();
        for (const row of rows) counts.set(row.emoji, (counts.get(row.emoji) ?? 0) + 1);
        return {
            total: rows.length,
            counts: [...counts.entries()].map(([emoji, count]) => ({ emoji, count })).sort((a, b) => b.count - a.count),
            reactors: rows.map((row) => {
                const user = byId.get(row.userId);
                return {
                    userId: row.userId,
                    name: user?.name ?? 'Unknown',
                    avatar: user?.avatarUrl || user?.photos[0]?.photoUrl || null,
                    emoji: row.emoji,
                    reactedAt: row.updatedAt,
                };
            }),
        };
    }
    static async setMuted(matchId: string, userId: string, mutedUntil: Date | null) {
        await MatchAccessService.requireActiveMatch(userId, matchId);
        const result = await prisma.chatParticipant.upsert({
            where: { matchId_userId: { matchId, userId } },
            create: { matchId, userId, mutedUntil },
            update: { mutedUntil },
            select: { matchId: true, mutedUntil: true },
        });
        // Muted: its notification leaves this person's phones (MESSAGE_NOTIFICATIONS_PLAN.md 9).
        if (mutedUntil && mutedUntil > new Date()) void PushService.clear(userId, { matchId }).catch(() => undefined);
        return result;
    }
    static async searchMessages(matchId: string, userId: string, query: string, limit = 50) {
        await MatchAccessService.requireActiveMatch(userId, matchId);
        const { clearedFilter, notExpired } = await this.visibilityFor(matchId, userId);
        const cleaned = query.trim();
        if (cleaned.length < 2 || cleaned.length > 100)
            throw new HttpError(400, 'Search text must contain 2 to 100 characters', 'INVALID_MESSAGE_SEARCH');
        const hidden = await prisma.messageVisibility.findMany({ where: { userId }, select: { messageId: true } });
        return prisma.message.findMany({
            where: {
                matchId,
                isDeleted: false,
                id: { notIn: hidden.map((item) => item.messageId) },
                content: { contains: cleaned, mode: 'insensitive' },
                ...clearedFilter,
                AND: [notExpired],
            },
            orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
            take: Math.min(Math.max(limit, 1), 100),
            select: { id: true, matchId: true, senderId: true, content: true, sentAt: true, messageSeq: true, editedAt: true, revision: true },
        });
    }
    static async searchAllMessages(userId: string, query: string, limit = 50) {
        const cleaned = query.trim();
        if (cleaned.length < 2 || cleaned.length > 100)
            throw new HttpError(400, 'Search text must contain 2 to 100 characters', 'INVALID_MESSAGE_SEARCH');
        const matches = await prisma.match.findMany({ where: { status: 'active', OR: [{ user1Id: userId }, { user2Id: userId }] }, select: { id: true } });
        const hidden = await prisma.messageVisibility.findMany({ where: { userId }, select: { messageId: true } });
        const watermarks = await prisma.chatParticipant.findMany({
            where: { userId, matchId: { in: matches.map((item) => item.id) }, clearedThroughSeq: { gt: 0 } },
            select: { matchId: true, clearedThroughSeq: true },
        });
        const clearedByMatch = new Map(watermarks.map((row) => [row.matchId, row.clearedThroughSeq]));
        return prisma.message.findMany({
            where: {
                // Each chat is searched only past the point this user cleared it to.
                OR: matches.map((item) => ({
                    matchId: item.id,
                    ...(clearedByMatch.has(item.id) ? { messageSeq: { gt: clearedByMatch.get(item.id)! } } : {}),
                })),
                AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
                id: { notIn: hidden.map((item) => item.messageId) },
                isDeleted: false,
                content: { contains: cleaned, mode: 'insensitive' },
            },
            orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
            take: Math.min(Math.max(limit, 1), 100),
            select: { id: true, matchId: true, senderId: true, content: true, sentAt: true, messageSeq: true, editedAt: true, revision: true },
        });
    }
    static async messageContext(matchId: string, messageId: string, userId: string) {
        await MatchAccessService.requireActiveMatch(userId, matchId);
        const { clearedFilter, notExpired } = await this.visibilityFor(matchId, userId);
        const hidden = await prisma.messageVisibility.findUnique({ where: { messageId_userId: { messageId, userId } } });
        if (hidden)
            throw new HttpError(404, 'Message is unavailable', 'MESSAGE_UNAVAILABLE');
        const target = await prisma.message.findFirst({ where: { id: messageId, matchId, isDeleted: false, ...clearedFilter, AND: [notExpired] }, select: { messageSeq: true } });
        if (!target)
            throw new HttpError(404, 'Message is unavailable', 'MESSAGE_UNAVAILABLE');
        const invisible = await prisma.messageVisibility.findMany({ where: { userId }, select: { messageId: true } });
        const messages = await prisma.message.findMany({
            where: {
                matchId,
                isDeleted: false,
                id: { notIn: invisible.map((item) => item.messageId) },
                AND: [
                    notExpired,
                    clearedFilter,
                    target.messageSeq ? { messageSeq: { gte: Math.max(1, target.messageSeq - 15), lte: target.messageSeq + 15 } } : {},
                ],
            },
            orderBy: [{ messageSeq: 'asc' }, { sentAt: 'asc' }, { id: 'asc' }],
            take: 31,
        });
        const receipts = await prisma.messageReceipt.findMany({
            where: { messageId: { in: messages.map((message) => message.id) } },
            select: { messageId: true, deliveredAt: true, readAt: true, playedAt: true },
        });
        const receiptByMessage = new Map(receipts.map((receipt) => [receipt.messageId, receipt]));
        return messages.map((message) => ({
            ...message,
            mediaKey: message.photoUrl,
            mediaKeys: message.mediaKeys || [],
            photoUrl: undefined,
            deliveredAt: receiptByMessage.get(message.id)?.deliveredAt ?? null,
            playedAt: receiptByMessage.get(message.id)?.playedAt ?? null,
            readAt: message.readAt ?? receiptByMessage.get(message.id)?.readAt ?? null,
        }));
    }

    static async getSharedMessages(
        matchId: string,
        userId: string,
        type: 'media' | 'document' | 'voice' | 'link',
        cursor?: string,
        limit = 40,
    ) {
        await MatchAccessService.requireActiveMatch(userId, matchId);
        const { clearedFilter, notExpired } = await this.visibilityFor(matchId, userId);
        const take = Math.min(Math.max(limit, 1), 80);
        const hidden = await prisma.messageVisibility.findMany({ where: { userId }, select: { messageId: true } });
        // Links are URLs someone wrote: text and captions. Matching any content
        // containing "http" also caught voice notes and other attachments whose
        // content carries a URL, so the Links tab listed voice messages.
        const typeWhere = type === 'link'
            ? {
                type: { in: ['text', 'media', 'document', 'story_reply'] },
                OR: ['http://', 'https://', 'www.'].map((prefix) => ({
                    content: { contains: prefix, mode: Prisma.QueryMode.insensitive },
                })),
            }
            : { type };
        const messages = await prisma.message.findMany({
            where: {
                matchId,
                isDeleted: false,
                id: { notIn: hidden.map((item) => item.messageId) },
                ...typeWhere,
                ...clearedFilter,
                AND: [notExpired],
            },
            orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
            take: take + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            select: {
                id: true, matchId: true, senderId: true, content: true, sentAt: true,
                readAt: true, mediaKeys: true, photoUrl: true, type: true, metadata: true,
                replyToId: true, messageSeq: true, editedAt: true, revision: true,
            },
        });
        const hasMore = messages.length > take;
        const page = hasMore ? messages.slice(0, take) : messages;
        return {
            messages: page.map((message) => ({
                ...message,
                mediaKey: message.photoUrl,
                mediaKeys: message.mediaKeys || [],
                photoUrl: undefined,
            })),
            nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
            hasMore,
        };
    }
}
