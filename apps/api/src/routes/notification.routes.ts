import { Router } from 'express';
import { protect } from '../middlewares/auth.middleware';
import { NotificationService } from '../services/notification.service';
import { ApiResponse } from '../utils/ApiResponse';
import { PushService } from '../services/push.service';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { HttpError } from '../utils/httpError';
import { PushActionTokenService, protectPushAction } from '../services/push-action-token.service';
import { ChatNotificationService } from '../services/chat-notification.service';
import { ChatService } from '../services/chat.service';
import { FollowService } from '../services/follow.service';
import { NOTIFICATION_CATEGORIES, NotificationFeedService } from '../services/notification-feed.service';

const router = Router();
const deviceSchema = z.object({
  token: z.string().regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/).max(500),
  platform: z.enum(['ios', 'android']),
  // What this phone's app can do: "chat_v2" draws chat notifications itself (MESSAGE_NOTIFICATIONS_PLAN.md).
  capabilities: z.array(z.enum(['chat_v2'])).max(5).optional(),
  // The phone's own key for encrypted chat pushes: base64 of 32 bytes (MESSAGE_NOTIFICATIONS_PLAN.md 11).
  pushKey: z.string().max(64).optional(),
}).strict();

router.put('/devices', protect, async (req, res, next) => {
  try {
    const parsed = deviceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(ApiResponse.error('Invalid device token'));
    const input = parsed.data;
    const user = (req as any).user;
    await PushService.register(user.sub, input.token, input.platform, input.capabilities ?? [], input.pushKey);
    // The native notification code's own narrow token (push-action-token.service.ts).
    const pushActionToken = input.capabilities?.includes('chat_v2') && user.jti
      ? await PushActionTokenService.issue(user.sub, user.jti, input.token) : null;
    res.status(200).json(ApiResponse.success({ pushActionToken }));
  } catch (error) { next(error); }
});

router.delete('/devices', protect, async (req, res, next) => {
  try {
    const parsed = deviceSchema.pick({ token: true }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json(ApiResponse.error('Invalid device token'));
    const input = parsed.data;
    await PushService.unregister((req as any).user.sub, input.token);
    res.status(204).send();
  } catch (error) { next(error); }
});

/**
 * POST /notifications/opened - a push was tapped, or one of its buttons
 * (NOTIFICATIONS_PLAN.md 13). Counts opens per line; resets the back-off.
 */
router.post('/opened', protect, async (req, res, next) => {
  try {
    const parsed = z.object({ pushId: z.string().uuid(), action: z.string().max(40).optional() }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json(ApiResponse.error('Invalid push'));
    res.status(200).json(ApiResponse.success(await PushService.opened((req as any).user.sub, parsed.data.pushId, parsed.data.action)));
  } catch (error) { next(error); }
});

const pushId = z.string().uuid().optional();
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reply'), matchId: z.string().uuid(), text: z.string().trim().min(1).max(2000), pushId }).strict(),
  z.object({ action: z.literal('read'), matchId: z.string().uuid(), pushId }).strict(),
  z.object({ action: z.enum(['accept', 'decline']), followId: z.string().uuid(), pushId }).strict(),
  z.object({ action: z.literal('mine'), pushId }).strict(),
]);

/**
 * POST /notifications/action - a notification button pressed without opening
 * the app (NOTIFICATIONS_PLAN.md 8): Reply, Mark as read, Accept, Decline,
 * "It was me". Every rule is checked again here; a chat that ended or a
 * request already answered gets a polite refusal the app shows.
 */
router.post('/action', protect, async (req, res, next) => {
  try {
    const parsed = actionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(ApiResponse.error('Invalid action'));
    const userId = (req as any).user.sub as string;
    const input = parsed.data;
    if (input.pushId) void PushService.opened(userId, input.pushId, input.action).catch(() => undefined);
    try {
      if (input.action === 'reply') {
        // One reply per tap, even if the phone retries the request.
        const clientMessageId = `push:${input.pushId ?? randomUUID()}`;
        await ChatService.sendMessage(userId, input.matchId, input.text, undefined, undefined, clientMessageId);
        await ChatService.markAsRead(input.matchId, userId).catch(() => undefined);
      } else if (input.action === 'read') {
        await ChatService.markAsRead(input.matchId, userId);
      } else if (input.action === 'accept' || input.action === 'decline') {
        await FollowService.respond(userId, input.followId, input.action === 'accept');
      }
    } catch (error) {
      const known = error instanceof HttpError ? error : null;
      // A limit says what it is (verify to keep chatting); anything else about
      // the chat or request means it's gone.
      if (known && ['PROFILE_PAUSED', 'VERIFY_TO_CHAT', 'FOLLOW_LIMIT_UNVERIFIED'].includes(known.code)) {
        return res.status(known.status).json(ApiResponse.error(known.message, known.code));
      }
      if ((known && known.status < 500) || /not part of this match/i.test((error as Error).message)) {
        const message = input.action === 'accept' || input.action === 'decline'
          ? 'This request is no longer available.' : 'This chat is no longer available.';
        return res.status(409).json(ApiResponse.error(message, 'NOTIFICATION_ACTION_UNAVAILABLE'));
      }
      throw error;
    }
    res.status(200).json(ApiResponse.success({ done: true }));
  } catch (error) { next(error); }
});

// --- Native notification actions (MESSAGE_NOTIFICATIONS_PLAN.md 7, 8, 13) ---
// Called by the phone's Kotlin code with the push action token, app closed or not.
const native = Router();
native.use(protectPushAction);
const matchParam = z.object({ matchId: z.string().uuid() });

/** Reply from the notification: one message per tap, however often the phone retries. */
native.post('/reply', async (req, res, next) => {
  try {
    const input = matchParam.extend({ text: z.string().trim().min(1).max(2000), clientMessageId: z.string().min(8).max(100) }).strict().parse(req.body);
    const userId = (req as any).user.sub as string;
    const message = await ChatService.sendMessage(userId, input.matchId, input.text, undefined, undefined, `native:${input.clientMessageId}`);
    await ChatService.markAsRead(input.matchId, userId).catch(() => undefined);
    res.json(ApiResponse.success({ messageId: message.id, sentAt: message.sentAt }));
  } catch (error) { next(error); }
});
native.post('/read', async (req, res, next) => {
  try {
    const { matchId } = matchParam.strict().parse(req.body);
    res.json(ApiResponse.success(await ChatService.markAsRead(matchId, (req as any).user.sub)));
  } catch (error) { next(error); }
});
/** The grey double tick: the phone has the message (13). */
native.post('/delivered', async (req, res, next) => {
  try {
    const input = matchParam.extend({ messageIds: z.array(z.string().uuid()).min(1).max(100) }).strict().parse(req.body);
    res.json(ApiResponse.success(await ChatService.markDelivered(input.matchId, (req as any).user.sub, input.messageIds)));
  } catch (error) { next(error); }
});
native.post('/played', async (req, res, next) => {
  try {
    const input = matchParam.extend({ messageId: z.string().uuid() }).strict().parse(req.body);
    res.json(ApiResponse.success(await ChatService.markPlayed(input.matchId, (req as any).user.sub, input.messageId)));
  } catch (error) { next(error); }
});
/** A short-lived link to a voice note, for the player in the status bar (7). */
native.post('/voice-url', async (req, res, next) => {
  try {
    const input = matchParam.extend({ messageId: z.string().uuid() }).strict().parse(req.body);
    res.json(ApiResponse.success(await ChatNotificationService.voiceUrl((req as any).user.sub, input.matchId, input.messageId)));
  } catch (error) { next(error); }
});
native.post('/opened', async (req, res, next) => {
  try {
    const input = z.object({ pushId: z.string().uuid(), action: z.string().max(40).optional() }).strict().parse(req.body);
    res.json(ApiResponse.success(await PushService.opened((req as any).user.sub, input.pushId, input.action)));
  } catch (error) { next(error); }
});
native.use((error: unknown, _req: any, res: any, next: any) => {
  if (error instanceof z.ZodError) return res.status(400).json(ApiResponse.error('Invalid request'));
  if (error instanceof HttpError) return res.status(error.status).json(ApiResponse.error(error.message, error.code));
  next(error);
});
router.use('/native', native);

const feedSchema = z.object({
  cursor: z.string().max(120).optional(),
  category: z.enum(NOTIFICATION_CATEGORIES).optional(),
  limit: z.coerce.number().int().min(1).max(60).optional(),
});

/** GET /notifications/feed — the notification centre: who from, where to, unread counts. */
router.get('/feed', protect, async (req, res, next) => {
  try {
    const parsed = feedSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json(ApiResponse.error('Invalid notification filters'));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(ApiResponse.success(await NotificationFeedService.feed((req as any).user.sub, parsed.data)));
  } catch (error) { next(error); }
});

/** GET /notifications/unread — the bell's badge, in total and per category. */
router.get('/unread', protect, async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(ApiResponse.success(await NotificationFeedService.unread((req as any).user.sub)));
  } catch (error) { next(error); }
});

/** POST /notifications/read — mark these (one row, or a whole stack) read. */
router.post('/read', protect, async (req, res, next) => {
  try {
    const parsed = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json(ApiResponse.error('Invalid notification ids'));
    res.status(200).json(ApiResponse.success(await NotificationFeedService.markRead((req as any).user.sub, parsed.data.ids)));
  } catch (error) { next(error); }
});

const idsSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) });

/** POST /notifications/unread — put these back as unread (a long-press on a row). */
router.post('/unread', protect, async (req, res, next) => {
  try {
    const parsed = idsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(ApiResponse.error('Invalid notification ids'));
    res.status(200).json(ApiResponse.success(await NotificationFeedService.markUnread((req as any).user.sub, parsed.data.ids)));
  } catch (error) { next(error); }
});

/** POST /notifications/remove — take these off the list (a row, or a stack). */
router.post('/remove', protect, async (req, res, next) => {
  try {
    const parsed = idsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(ApiResponse.error('Invalid notification ids'));
    res.status(200).json(ApiResponse.success(await NotificationFeedService.remove((req as any).user.sub, parsed.data.ids)));
  } catch (error) { next(error); }
});

/** POST /notifications/read-all — every unread one, or one category's. */
router.post('/read-all', protect, async (req, res, next) => {
  try {
    const parsed = z.object({ category: z.enum(NOTIFICATION_CATEGORIES).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(ApiResponse.error('Invalid category'));
    res.status(200).json(ApiResponse.success(await NotificationFeedService.markAll((req as any).user.sub, parsed.data.category)));
  } catch (error) { next(error); }
});

/**
 * GET /notifications — Get paginated notifications for the current user.
 */
router.get('/', protect, async (req, res, next) => {
  try {
    const userId = (req as any).user.sub;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const result = await NotificationService.getNotifications(userId, page, limit);
    res.status(200).json(ApiResponse.success(result));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /notifications/unread-count — Get unread notification count (for badge).
 */
router.get('/unread-count', protect, async (req, res, next) => {
  try {
    const userId = (req as any).user.sub;
    const count = await NotificationService.getUnreadCount(userId);
    res.status(200).json(ApiResponse.success({ unreadCount: count }));
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /notifications/:id/read — Mark a single notification as read.
 */
router.patch('/:id/read', protect, async (req, res, next) => {
  try {
    const userId = (req as any).user.sub;
    const id = req.params.id as string;
    await NotificationService.markAsRead(id, userId);
    res.status(200).json(ApiResponse.success(null, 'Notification marked as read'));
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /notifications/read-all — Mark all notifications as read.
 */
router.patch('/read-all', protect, async (req, res, next) => {
  try {
    const userId = (req as any).user.sub;
    await NotificationService.markAllAsRead(userId);
    res.status(200).json(ApiResponse.success(null, 'All notifications marked as read'));
  } catch (error) {
    next(error);
  }
});

export default router;
