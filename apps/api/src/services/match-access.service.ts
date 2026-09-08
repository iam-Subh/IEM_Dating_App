import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';

export class MatchAccessService {
  static async requireActiveMatch(userId: string, matchId: string) {
    const match = await prisma.match.findFirst({
      where: {
        id: matchId,
        status: 'active',
        OR: [{ user1Id: userId }, { user2Id: userId }],
      },
      select: { id: true, user1Id: true, user2Id: true },
    });

    if (!match) {
      throw new HttpError(404, 'Match is unavailable', 'MATCH_UNAVAILABLE');
    }

    return match;
  }

  static async requireMessage(userId: string, matchId: string, messageId: string) {
    await this.requireActiveMatch(userId, matchId);
    const message = await prisma.message.findFirst({
      where: { id: messageId, matchId },
    });

    if (!message) {
      throw new HttpError(404, 'Message is unavailable', 'MESSAGE_UNAVAILABLE');
    }

    return message;
  }
}
