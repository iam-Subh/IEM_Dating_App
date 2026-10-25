import { ApiResponse } from '../utils/ApiResponse';
import { FaceVerificationService } from '../services/face-verification.service';
import { Router } from 'express';
import { protect } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import { VerificationController } from '../controllers/verification.controller';
import { sendStudentVerificationSchema, switchAccountSchema, verifyStudentVerificationSchema } from '../schemas/verification.schema';

const router = Router();
router.get('/institutions', protect, VerificationController.institutions);
router.post('/student/send', protect, validateRequest(sendStudentVerificationSchema), VerificationController.send);
router.get('/status', protect, VerificationController.status);
// The real-person check (PHOTO_VERIFICATION_PLAN.md 7.3).
router.post('/face/challenge', protect, async (req, res, next) => {
  try { res.json(ApiResponse.success(await FaceVerificationService.challenge((req as any).user.sub))); } catch (error) { next(error); }
});
router.post('/face/submit', protect, async (req, res, next) => {
  try {
    const challengeId = req.body?.challengeId;
    if (typeof challengeId !== 'string' || !/^[0-9a-f-]{36}$/i.test(challengeId)) return res.status(400).json(ApiResponse.error('A check id is required'));
    res.json(ApiResponse.success(await FaceVerificationService.submit((req as any).user.sub, challengeId)));
  } catch (error) { next(error); }
});
// How a submitted check ended, for an app that lost the answer to submit.
router.get('/face/challenge/:id', protect, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json(ApiResponse.error('A check id is required'));
    res.json(ApiResponse.success(await FaceVerificationService.challengeResult((req as any).user.sub, id)));
  } catch (error) { next(error); }
});
router.get('/face', protect, async (req, res, next) => {
  try { res.json(ApiResponse.success(await FaceVerificationService.status((req as any).user.sub))); } catch (error) { next(error); }
});
router.delete('/face', protect, async (req, res, next) => {
  try { await FaceVerificationService.remove((req as any).user.sub); res.json(ApiResponse.success(null, 'Removed')); } catch (error) { next(error); }
});
router.post('/student/later', protect, VerificationController.later);
router.post('/switch-account', protect, validateRequest(switchAccountSchema), VerificationController.switchAccount);
router.post('/student/verify', protect, validateRequest(verifyStudentVerificationSchema), VerificationController.verify);
export default router;
