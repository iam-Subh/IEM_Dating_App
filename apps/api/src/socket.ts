import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { redisClient } from './utils/redis';
import { Server as HttpServer } from 'http';
import { logger } from './utils/logger';
import { ChatService } from './services/chat.service';
import { prisma } from './utils/prisma';
import { MatchAccessService } from './services/match-access.service';
import { AccessSessionService } from './services/access-session.service';
import type Redis from 'ioredis';
import { requireSocketDatingEligibility } from './services/socket-dating-access.service';

let ioInstance: Server | null = null;
let socketPubClient: Redis | null = null;
let socketSubClient: Redis | null = null;

export const getIO = () => ioInstance;

export const disconnectUserSockets = (userId: string) => {
  ioInstance?.in(`user:${userId}`).disconnectSockets(true);
};

export const evictMatchRoom = (matchId: string) => {
  ioInstance?.in(matchId).socketsLeave(matchId);
};

export const closeSocket = async () => {
  const io = ioInstance;
  ioInstance = null;
  if (io) await new Promise<void>((resolve) => io.close(() => resolve()));
  const clients = [socketPubClient, socketSubClient].filter((client): client is Redis => !!client);
  socketPubClient = null;
  socketSubClient = null;
  await Promise.allSettled(clients.map((client) => client.quit()));
};

export const setupSocket = (httpServer: HttpServer) => {
  const io = new Server(httpServer, {
    cors: { origin: process.env.CORS_ORIGIN || '*' },
    // A 5s timeout under a 10s interval disconnected healthy phones on
    // congested mobile networks, and each disconnect forced a full replay.
    // These are the Socket.IO defaults.
    pingTimeout: 20000,
    pingInterval: 25000,
  });

  ioInstance = io;

  const pubClient = redisClient.duplicate();
  const subClient = redisClient.duplicate();
  socketPubClient = pubClient;
  socketSubClient = subClient;

  pubClient.on('error', (err) => logger.error('Redis pubClient error:', err.message));
  subClient.on('error', (err) => logger.error('Redis subClient error:', err.message));

  io.adapter(createAdapter(pubClient, subClient));

  // Authentication middleware
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    try {
      const decoded = await AccessSessionService.authenticate(token);
      await requireSocketDatingEligibility(decoded.sub);
      (socket as any).user = decoded;
      next();
    } catch (err) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const established = (socket as any).user as { sub: string; jti: string; sv: number };
    const userId = established?.sub;
    logger.info('Socket connected');

    socket.use(async (_event, next) => {
      try {
        await roomsReady;
        // Checks revocation, not token expiry. Re-verifying the frozen
        // handshake token disconnected every socket 15 minutes after connect.
        await AccessSessionService.authorizeEstablished(established);
        await requireSocketDatingEligibility(userId);
        next();
      } catch {
        socket.disconnect(true);
        next(new Error('Authentication error'));
      }
    });

    // Auto-join all of the user's active match rooms
    const roomsReady = (async () => { if (userId) {
      try {
        await socket.join(`user:${userId}`);
        const matches = await prisma.match.findMany({
          where: {
            status: 'active',
            OR: [
              { user1Id: userId },
              { user2Id: userId },
            ],
          },
          select: { id: true },
        });

        // join() is asynchronous with the Redis adapter. Awaiting keeps a
        // client that emits immediately after connect from missing its rooms.
        await Promise.all(matches.map((match) => socket.join(match.id)));
        logger.info('Socket joined its authorized match rooms');
      } catch (err) {
        logger.error('Error auto-joining match rooms:', err);
      }
    } })();

    // Manual room join (for new matches that happen while connected)
    socket.on('join_match_room', async (matchId: string, callback?: (response: any) => void) => {
      try {
        if (!userId) throw new Error('Not authenticated');
        await MatchAccessService.requireActiveMatch(userId, matchId);
        await socket.join(matchId);
        if (callback) callback({ success: true });
      } catch {
        if (callback) callback({ success: false, error: 'Match is unavailable' });
      }
    });

    // Send message via socket — saves to DB and broadcasts to the match room
    socket.on('send_message', async (data: { matchId: string; content: string; mediaKey?: string; mediaKeys?: string[]; clientMessageId?: string; type?: string; metadata?: Record<string, unknown>; replyToId?: string; storyId?: string }, callback?: (response: any) => void) => {
      try {
        if (!userId) throw new Error('Not authenticated');

        const message = await ChatService.sendMessage(userId, data.matchId, data.content, data.mediaKey, data.mediaKeys || [], data.clientMessageId, { type: data.type, metadata: data.metadata, replyToId: data.replyToId, storyId: data.storyId });

        // Acknowledge to the sender
        if (callback) callback({ success: true, message });
      } catch (err) {
        logger.error('Error sending message via socket:', err);
        // Surface the code so the client can drop permanently undeliverable
        // messages instead of retrying them until the queue stalls.
        const code = (err as { code?: string }).code ?? 'REQUEST_FAILED';
        if (callback) callback({ success: false, error: (err as Error).message, code });
      }
    });

    // Mark messages as read
    socket.on('message_read', async (data: { matchId: string; messageIds?: string[] }) => {
      try {
        if (!userId) return;
        await ChatService.markAsRead(data.matchId, userId, data.messageIds);
        // Notify the other user that messages have been read
        socket.to(data.matchId).emit('messages_read', { matchId: data.matchId, readBy: userId });
      } catch (err) {
        logger.error('Error marking messages as read:', err);
      }
    });

    // Typing indicators
    socket.on('typing_start', async (data: { matchId: string }) => {
      try {
        if (!userId) return;
        await MatchAccessService.requireActiveMatch(userId, data.matchId);
        socket.to(data.matchId).emit('typing_start', { senderId: userId, matchId: data.matchId });
      } catch {
        return;
      }
    });

    socket.on('messages_delivered', async (data: { matchId: string; messageIds: string[] }) => {
      try {
        if (!userId) return;
        await ChatService.markDelivered(data.matchId, userId, data.messageIds);
      } catch (err) {
        logger.error('Error marking messages as delivered:', err);
      }
    });
    
    socket.on('typing_stop', async (data: { matchId: string }) => {
      try {
        if (!userId) return;
        await MatchAccessService.requireActiveMatch(userId, data.matchId);
        socket.to(data.matchId).emit('typing_stop', { senderId: userId, matchId: data.matchId });
      } catch {
        return;
      }
    });

    socket.on('disconnect', () => {
      logger.info('Socket disconnected');
    });
  });

  return io;
};
