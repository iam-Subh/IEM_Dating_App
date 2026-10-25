import { corsOrigin } from './utils/corsOrigin';
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
import { SearchPeopleService } from './services/search-people.service';
import { setPresenceServer } from './services/presence.service';

let ioInstance: Server | null = null;
let socketPubClient: Redis | null = null;
let socketSubClient: Redis | null = null;

export const getIO = () => ioInstance;

export const disconnectUserSockets = (userId: string) => {
  ioInstance?.in(`user:${userId}`).disconnectSockets(true);
};

/** Drops only the live connections of these sessions - one signed-out device, not all of them. */
export const disconnectSessionSockets = async (userId: string, jtis: string[]) => {
  if (!ioInstance || !jtis.length) return;
  const wanted = new Set(jtis);
  const sockets = await ioInstance.in(`user:${userId}`).fetchSockets();
  for (const socket of sockets) {
    if (wanted.has((socket.data as { jti?: string } | undefined)?.jti ?? '')) socket.disconnect(true);
  }
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
    cors: { origin: corsOrigin() },
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
  setPresenceServer(io);

  // Authentication middleware
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    try {
      const decoded = await AccessSessionService.authenticate(token);
      await requireSocketDatingEligibility(decoded.sub);
      (socket as any).user = decoded;
      // Which session this connection belongs to (Active sessions signs one out).
      socket.data.jti = decoded.jti;
      socket.data.userId = decoded.sub;
      next();
    } catch (err) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const established = (socket as any).user as { sub: string; jti: string; sv: number };
    const userId = established?.sub;
    logger.info('Socket connected');
    let activeMatchIds: string[] = [];
    let sharesPresence = true;

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
        const [matches, user] = await Promise.all([
          prisma.match.findMany({
            where: {
              status: 'active',
              OR: [
                { user1Id: userId },
                { user2Id: userId },
              ],
            },
            select: { id: true },
          }),
          prisma.user.findUnique({ where: { id: userId }, select: { showOnlineStatus: true } }),
        ]);
        sharesPresence = user?.showOnlineStatus !== false;

        // join() is asynchronous with the Redis adapter. Awaiting keeps a
        // client that emits immediately after connect from missing its rooms.
        await Promise.all(matches.map((match) => socket.join(match.id)));
        activeMatchIds = matches.map((match) => match.id);
        const userSockets = await io.in(`user:${userId}`).fetchSockets();
        if (userSockets.length === 1 && sharesPresence) {
          await prisma.user.update({ where: { id: userId }, data: { lastActiveAt: new Date() } });
          activeMatchIds.forEach((matchId) => socket.to(matchId).emit('presence_changed', { userId, online: true, lastSeenAt: null }));
        }
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

    // Live profile in Search (SEARCH_SPEC.md 5.1): while a person's social
    // layer is open, a change to their profile nudges this socket to re-read
    // it. One profile at a time, and only one this viewer can find at all -
    // the same check as the search itself. The nudge carries nothing.
    let watchedProfile: string | null = null;
    socket.on('watch_profile', async (targetId: unknown, callback?: (response: any) => void) => {
      try {
        if (!userId) throw new Error('Not authenticated');
        if (watchedProfile) {
          await socket.leave(`profile-watch:${watchedProfile}`);
          watchedProfile = null;
        }
        if (targetId === null || targetId === undefined || targetId === '') {
          callback?.({ success: true });
          return;
        }
        if (typeof targetId !== 'string' || !/^[0-9a-f-]{36}$/i.test(targetId)) throw new Error('Invalid profile');
        const person = await SearchPeopleService.person(userId, targetId);
        if (!person) throw new Error('Unavailable');
        await socket.join(`profile-watch:${targetId}`);
        watchedProfile = targetId;
        callback?.({ success: true });
      } catch {
        callback?.({ success: false });
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
      } catch (err) {
        logger.error('Error marking messages as read:', err);
      }
    });

    // Typing indicators
    socket.on('typing_start', async (data: { matchId: string; activity?: 'typing' | 'recording' }) => {
      try {
        if (!userId) return;
        const match = await MatchAccessService.requireActiveMatch(userId, data.matchId);
        const peerId = match.user1Id === userId ? match.user2Id : match.user1Id;
        io.to(`user:${peerId}`).emit('typing_start', { senderId: userId, matchId: data.matchId, activity: data.activity === 'recording' ? 'recording' : 'typing' });
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

    socket.on('presence_query', async (data: { matchId: string; userId: string }, callback?: (response: any) => void) => {
      try {
        if (!userId) return;
        const match = await MatchAccessService.requireActiveMatch(userId, data.matchId);
        if (data.userId !== match.user1Id && data.userId !== match.user2Id) throw new Error('User is not in this match');
        const [sockets, user] = await Promise.all([
          io.in(`user:${data.userId}`).fetchSockets(),
          prisma.user.findUnique({ where: { id: data.userId }, select: { lastActiveAt: true, showOnlineStatus: true } }),
        ]);
        // Both ways: hiding your own activity status hides everyone else's from you.
        if (user?.showOnlineStatus === false || !sharesPresence) {
          callback?.({ success: true, online: false, lastSeenAt: null, hidden: true });
          return;
        }
        callback?.({
          success: true,
          // On screen: a connection that is not sitting in the background.
          online: sockets.some((entry) => !(entry.data as { background?: boolean })?.background),
          lastSeenAt: user?.lastActiveAt?.toISOString() ?? null,
          hidden: false,
        });
      } catch {
        callback?.({ success: false });
      }
    });

    socket.on('presence_privacy_changed', async (_data: unknown, callback?: (response: any) => void) => {
      try {
        if (!userId) return;
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { showOnlineStatus: true, lastActiveAt: true },
        });
        sharesPresence = user?.showOnlineStatus !== false;
        const sockets = sharesPresence ? await io.in(`user:${userId}`).fetchSockets() : [];
        const lastSeenAt = sharesPresence ? null : new Date();
        if (lastSeenAt) {
          await prisma.user.update({ where: { id: userId }, data: { lastActiveAt: lastSeenAt } });
        }
        activeMatchIds.forEach((matchId) => io.to(matchId).emit('presence_changed', {
          userId,
          online: sharesPresence && sockets.length > 0,
          lastSeenAt: lastSeenAt?.toISOString() ?? null,
          hidden: !sharesPresence,
        }));
        callback?.({ success: true });
      } catch {
        callback?.({ success: false });
      }
    });
    
    /**
     * The app on screen pings every 2 minutes: "last active" stays true to the
     * minute while it is open, and stops the moment it goes to the background.
     */
    socket.on('presence_heartbeat', async () => {
      try {
        if (!userId) return;
        const wasBackground = socket.data.background === true;
        socket.data.background = false;
        const fresh = await redisClient.set(`presence-heartbeat:${userId}`, '1', 'EX', 60, 'NX');
        if (fresh === 'OK') await prisma.user.updateMany({ where: { id: userId }, data: { lastActiveAt: new Date() } });
        if (wasBackground && sharesPresence) {
          activeMatchIds.forEach((matchId) => socket.to(matchId).emit('presence_changed', { userId, online: true, lastSeenAt: null }));
        }
      } catch {
        return;
      }
    });

    /** The app left the screen: still connected for messages, but not "online". */
    socket.on('presence_background', async () => {
      try {
        if (!userId) return;
        socket.data.background = true;
        const others = await io.in(`user:${userId}`).fetchSockets();
        if (others.some((entry) => !(entry.data as { background?: boolean })?.background)) return;
        const lastSeenAt = new Date();
        await prisma.user.updateMany({ where: { id: userId }, data: { lastActiveAt: lastSeenAt } });
        if (sharesPresence) {
          activeMatchIds.forEach((matchId) => io.to(matchId).emit('presence_changed', { userId, online: false, lastSeenAt: lastSeenAt.toISOString() }));
        }
      } catch {
        return;
      }
    });

    socket.on('typing_stop', async (data: { matchId: string }) => {
      try {
        if (!userId) return;
        const match = await MatchAccessService.requireActiveMatch(userId, data.matchId);
        const peerId = match.user1Id === userId ? match.user2Id : match.user1Id;
        io.to(`user:${peerId}`).emit('typing_stop', { senderId: userId, matchId: data.matchId });
      } catch {
        return;
      }
    });

    socket.on('disconnect', async () => {
      logger.info('Socket disconnected');
      if (!userId) return;
      try {
        const remaining = await io.in(`user:${userId}`).fetchSockets();
        if (remaining.length > 0) return;
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { showOnlineStatus: true } });
        if (user?.showOnlineStatus === false) return;
        const lastSeenAt = new Date();
        await prisma.user.updateMany({ where: { id: userId }, data: { lastActiveAt: lastSeenAt } });
        activeMatchIds.forEach((matchId) => io.to(matchId).emit('presence_changed', { userId, online: false, lastSeenAt: lastSeenAt.toISOString() }));
      } catch (error) {
        logger.error('Error updating disconnected presence:', error);
      }
    });
  });

  return io;
};
