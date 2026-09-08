import { Router } from 'express';
import { ProfileController } from '../controllers/profile.controller';
import { protect } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import { updateProfileSchema } from '../schemas/profile.schema';
import { DiscoverySettingsController } from '../controllers/discovery-settings.controller';

const router = Router();

router.get('/', protect, ProfileController.getProfile);
router.get('/readiness', protect, ProfileController.getReadiness);
router.get('/discovery', protect, DiscoverySettingsController.get);
router.put('/discovery', protect, DiscoverySettingsController.update);
router.put('/', protect, validateRequest(updateProfileSchema), ProfileController.updateProfile);

router.put('/location', protect, ProfileController.updateLocation);
router.delete('/location', protect, ProfileController.removeLocation);

export default router;
