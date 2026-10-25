import { Router } from 'express';
import { protect } from '../middlewares/auth.middleware';
import { requireDatingEligibility } from '../middlewares/dating.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import { StoryController } from '../controllers/story.controller';
import { followRequestSchema, followResponseSchema, storyInsightEventsSchema, storyLikeSchema, storyMuteSchema, storyPublishSchema, storyReplySchema, storySettingsSchema } from '../schemas/story.schema';
import { followRateLimiter, storyAudienceRateLimiter, storyInsightRateLimiter, storyPublishRateLimiter } from '../middlewares/rateLimit.middleware';
import { StoryAudienceController } from '../controllers/story-audience.controller';
import { StoryArchiveController } from '../controllers/story-archive.controller';
import { StoryCreationController } from '../controllers/story-creation.controller';
import { storyAddYoursParamsSchema, storyCaptionParamsSchema, storyPersonParamsSchema, storyStickerParamsSchema, storyStickerResponseSchema } from '../schemas/story-creation.schema';

const router = Router();
router.use(protect, requireDatingEligibility);

router.get('/feed', StoryController.feed);
// Grouped by person in tray order; registered before '/:storyId'.
router.get('/tray', StoryController.tray);
router.get('/owners/:userId', StoryController.owner);
// Sticker search and music, registered before '/:storyId'.
router.get('/mentions/search', StoryCreationController.mentionSearch);
router.get('/people/:userId', validateRequest(storyPersonParamsSchema), StoryCreationController.person);
router.get('/add-yours/:threadId', validateRequest(storyAddYoursParamsSchema), StoryCreationController.addYoursThread);
router.post('/captions', StoryCreationController.createCaptions);
router.post('/captions/:jobId/start', validateRequest(storyCaptionParamsSchema), StoryCreationController.startCaptions);
router.get('/captions/:jobId', validateRequest(storyCaptionParamsSchema), StoryCreationController.captionStatus);
router.get('/locations/search', StoryCreationController.placeSearch);
router.get('/gifs/search', StoryCreationController.gifSearch);
router.get('/music/trending', StoryCreationController.musicTrending);
router.get('/music/search', StoryCreationController.musicSearch);
router.get('/music/:trackId', StoryCreationController.musicTrack);
router.get('/music/:trackId/lyrics', StoryCreationController.musicLyrics);
router.get('/follow-requests', StoryController.requests);
router.get('/followers', StoryController.followers);
router.get('/following', StoryController.following);
router.put('/settings', validateRequest(storySettingsSchema), StoryController.settings);
// Part 2: who can see and respond. All before `/:storyId`.
router.get('/settings', StoryAudienceController.settings);
router.get('/audience/people', storyAudienceRateLimiter, StoryAudienceController.people);
router.get('/close-friends', StoryAudienceController.closeFriends);
router.delete('/close-friends', storyAudienceRateLimiter, StoryAudienceController.clearCloseFriends);
router.put('/close-friends/:userId', storyAudienceRateLimiter, validateRequest(storyPersonParamsSchema), StoryAudienceController.addCloseFriend);
router.delete('/close-friends/:userId', storyAudienceRateLimiter, validateRequest(storyPersonParamsSchema), StoryAudienceController.removeCloseFriend);
router.get('/hidden', StoryAudienceController.hidden);
router.put('/hidden/:userId', storyAudienceRateLimiter, validateRequest(storyPersonParamsSchema), StoryAudienceController.hide);
router.delete('/hidden/:userId', storyAudienceRateLimiter, validateRequest(storyPersonParamsSchema), StoryAudienceController.unhide);
router.get('/muted', StoryAudienceController.muted);
router.get('/reply-cards', StoryAudienceController.replyCards);
// Part 3: the private Archive. All before `/:storyId`.
router.get('/archive', StoryArchiveController.list);
router.get('/archive/calendar', StoryArchiveController.calendar);
router.get('/archive/memories', StoryArchiveController.memories);
// Phase B: Insight events, batched from the viewer. All before `/:storyId`.
router.post('/insights/events', storyInsightRateLimiter, validateRequest(storyInsightEventsSchema), StoryController.recordInsightEvents);
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
router.put('/:storyId/like', validateRequest(storyLikeSchema), StoryController.like);
router.get('/:storyId/viewers', StoryController.viewers);
router.get('/:storyId/insights', StoryController.insights);
router.get('/:storyId/stickers', StoryCreationController.stickers);
router.post('/:storyId/stickers/:stickerId/responses', validateRequest(storyStickerResponseSchema), StoryCreationController.respondSticker);
router.get('/:storyId/stickers/:stickerId/results', validateRequest(storyStickerParamsSchema), StoryCreationController.stickerResults);
router.post('/:storyId/stickers/:stickerId/link-tap', validateRequest(storyStickerParamsSchema), StoryCreationController.stickerLinkTap);
router.delete('/:storyId', StoryController.remove);
router.put('/authors/:authorId/mute', validateRequest(storyMuteSchema), StoryController.mute);

export default router;
