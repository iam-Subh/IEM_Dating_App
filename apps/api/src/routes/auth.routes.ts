import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { validateRequest } from '../middlewares/validate.middleware';
import { registerSchema, loginSchema, refreshSchema, sendOtpSchema, verifyOtpSchema, recoveryStartSchema, recoveryCompleteSchema, googleSignInSchema, googleLinkSchema, googleConnectSchema, setPasswordSchema, changePasswordSchema } from '../schemas/auth.schema';
import { authRateLimiter, passwordChangeLimiter } from '../middlewares/rateLimit.middleware';
import { protect } from '../middlewares/auth.middleware';

const router = Router();

router.post('/register', authRateLimiter, validateRequest(registerSchema), AuthController.register);
router.post('/login', authRateLimiter, validateRequest(loginSchema), AuthController.login);
router.post('/google', authRateLimiter, validateRequest(googleSignInSchema), AuthController.google);
router.post('/google/link-with-password', authRateLimiter, validateRequest(googleLinkSchema), AuthController.googleLink);
router.post('/account/google', protect, authRateLimiter, validateRequest(googleConnectSchema), AuthController.googleConnect);
router.delete('/account/google', protect, AuthController.googleDisconnect);
router.post('/account/password', protect, authRateLimiter, validateRequest(setPasswordSchema), AuthController.setPassword);
router.put('/account/password', protect, passwordChangeLimiter, validateRequest(changePasswordSchema), AuthController.changePassword);
router.post('/refresh', authRateLimiter, validateRequest(refreshSchema), AuthController.refresh);
router.post('/logout', protect, AuthController.logout);
router.post('/logout-all', protect, AuthController.logoutAll);
router.get('/account', protect, AuthController.account);
router.get('/sessions', protect, AuthController.sessions);
router.post('/sessions/revoke-others', protect, AuthController.revokeOtherSessions);
router.delete('/sessions/:sessionId', protect, AuthController.revokeSession);
router.post('/recovery/start', authRateLimiter, validateRequest(recoveryStartSchema), AuthController.startRecovery);
router.post('/recovery/complete', authRateLimiter, validateRequest(recoveryCompleteSchema), AuthController.completeRecovery);
router.post('/send-otp', authRateLimiter, validateRequest(sendOtpSchema), AuthController.sendOTP);
router.post('/verify-otp', authRateLimiter, validateRequest(verifyOtpSchema), AuthController.verifyOTP);

// Phone OTP routes

export default router;
