import { Router } from 'express';
import { ProfileController } from '../controllers/profile.controller';
import { protect } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import { updateProfileSchema } from '../schemas/profile.schema';

const router = Router();

router.get('/', protect, ProfileController.getProfile);
router.put('/', protect, validateRequest(updateProfileSchema), ProfileController.updateProfile);

router.put('/location', protect, ProfileController.updateLocation);

export default router;
