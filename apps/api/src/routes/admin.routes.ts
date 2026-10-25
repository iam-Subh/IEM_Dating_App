import { FaceVerificationService } from '../services/face-verification.service';
import { ApiResponse } from '../utils/ApiResponse';
import { PushStatsService } from '../services/push-stats.service';
import { BirthdayChangeService } from '../services/birthday-change.service';
import { Router } from 'express';
import { AppSettingsController } from '../controllers/app-settings.controller';
import { AdminController } from '../controllers/admin.controller';
import { protect } from '../middlewares/auth.middleware';
import { adminGuard, staffGuard } from '../middlewares/adminGuard.middleware';
import { adminAudit } from '../middlewares/adminAudit.middleware';
import { CampusController } from '../controllers/campus.controller';
import { MembershipReviewController } from '../controllers/membership-review.controller';
import { StandoutsAdminController } from '../controllers/standouts-admin.controller';

const router = Router();
// Every change made here is in the admin audit log.
router.use(adminAudit);

// All admin routes require authentication + admin role
router.get('/metrics/overview', protect, adminGuard, AdminController.getOverview);
router.get('/metrics/standouts', protect, adminGuard, StandoutsAdminController.metrics);
router.post('/standouts/run', protect, adminGuard, StandoutsAdminController.run);
router.get('/metrics/algorithm', protect, adminGuard, AdminController.getAlgorithmMetrics);
router.get('/algorithm/config', protect, adminGuard, AdminController.getConfig);
router.post('/algorithm/flags', protect, adminGuard, AdminController.updateFlags);
router.post('/algorithm/weights', protect, adminGuard, AdminController.updateWeights);
router.get('/users/reported', protect, staffGuard('reports'), AdminController.getReportedUsers);
router.get('/users/bots', protect, adminGuard, AdminController.getBotUsers);
// Campus map pins and shared-domain membership review (LOCATION_SPEC.md 8.1, 8.2).
router.get('/campuses', protect, adminGuard, CampusController.all);
// Real-person check: unsure cases for a person to decide (PHOTO_VERIFICATION_PLAN.md 12).
router.get('/face-reviews', protect, staffGuard('reviews'), async (_req, res, next) => {
  try { res.json(ApiResponse.success(await FaceVerificationService.pendingReviews())); } catch (error) { next(error); }
});
router.post('/face-reviews/:id/decide', protect, staffGuard('reviews'), async (req, res, next) => {
  try {
    const decision = req.body?.decision;
    if (!['approve', 'reject', 'retake'].includes(decision)) return res.status(400).json(ApiResponse.error('decision: approve, reject or retake'));
    res.json(ApiResponse.success(await FaceVerificationService.decide((req as any).user.sub, String(req.params.id), decision, req.body?.note)));
  } catch (error) { next(error); }
});
// Which notifications and which lines get opened (NOTIFICATIONS_PLAN.md 13).
router.get('/notifications/stats', protect, adminGuard, async (req, res, next) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 14));
    res.json(ApiResponse.success(await PushStatsService.stats(days)));
  } catch (error) { next(error); }
});
// Birthday changes through support, with an ID photo (GOOGLE_SIGNUP_PLAN.md 6.2).
router.get('/birthday-requests', protect, staffGuard('reviews'), async (_req, res, next) => {
  try { res.json(ApiResponse.success(await BirthdayChangeService.pending())); } catch (error) { next(error); }
});
router.post('/birthday-requests/:id/decide', protect, staffGuard('reviews'), async (req, res, next) => {
  try {
    const approve = req.body?.approve === true;
    res.json(ApiResponse.success(await BirthdayChangeService.decide((req as any).user.sub, String(req.params.id), approve, req.body?.note)));
  } catch (error) { next(error); }
});
router.post('/team-updates', protect, adminGuard, AppSettingsController.sendTeamUpdate);
router.put('/campuses/:campusId/anchor', protect, adminGuard, CampusController.setAnchor);
router.get('/memberships/unconfirmed', protect, staffGuard('reviews'), MembershipReviewController.list);
router.post('/memberships/:userId/confirm', protect, staffGuard('reviews'), MembershipReviewController.confirm);

export default router;
