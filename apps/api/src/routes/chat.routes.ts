import { ChatService } from '../services/chat.service';
import { Router } from 'express';
import { ChatController } from '../controllers/chat.controller';
import { protect } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import { archiveConversationSchema, clearConversationSchema, deleteMessageSchema, deviceCursorSchema, editMessageSchema, messageTtlSchema, muteSchema, pinConversationSchema, reactionSchema, receiptSchema, sendMessageSchema, unreadConversationSchema } from '../schemas/chat.schema';
import { requireDatingEligibility } from '../middlewares/dating.middleware';
import { MessageMarksService } from '../services/message-marks.service';
import { z } from 'zod';

const router = Router();
router.use(protect, requireDatingEligibility);

router.get('/:matchId/marks/:kind', async (req, res, next) => {
  try {
    const matchId = z.string().uuid().parse(req.params.matchId);
    const kind = z.enum(['star', 'pin']).parse(req.params.kind);
    const before = req.query.beforeAt || req.query.beforeId ? {
      at: new Date(z.string().datetime().parse(req.query.beforeAt)), id: z.string().uuid().parse(req.query.beforeId),
    } : undefined;
    res.json({ success: true, data: await MessageMarksService.list((req as any).user.sub, matchId, kind, before) });
  } catch (error) { next(error); }
});
router.get('/:matchId/messages/:messageId/marks', async (req, res, next) => {
  try {
    const matchId = z.string().uuid().parse(req.params.matchId);
    const messageId = z.string().uuid().parse(req.params.messageId);
    res.json({ success: true, data: await MessageMarksService.get((req as any).user.sub, matchId, messageId) });
  } catch (error) { next(error); }
});
router.put('/:matchId/messages/:messageId/marks', async (req, res, next) => {
  try {
    const matchId = z.string().uuid().parse(req.params.matchId);
    const messageId = z.string().uuid().parse(req.params.messageId);
    const { kind, active } = z.object({ kind: z.enum(['star', 'pin']), active: z.boolean() }).strict().parse(req.body);
    res.json({ success: true, data: await MessageMarksService.set((req as any).user.sub, matchId, messageId, kind, active) });
  } catch (error) { next(error); }
});

// GET /api/v1/chat/conversations — list all conversations for the authenticated user
router.get('/conversations', ChatController.getConversations);
router.get('/search', ChatController.searchAllMessages);
router.get('/account-events', ChatController.getAccountEvents);
router.get('/link-preview', ChatController.getLinkPreview);

// GET /api/v1/chat/:matchId/messages — get paginated messages for a match
router.get('/:matchId/messages', ChatController.getMessages);
router.get('/:matchId/events', ChatController.getEvents);
router.put('/:matchId/device-cursor', validateRequest(deviceCursorSchema), ChatController.saveDeviceCursor);
router.get('/:matchId/search', ChatController.searchMessages);
router.get('/:matchId/shared', ChatController.getSharedMessages);
router.get('/:matchId/messages/:messageId/context', ChatController.messageContext);

// POST /api/v1/chat/:matchId/messages — send a message in a match
router.post('/:matchId/messages', validateRequest(sendMessageSchema), ChatController.sendMessage);

// PATCH /api/v1/chat/:matchId/read — mark all messages in a match as read
router.patch('/:matchId/read', ChatController.markAsRead);
router.patch('/:matchId/delivered', validateRequest(receiptSchema), ChatController.markDelivered);
// A voice note was listened to: the sender's blue microphone (MESSAGE_NOTIFICATIONS_PLAN.md 7).
router.patch('/:matchId/messages/:messageId/played', async (req, res, next) => {
  try {
    const matchId = z.string().uuid().parse(req.params.matchId);
    const messageId = z.string().uuid().parse(req.params.messageId);
    res.json({ success: true, data: await ChatService.markPlayed(matchId, (req as any).user.sub, messageId) });
  } catch (error) { next(error); }
});
router.patch('/:matchId/mute', validateRequest(muteSchema), ChatController.setMuted);

// Conversation actions (Telegram's pin, archive, mark unread, clear, delete, auto-delete)
router.get('/:matchId/settings', ChatController.getConversationSettings);
// Before verifying (GOOGLE_SIGNUP_PLAN.md 2.3): my messages left, and whether the other person is waiting to verify.
router.get('/:matchId/allowance', ChatController.getAllowance);
router.patch('/:matchId/pin', validateRequest(pinConversationSchema), ChatController.setPinned);
router.patch('/:matchId/archive', validateRequest(archiveConversationSchema), ChatController.setArchived);
router.patch('/:matchId/unread', validateRequest(unreadConversationSchema), ChatController.setMarkedUnread);
router.post('/:matchId/clear', validateRequest(clearConversationSchema), ChatController.clearHistory);
router.post('/:matchId/delete', validateRequest(clearConversationSchema), ChatController.deleteConversation);
router.patch('/:matchId/ttl', validateRequest(messageTtlSchema), ChatController.setMessageTtl);

// GET /api/v1/chat/:matchId/media/upload-url — Generate S3 presigned PUT URL
router.get('/:matchId/media/upload-url', ChatController.getMediaUploadUrl);
router.post('/:matchId/media/:assetId/complete', ChatController.completeMediaUpload);
// Resumable uploads for large media: one presigned URL per part.
router.post('/:matchId/media/multipart', ChatController.createMultipartUpload);
router.delete('/:matchId/media/:assetId/multipart', ChatController.abortMultipartUpload);

// GET /api/v1/chat/media/read — Generate S3 presigned GET URL (uses ?key= query param)
router.get('/media/read', ChatController.getMediaReadUrl);

// DELETE /api/v1/chat/:matchId/messages/:messageId — Soft delete a message
router.delete('/:matchId/messages/:messageId', validateRequest(deleteMessageSchema), ChatController.deleteMessage);

// PATCH /api/v1/chat/:matchId/messages/:messageId — Edit a message
router.patch('/:matchId/messages/:messageId', validateRequest(editMessageSchema), ChatController.updateMessage);
router.put('/:matchId/messages/:messageId/reaction', validateRequest(reactionSchema), ChatController.setReaction);
router.get('/:matchId/messages/:messageId/reactions', ChatController.listReactions);

export default router;
