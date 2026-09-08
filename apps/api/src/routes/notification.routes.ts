import { Router } from 'express';
import { protect } from '../middlewares/auth.middleware';
import { NotificationService } from '../services/notification.service';
import { ApiResponse } from '../utils/ApiResponse';
import { PushService } from '../services/push.service';
import { z } from 'zod';

const router = Router();
const deviceSchema = z.object({
  token: z.string().regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/).max(500),
  platform: z.enum(['ios', 'android']),
}).strict();

router.put('/devices', protect, async (req, res, next) => {
  try {
    const parsed = deviceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(ApiResponse.error('Invalid device token'));
    const input = parsed.data;
    await PushService.register((req as any).user.sub, input.token, input.platform);
    res.status(204).send();
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
