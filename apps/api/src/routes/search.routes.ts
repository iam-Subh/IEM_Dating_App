import { Router } from 'express';
import { protect } from '../middlewares/auth.middleware';
import { requireDatingEligibility } from '../middlewares/dating.middleware';
import { discoveryRateLimiter, searchRateLimiter } from '../middlewares/rateLimit.middleware';
import { SearchController } from '../controllers/search.controller';

const router = Router();
router.use(protect, requireDatingEligibility);
router.get('/explore', discoveryRateLimiter, SearchController.explore);
router.get('/people', searchRateLimiter, SearchController.people);
router.get('/people/:userId/dating', discoveryRateLimiter, SearchController.datingProfile);
router.get('/people/:userId', discoveryRateLimiter, SearchController.person);
export default router;
