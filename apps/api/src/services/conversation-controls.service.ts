import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { MatchAccessService } from './match-access.service';
import { ChatEventService } from './chat-event.service';
import { AccountEventService } from './account-event.service';
import { ChatService } from './chat.service';

/** Telegram's pinned-chat limit for a free account, counted per folder. */
export const MAX_PINNED_CONVERSATIONS = 5;

/** One minute to one year and a day, matching the database check. */
export const MESSAGE_TTL_LIMITS = { min: 60, max: 366 * 24 * 60 * 60 } as const;

type Tx = Prisma.TransactionClient;

/**
 * Per-user conversation actions, modelled on Telegram's dialog actions:
 * pin, archive, mark as unread, clear history, delete chat, and the shared
 * auto-delete setting.
 *
 * Mute already had an endpoint; its state is read back through `getSettings`.
 */
export class ConversationControlsService {
  /** Participant rows are created lazily by messaging; every control needs one. */
  private static ensureParticipant(tx: Tx, matchId: string, userId: string) {
    return tx.chatParticipant.upsert({
      where: { matchId_userId: { matchId, userId } },
      create: { matchId, userId },
      update: {},
    });
  }

  /** Makes this user's other signed-in devices refetch their chat list. */
  private static touchList(tx: Tx, matchId: string, userIds: string[], change: string) {
    return AccountEventService.append(tx, { userIds, type: 'conversation.updated', matchId, payload: { change } });
  }

  static async getSettings(userId: string, matchId: string) {
    await MatchAccessService.requireActiveMatch(userId, matchId);
    const [participant, match] = await Promise.all([
      prisma.chatParticipant.findUnique({
        where: { matchId_userId: { matchId, userId } },
        select: { mutedUntil: true, archivedAt: true, pinnedAt: true, markedUnread: true },
      }),
      prisma.match.findUniqueOrThrow({ where: { id: matchId }, select: { messageTtlSeconds: true } }),
    ]);
    const mutedUntil = participant?.mutedUntil ?? null;
    return {
      matchId,
      mutedUntil,
      muted: Boolean(mutedUntil && mutedUntil > new Date()),
      pinned: Boolean(participant?.pinnedAt),
      archived: Boolean(participant?.archivedAt),
      markedUnread: participant?.markedUnread ?? false,
      messageTtlSeconds: match.messageTtlSeconds,
    };
  }

  static async setPinned(userId: string, matchId: string, pinned: boolean) {
    await MatchAccessService.requireActiveMatch(userId, matchId);
    return prisma.$transaction(async (tx) => {
      // Serialise one user's pin changes: two taps on different chats could
      // otherwise both read "four pinned" and together exceed the limit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 7))`;
      const participant = await this.ensureParticipant(tx, matchId, userId);
      if (pinned && !participant.pinnedAt) {
        // Counted per folder as Telegram does, and only over live matches: a pin
        // left on an ended match would otherwise hold a slot nobody can see.
        const inArchive = participant.archivedAt !== null;
        const [{ count }] = await tx.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM chat_participants p
          JOIN matches m ON m.id = p.match_id
          WHERE p.user_id = ${userId}::uuid
            AND p.pinned_at IS NOT NULL
            AND m.status = 'active'
            AND p.match_id <> ${matchId}::uuid
            AND (p.archived_at IS NOT NULL) = ${inArchive}`;
        if (count >= MAX_PINNED_CONVERSATIONS) {
          throw new HttpError(409, `You can pin up to ${MAX_PINNED_CONVERSATIONS} chats`, 'PIN_LIMIT_REACHED');
        }
      }
      const updated = await tx.chatParticipant.update({
        where: { matchId_userId: { matchId, userId } },
        // Re-pinning keeps the original time, so repeated taps cannot reshuffle.
        data: { pinnedAt: pinned ? (participant.pinnedAt ?? new Date()) : null },
        select: { matchId: true, pinnedAt: true },
      });
      await this.touchList(tx, matchId, [userId], pinned ? 'pinned' : 'unpinned');
      return { matchId, pinned: Boolean(updated.pinnedAt), pinnedAt: updated.pinnedAt };
    });
  }

  static async setArchived(userId: string, matchId: string, archived: boolean) {
    await MatchAccessService.requireActiveMatch(userId, matchId);
    return prisma.$transaction(async (tx) => {
      const participant = await this.ensureParticipant(tx, matchId, userId);
      const changingFolder = archived !== (participant.archivedAt !== null);
      const updated = await tx.chatParticipant.update({
        where: { matchId_userId: { matchId, userId } },
        data: {
          archivedAt: archived ? (participant.archivedAt ?? new Date()) : null,
          // Each folder has its own pinned order, so moving between them unpins.
          ...(changingFolder ? { pinnedAt: null } : {}),
        },
        select: { matchId: true, archivedAt: true },
      });
      await this.touchList(tx, matchId, [userId], archived ? 'archived' : 'unarchived');
      return { matchId, archived: Boolean(updated.archivedAt) };
    });
  }

  static async setMarkedUnread(userId: string, matchId: string, unread: boolean) {
    await MatchAccessService.requireActiveMatch(userId, matchId);
    // Telegram's "Mark as read" reads the whole chat rather than only removing a
    // manual mark; markAsRead also clears that mark and notifies the sender.
    if (!unread) await ChatService.markAsRead(matchId, userId);
    return prisma.$transaction(async (tx) => {
      await this.ensureParticipant(tx, matchId, userId);
      const updated = await tx.chatParticipant.update({
        where: { matchId_userId: { matchId, userId } },
        data: { markedUnread: unread },
        select: { matchId: true, markedUnread: true },
      });
      await this.touchList(tx, matchId, [userId], unread ? 'marked_unread' : 'marked_read');
      return updated;
    });
  }

  /**
   * Telegram's "Clear history" and "Delete chat".
   *
   * No message rows are deleted. Clearing moves the user's watermark past the
   * newest message, so everything up to it disappears from their chat and list;
   * "for everyone" moves both participants'. Deleting also hides the chat until
   * something new is said in it. This is a dating app with safety reporting, and
   * tidying your own list must never destroy what the other person may need to
   * report.
   */
  static async clear(userId: string, matchId: string, options: { forEveryone: boolean; deleteChat: boolean }) {
    const match = await MatchAccessService.requireActiveMatch(userId, matchId);
    return prisma.$transaction(async (tx) => {
      // The same lock sending takes, so no message can be written between reading
      // the newest sequence and moving the watermark to it.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 1))`;
      const session = await tx.chatSession.findUnique({ where: { matchId }, select: { lastMessageSeq: true } });
      const throughSeq = session?.lastMessageSeq ?? 0;
      const targets = options.forEveryone ? [match.user1Id, match.user2Id] : [userId];
      const now = new Date();
      for (const target of targets) {
        await this.ensureParticipant(tx, matchId, target);
        await tx.chatParticipant.update({
          where: { matchId_userId: { matchId, userId: target } },
          data: {
            clearedThroughSeq: throughSeq,
            unreadCount: 0,
            markedUnread: false,
            ...(options.deleteChat ? { hiddenAt: now, pinnedAt: null } : {}),
          },
        });
      }
      const event = await ChatEventService.append(tx, {
        matchId,
        type: 'history.cleared',
        actorId: userId,
        entityId: matchId,
        audienceUserId: options.forEveryone ? undefined : userId,
        payload: { throughSeq, forEveryone: options.forEveryone, deleteChat: options.deleteChat },
      });
      return { matchId, throughSeq, forEveryone: options.forEveryone, deleteChat: options.deleteChat, eventSeq: event.eventSeq };
    });
  }

  /**
   * Telegram's "Auto-delete messages": a setting both people share.
   *
   * It applies to messages sent after it changes - each message is stamped with
   * its own deadline when sent - and the change itself is recorded in the chat
   * as a service notice, so both people can see when it started and who set it.
   */
  static async setMessageTtl(userId: string, matchId: string, seconds: number | null) {
    if (seconds !== null && (!Number.isInteger(seconds) || seconds < MESSAGE_TTL_LIMITS.min || seconds > MESSAGE_TTL_LIMITS.max)) {
      throw new HttpError(400, 'Auto-delete time is out of range', 'INVALID_MESSAGE_TTL');
    }
    await MatchAccessService.requireActiveMatch(userId, matchId);
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 1))`;
      const current = await tx.match.findUniqueOrThrow({ where: { id: matchId }, select: { messageTtlSeconds: true } });
      if ((current.messageTtlSeconds ?? null) === seconds) return { matchId, seconds, changed: false };

      await tx.match.update({ where: { id: matchId }, data: { messageTtlSeconds: seconds } });
      const session = await tx.chatSession.upsert({
        where: { matchId },
        create: { matchId, lastMessageAt: new Date(), lastMessageSeq: 1 },
        update: { lastMessageAt: new Date(), lastMessageSeq: { increment: 1 } },
        select: { lastMessageSeq: true },
      });
      // Not routed through sendMessage: a notice is not user content, is never
      // pushed, and must not count as unread.
      const notice = await tx.message.create({
        data: {
          senderId: userId,
          matchId,
          content: '',
          messageSeq: session.lastMessageSeq,
          type: 'service',
          metadata: { action: 'ttl.changed', seconds },
        },
        select: { id: true, messageSeq: true },
      });
      await ChatEventService.append(tx, {
        matchId, type: 'message.created', actorId: userId, entityId: notice.id,
        payload: { messageId: notice.id, messageSeq: notice.messageSeq ?? 0 },
      });
      await ChatEventService.append(tx, {
        matchId, type: 'conversation.ttl_changed', actorId: userId, entityId: matchId,
        payload: { seconds },
      });
      return { matchId, seconds, changed: true, noticeId: notice.id };
    });
  }
}
