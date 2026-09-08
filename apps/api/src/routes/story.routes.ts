import { Router } from 'express';
import { protect } from '../middlewares/auth.middleware';
import { requireDatingEligibility } from '../middlewares/dating.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import { StoryController } from '../controllers/story.controller';
import { followRequestSchema, followResponseSchema, storyMuteSchema, storyPublishSchema, storyReplySchema, storySettingsSchema } from '../schemas/story.schema';
import { followRateLimiter, storyPublishRateLimiter } from '../middlewares/rateLimit.middleware';

const router = Router();
router.use(protect, requireDatingEligibility);

router.get('/feed', StoryController.feed);
router.get('/follow-requests', StoryController.requests);
router.get('/followers', StoryController.followers);
router.get('/following', StoryController.following);
router.put('/settings', validateRequest(storySettingsSchema), StoryController.settings);
router.post('/follows', followRateLimiter, validateRequest(followRequestSchema), StoryController.requestFollow);
router.patch('/follows/:followId', validateRequest(followResponseSchema), StoryController.respondFollow);
router.delete('/follows/:userId', StoryController.removeFollow);
router.post('/media/upload-url', StoryController.requestUpload);
router.post('/media/:assetId/complete', StoryController.completeUpload);
router.post('/', storyPublishRateLimiter, validateRequest(storyPublishSchema), StoryController.publish);
router.get('/:storyId', StoryController.get);
router.get('/:storyId/media', StoryController.readUrl);
router.post('/:storyId/views', StoryController.recordView);
router.post('/:storyId/reply', validateRequest(storyReplySchema), StoryController.reply);
router.get('/:storyId/viewers', StoryController.viewers);
router.delete('/:storyId', StoryController.remove);
router.put('/authors/:authorId/mute', validateRequest(storyMuteSchema), StoryController.mute);

export default router;
