import { Router } from 'express';
import { protect } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import { VerificationController } from '../controllers/verification.controller';
import { sendStudentVerificationSchema, verifyStudentVerificationSchema } from '../schemas/verification.schema';

const router = Router();
router.get('/institutions', protect, VerificationController.institutions);
router.post('/student/send', protect, validateRequest(sendStudentVerificationSchema), VerificationController.send);
router.post('/student/verify', protect, validateRequest(verifyStudentVerificationSchema), VerificationController.verify);
export default router;
