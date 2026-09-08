import { Router } from 'express';
import { ChatController } from '../controllers/chat.controller';
import { protect } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import { deleteMessageSchema, deviceCursorSchema, editMessageSchema, muteSchema, reactionSchema, receiptSchema, sendMessageSchema } from '../schemas/chat.schema';
import { requireDatingEligibility } from '../middlewares/dating.middleware';

const router = Router();
router.use(protect, requireDatingEligibility);

// GET /api/v1/chat/conversations — list all conversations for the authenticated user
router.get('/conversations', ChatController.getConversations);
router.get('/search', ChatController.searchAllMessages);
router.get('/account-events', ChatController.getAccountEvents);

// GET /api/v1/chat/:matchId/messages — get paginated messages for a match
router.get('/:matchId/messages', ChatController.getMessages);
router.get('/:matchId/events', ChatController.getEvents);
router.put('/:matchId/device-cursor', validateRequest(deviceCursorSchema), ChatController.saveDeviceCursor);
router.get('/:matchId/search', ChatController.searchMessages);
router.get('/:matchId/messages/:messageId/context', ChatController.messageContext);

// POST /api/v1/chat/:matchId/messages — send a message in a match
router.post('/:matchId/messages', validateRequest(sendMessageSchema), ChatController.sendMessage);

// PATCH /api/v1/chat/:matchId/read — mark all messages in a match as read
router.patch('/:matchId/read', ChatController.markAsRead);
router.patch('/:matchId/delivered', validateRequest(receiptSchema), ChatController.markDelivered);
router.patch('/:matchId/mute', validateRequest(muteSchema), ChatController.setMuted);

// GET /api/v1/chat/:matchId/media/upload-url — Generate S3 presigned PUT URL
router.get('/:matchId/media/upload-url', ChatController.getMediaUploadUrl);
router.post('/:matchId/media/:assetId/complete', ChatController.completeMediaUpload);

// GET /api/v1/chat/media/read — Generate S3 presigned GET URL (uses ?key= query param)
router.get('/media/read', ChatController.getMediaReadUrl);

// DELETE /api/v1/chat/:matchId/messages/:messageId — Soft delete a message
router.delete('/:matchId/messages/:messageId', validateRequest(deleteMessageSchema), ChatController.deleteMessage);

// PATCH /api/v1/chat/:matchId/messages/:messageId — Edit a message
router.patch('/:matchId/messages/:messageId', validateRequest(editMessageSchema), ChatController.updateMessage);
router.put('/:matchId/messages/:messageId/reaction', validateRequest(reactionSchema), ChatController.setReaction);

export default router;
