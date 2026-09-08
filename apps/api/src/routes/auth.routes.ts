import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { validateRequest } from '../middlewares/validate.middleware';
import { registerSchema, loginSchema, refreshSchema, sendOtpSchema, verifyOtpSchema, sendPhoneOtpSchema, verifyPhoneOtpSchema, recoveryStartSchema, recoveryCompleteSchema } from '../schemas/auth.schema';
import { authRateLimiter } from '../middlewares/rateLimit.middleware';
import { protect } from '../middlewares/auth.middleware';

const router = Router();

router.post('/register', authRateLimiter, validateRequest(registerSchema), AuthController.register);
router.post('/login', authRateLimiter, validateRequest(loginSchema), AuthController.login);
router.post('/refresh', authRateLimiter, validateRequest(refreshSchema), AuthController.refresh);
router.post('/logout', protect, AuthController.logout);
router.post('/logout-all', protect, AuthController.logoutAll);
router.get('/sessions', protect, AuthController.sessions);
router.delete('/sessions/:sessionId', protect, AuthController.revokeSession);
router.post('/recovery/start', authRateLimiter, validateRequest(recoveryStartSchema), AuthController.startRecovery);
router.post('/recovery/complete', authRateLimiter, validateRequest(recoveryCompleteSchema), AuthController.completeRecovery);
router.post('/send-otp', authRateLimiter, validateRequest(sendOtpSchema), AuthController.sendOTP);
router.post('/verify-otp', authRateLimiter, validateRequest(verifyOtpSchema), AuthController.verifyOTP);

// Phone OTP routes
router.post('/send-phone-otp', authRateLimiter, validateRequest(sendPhoneOtpSchema), AuthController.sendPhoneOTP);
router.post('/verify-phone-otp', authRateLimiter, validateRequest(verifyPhoneOtpSchema), AuthController.verifyPhoneOTP);

export default router;
