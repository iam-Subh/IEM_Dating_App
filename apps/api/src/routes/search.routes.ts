import { Router } from 'express';
import { protect } from '../middlewares/auth.middleware';
import { requireDatingEligibility } from '../middlewares/dating.middleware';
import { discoveryRateLimiter } from '../middlewares/rateLimit.middleware';
import { SearchController } from '../controllers/search.controller';

const router = Router();
router.use(protect, requireDatingEligibility);
router.get('/explore', discoveryRateLimiter, SearchController.explore);
export default router;
