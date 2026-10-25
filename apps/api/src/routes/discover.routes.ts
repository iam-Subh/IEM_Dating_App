import { Router } from 'express';
import { MapController } from '../controllers/map.controller';
import { DiscoverController } from '../controllers/discover.controller';
import { protect } from '../middlewares/auth.middleware';
import { swipeRateLimiter, visibilityRateLimiter, discoveryRateLimiter } from '../middlewares/rateLimit.middleware';
import { requireDatingEligibility } from '../middlewares/dating.middleware';

const router = Router();

router.use(protect, requireDatingEligibility);
router.get('/recommendations', discoveryRateLimiter, DiscoverController.getRecommendations);
// Free here, where other apps charge for it (EXPLORE_SPEC.md, section 12).
router.get('/likes-you', discoveryRateLimiter, DiscoverController.likesYou);
router.get('/likes-you/summary', discoveryRateLimiter, DiscoverController.likesSummary);
router.post('/likes-you/seen', discoveryRateLimiter, DiscoverController.likesSeen);
router.get('/roses', discoveryRateLimiter, DiscoverController.roses);
router.get('/standouts', discoveryRateLimiter, DiscoverController.standouts);
router.post('/standouts/:userId/hide', discoveryRateLimiter, DiscoverController.hideStandout);
router.get('/rewind', discoveryRateLimiter, DiscoverController.rewindStatus);
router.post('/rewind', swipeRateLimiter, DiscoverController.rewind);
router.post('/swipe', swipeRateLimiter, DiscoverController.swipe);
router.post('/visible', visibilityRateLimiter, DiscoverController.visible);
// The map (LOCATION_SPEC.md 9): counts by campus, spot and area; never who is where.
router.get('/map', discoveryRateLimiter, MapController.map);
router.get('/map/places/search', discoveryRateLimiter, MapController.search);
router.get('/map/places/mine', discoveryRateLimiter, MapController.mine);
router.post('/map/places/mine', discoveryRateLimiter, MapController.add);
router.delete('/map/places/mine/:placeId', discoveryRateLimiter, MapController.remove);

export default router;
