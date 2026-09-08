import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { MatchAccessService } from './match-access.service';

type AccountEventInput = {
  userIds: string[];
  type: 'conversation.updated' | 'access.revoked';
  matchId?: string;
  payload?: Prisma.InputJsonValue;
};

export class AccountEventService {
  static async append(tx: Prisma.TransactionClient, input: AccountEventInput) {
    const events = [];
    for (const userId of [...new Set(input.userIds)].sort()) {
      const user = await tx.user.update({
        where: { id: userId },
        data: { lastAccountEventSeq: { increment: 1 } },
        select: { lastAccountEventSeq: true },
      });
      events.push(await tx.accountEvent.create({
        data: {
          userId,
          accountSeq: user.lastAccountEventSeq,
          type: input.type,
          matchId: input.matchId,
          payload: input.payload ?? {},
        },
      }));
    }
    return events;
  }

  static async list(userId: string, afterSeq = 0, limit = 100) {
    if (!Number.isInteger(afterSeq) || afterSeq < 0) throw new HttpError(400, 'Account cursor is invalid', 'INVALID_ACCOUNT_CURSOR');
    const take = Math.min(Math.max(limit, 1), 200);
    const [events, user, earliest] = await Promise.all([
      prisma.accountEvent.findMany({ where: { userId, accountSeq: { gt: afterSeq } }, orderBy: { accountSeq: 'asc' }, take: take + 1 }),
      prisma.user.findUnique({ where: { id: userId }, select: { lastAccountEventSeq: true } }),
      prisma.accountEvent.findFirst({ where: { userId }, orderBy: { accountSeq: 'asc' }, select: { accountSeq: true } }),
    ]);
    const hasMore = events.length > take;
    const page = hasMore ? events.slice(0, take) : events;
    return {
      events: page,
      nextSeq: page[page.length - 1]?.accountSeq ?? afterSeq,
      highWaterSeq: user?.lastAccountEventSeq ?? 0,
      hasMore,
      resetRequired: afterSeq > 0 && !!earliest && afterSeq < earliest.accountSeq - 1,
    };
  }

  static async saveDeviceCursor(userId: string, matchId: string, deviceId: string, eventSeq: number) {
    await MatchAccessService.requireActiveMatch(userId, matchId);
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(deviceId) || !Number.isInteger(eventSeq) || eventSeq < 0) {
      throw new HttpError(400, 'Device cursor is invalid', 'INVALID_DEVICE_CURSOR');
    }
    const [current, session] = await Promise.all([
      prisma.chatDeviceCursor.findUnique({ where: { userId_deviceId_matchId: { userId, deviceId, matchId } } }),
      prisma.chatSession.findUnique({ where: { matchId }, select: { lastEventSeq: true } }),
    ]);
    if (eventSeq > (session?.lastEventSeq ?? 0)) throw new HttpError(409, 'Device cursor is ahead of the chat', 'DEVICE_CURSOR_AHEAD');
    return prisma.chatDeviceCursor.upsert({
      where: { userId_deviceId_matchId: { userId, deviceId, matchId } },
      create: { userId, deviceId, matchId, lastAppliedEventSeq: eventSeq },
      update: { lastAppliedEventSeq: Math.max(current?.lastAppliedEventSeq ?? 0, eventSeq) },
      select: { lastAppliedEventSeq: true, updatedAt: true },
    });
  }
}
