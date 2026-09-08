import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { protect } from '../middlewares/auth.middleware';
import { adminGuard } from '../middlewares/adminGuard.middleware';

const router = Router();

// All admin routes require authentication + admin role
router.get('/metrics/overview', protect, adminGuard, AdminController.getOverview);
router.get('/metrics/algorithm', protect, adminGuard, AdminController.getAlgorithmMetrics);
router.get('/algorithm/config', protect, adminGuard, AdminController.getConfig);
router.post('/algorithm/flags', protect, adminGuard, AdminController.updateFlags);
router.post('/algorithm/weights', protect, adminGuard, AdminController.updateWeights);
router.get('/users/reported', protect, adminGuard, AdminController.getReportedUsers);
router.get('/users/bots', protect, adminGuard, AdminController.getBotUsers);

export default router;
