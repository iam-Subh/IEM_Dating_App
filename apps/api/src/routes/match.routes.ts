import { Router } from 'express';
import { MatchController } from '../controllers/match.controller';
import { protect } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import { swipeSchema } from '../schemas/match.schema';
import { swipeRateLimiter } from '../middlewares/rateLimit.middleware';
import { requireDatingEligibility } from '../middlewares/dating.middleware';

const router = Router();

router.use(protect);
router.get('/pending', requireDatingEligibility, MatchController.getPendingMatches);
// New matches (nobody has written yet), marking one opened, and an empty chat's intro.
router.get('/new', requireDatingEligibility, MatchController.newMatches);
router.post('/:matchId/seen', MatchController.markSeen);
router.get('/:matchId/intro', MatchController.intro);
router.post('/swipe', requireDatingEligibility, swipeRateLimiter, validateRequest(swipeSchema), MatchController.swipe);
router.post('/:matchId/unmatch', MatchController.unmatch);

export default router;
