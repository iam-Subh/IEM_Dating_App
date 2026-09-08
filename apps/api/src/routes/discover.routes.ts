import { Router } from 'express';
import { DiscoverController } from '../controllers/discover.controller';
import { protect } from '../middlewares/auth.middleware';
import { swipeRateLimiter, visibilityRateLimiter, discoveryRateLimiter } from '../middlewares/rateLimit.middleware';
import { requireDatingEligibility } from '../middlewares/dating.middleware';

const router = Router();

router.use(protect, requireDatingEligibility);
router.get('/recommendations', discoveryRateLimiter, DiscoverController.getRecommendations);
router.post('/swipe', swipeRateLimiter, DiscoverController.swipe);
router.post('/visible', visibilityRateLimiter, DiscoverController.visible);

export default router;
