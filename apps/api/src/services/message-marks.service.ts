import { prisma } from '../utils/prisma';
import { MatchAccessService } from './match-access.service';
import { HttpError } from '../utils/httpError';
import { ChatEventService } from './chat-event.service';
import { Prisma } from '@prisma/client';

export class MessageMarksService {
  private static async requireVisible(userId: string, matchId: string, messageId: string) {
    const message = await MatchAccessService.requireMessage(userId, matchId, messageId);
    const participant = await prisma.chatParticipant.findUnique({ where: { matchId_userId: { matchId, userId } }, select: { clearedThroughSeq: true } });
    if (message.isDeleted || message.hiddenBy.includes(userId)
      || (message.expiresAt && message.expiresAt <= new Date())
      || (message.messageSeq != null && message.messageSeq <= (participant?.clearedThroughSeq ?? 0))) {
      throw new HttpError(404, 'Message is unavailable', 'MESSAGE_UNAVAILABLE');
    }
  }
  static async get(userId: string, matchId: string, messageId: string) {
    await this.requireVisible(userId, matchId, messageId);
    const rows = await prisma.$queryRaw<{ kind: string }[]>`
      SELECT kind FROM chat_message_marks WHERE message_id = ${messageId}::uuid
      AND ((kind = 'star' AND scope_id = ${userId}::uuid) OR (kind = 'pin' AND scope_id = ${matchId}::uuid))`;
    return { starred: rows.some(row => row.kind === 'star'), pinned: rows.some(row => row.kind === 'pin') };
  }

  static async set(userId: string, matchId: string, messageId: string, kind: 'star' | 'pin', active: boolean) {
    await this.requireVisible(userId, matchId, messageId);
    const scopeId = kind === 'star' ? userId : matchId;
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 1))`;
      const message = await tx.message.findFirst({ where: { id: messageId, matchId, isDeleted: false,
        NOT: { hiddenBy: { has: userId } }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
      const participant = await tx.chatParticipant.findUnique({ where: { matchId_userId: { matchId, userId } }, select: { clearedThroughSeq: true } });
      if (!message || (message.messageSeq != null && message.messageSeq <= (participant?.clearedThroughSeq ?? 0))) {
        throw new HttpError(404, 'Message is unavailable', 'MESSAGE_UNAVAILABLE');
      }
      const changed = active
        ? await tx.$executeRaw`INSERT INTO chat_message_marks (message_id, scope_id, kind)
            VALUES (${messageId}::uuid, ${scopeId}::uuid, ${kind}) ON CONFLICT DO NOTHING`
        : await tx.$executeRaw`DELETE FROM chat_message_marks
            WHERE message_id = ${messageId}::uuid AND scope_id = ${scopeId}::uuid AND kind = ${kind}`;
      if (changed) await ChatEventService.append(tx, { matchId, actorId: userId, entityId: messageId,
        type: 'message.mark_changed', audienceUserId: kind === 'star' ? userId : undefined,
        payload: { messageId, kind, active } });
    });
    return this.get(userId, matchId, messageId);
  }

  static async list(userId: string, matchId: string, kind: 'star' | 'pin', before?: { at: Date; id: string }) {
    await MatchAccessService.requireActiveMatch(userId, matchId);
    const scopeId = kind === 'star' ? userId : matchId;
    return prisma.$queryRaw<{ id: string; content: string; markedAt: Date }[]>`
      SELECT m.id, m.content, m.match_id AS "matchId", m.sender_id AS "senderId", m.sent_at AS "sentAt",
        m.type, m.media_keys AS "mediaKeys", m.photo_url AS "mediaKey", m.metadata,
        m.edited_at AS "editedAt", m.expires_at AS "expiresAt", mark.created_at AS "markedAt"
      FROM chat_message_marks mark JOIN messages m ON m.id = mark.message_id
      WHERE mark.scope_id = ${scopeId}::uuid AND mark.kind = ${kind} AND m.match_id = ${matchId}::uuid
      AND m.is_deleted = false AND NOT (${userId} = ANY(m.hidden_by))
      AND (m.expires_at IS NULL OR m.expires_at > NOW())
      AND (m.message_seq IS NULL OR m.message_seq > COALESCE(
        (SELECT cleared_through_seq FROM chat_participants WHERE match_id = ${matchId}::uuid AND user_id = ${userId}::uuid), 0))
      ${before ? Prisma.sql`AND (mark.created_at, m.id) < (${before.at}, ${before.id}::uuid)` : Prisma.empty}
      ORDER BY mark.created_at DESC, m.id DESC LIMIT 100`;
  }
}
