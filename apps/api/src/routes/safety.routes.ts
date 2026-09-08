import { Router } from 'express';
import { SafetyController } from '../controllers/safety.controller';
import { protect } from '../middlewares/auth.middleware';
import { adminGuard } from '../middlewares/adminGuard.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import { reportSchema } from '../schemas/safety.schema';

const router = Router();

// User endpoint — file a report
router.post('/report', protect, validateRequest(reportSchema), SafetyController.report);

// Admin endpoints — manage reports
router.get('/reports', protect, adminGuard, SafetyController.getReports);
router.patch('/reports/:id/resolve', protect, adminGuard, SafetyController.resolveReport);
router.get('/cases', protect, adminGuard, SafetyController.getCases);
router.patch('/cases/:id', protect, adminGuard, SafetyController.updateCase);

export default router;
