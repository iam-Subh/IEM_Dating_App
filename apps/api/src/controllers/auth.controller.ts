import { androidIdFrom } from '../services/identity-ban.service';
import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { OTPService } from '../services/otp.service';
import { EmailService } from '../services/email.service';
import { ApiResponse } from '../utils/ApiResponse';
import { AccountIdentityService } from '../services/account-identity.service';
import { GoogleAuthService } from '../services/google-auth.service';

export class AuthController {
  static async startRecovery(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await AuthService.startRecovery(req.body.email);
      res.status(200).json(ApiResponse.success(data, 'If the account exists, a recovery code was sent'));
    } catch (error) { next(error); }
  }

  static async completeRecovery(req: Request, res: Response, next: NextFunction) {
    try {
      await AuthService.completeRecovery(req.body);
      res.status(200).json(ApiResponse.success(null, 'Password changed. Sign in again.'));
    } catch (error) { next(error); }
  }

  static async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await AuthService.refresh(req.body.refreshToken, req.body.deviceInfo);
      res.status(200).json(ApiResponse.success(data));
    } catch (error) { next(error); }
  }

  static async logout(req: Request, res: Response, next: NextFunction) {
    try {
      await AuthService.logout((req as any).user.sub, (req as any).user.jti);
      res.status(200).json(ApiResponse.success(null, 'Logged out'));
    } catch (error) { next(error); }
  }

  static async logoutAll(req: Request, res: Response, next: NextFunction) {
    try {
      await AuthService.logoutAll((req as any).user.sub);
      res.status(200).json(ApiResponse.success(null, 'All sessions revoked'));
    } catch (error) { next(error); }
  }

  static async sessions(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await AuthService.listSessions((req as any).user.sub, (req as any).user.jti);
      res.status(200).json(ApiResponse.success(data));
    } catch (error) { next(error); }
  }
  static async google(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await GoogleAuthService.signIn(req.body.idToken, req.body.deviceInfo, androidIdFrom(req));
      res.status(200).json(ApiResponse.success(data, 'Signed in with Google'));
    } catch (error) { next(error); }
  }

  static async googleLink(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await GoogleAuthService.linkWithPassword(req.body.idToken, req.body.password, req.body.deviceInfo);
      res.status(200).json(ApiResponse.success(data, 'Google connected'));
    } catch (error) { next(error); }
  }

  static async googleConnect(req: Request, res: Response, next: NextFunction) {
    try {
      res.status(200).json(ApiResponse.success(await GoogleAuthService.connect((req as any).user.sub, req.body.idToken), 'Google connected'));
    } catch (error) { next(error); }
  }

  static async googleDisconnect(req: Request, res: Response, next: NextFunction) {
    try {
      res.status(200).json(ApiResponse.success(await GoogleAuthService.disconnect((req as any).user.sub), 'Google disconnected'));
    } catch (error) { next(error); }
  }

  static async setPassword(req: Request, res: Response, next: NextFunction) {
    try {
      await AuthService.setPassword((req as any).user.sub, req.body.password);
      res.status(200).json(ApiResponse.success(null, 'Password added'));
    } catch (error) { next(error); }
  }

  static async changePassword(req: Request, res: Response, next: NextFunction) {
    try {
      const user = (req as any).user;
      const data = await AuthService.changePassword(user.sub, req.body.currentPassword, req.body.newPassword, user.jti);
      res.status(200).json(ApiResponse.success(data, 'Password changed'));
    } catch (error) { next(error); }
  }

  static async account(req: Request, res: Response, next: NextFunction) {
    try {
      res.status(200).json(ApiResponse.success(await AccountIdentityService.read((req as any).user.sub)));
    } catch (error) { next(error); }
  }

  static async revokeOtherSessions(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await AuthService.revokeOtherSessions((req as any).user.sub, (req as any).user.jti);
      res.status(200).json(ApiResponse.success(data, 'Other sessions revoked'));
    } catch (error) { next(error); }
  }
  static async revokeSession(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await AuthService.revokeSession((req as any).user.sub, String(req.params.sessionId), (req as any).user.jti);
      res.status(200).json(ApiResponse.success(data, 'Session revoked'));
    } catch (error) { next(error); }
  }
  static async register(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await AuthService.register(req.body, androidIdFrom(req));
      res.status(201).json(ApiResponse.success(user, 'User registered successfully'));
    } catch (error) {
      next(error);
    }
  }

  static async login(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await AuthService.login(req.body);
      res.status(200).json(ApiResponse.success(data, 'Login successful'));
    } catch (error) {
      next(error);
    }
  }

  static async sendOTP(req: Request, res: Response, next: NextFunction) {
    try {
      const { email } = req.body;
      // Sign-up only: an email that already has an account is told so now,
      // before a code is sent, not after it was typed in (register refused it then).
      await AuthService.assertEmailFree(email);
      const challenge = await OTPService.issue(email, 'registration');
      try {
        await EmailService.sendOTP(email, challenge.code);
      } catch (error) {
        await OTPService.cancel(challenge.challengeId);
        throw error;
      }

      res.status(200).json(ApiResponse.success(
        { challengeId: challenge.challengeId, expiresIn: challenge.expiresIn },
        'Verification code sent to your email'
      ));
    } catch (error) {
      next(error);
    }
  }

  static async verifyOTP(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, code, challengeId } = req.body;

      const result = await OTPService.verify(email, 'registration', challengeId, code);

      if (!result.valid) {
        res.status(400).json(ApiResponse.error(result.error || 'Invalid code'));
        return;
      }

      const verificationToken = await OTPService.createProof(email, 'registration');
      res.status(200).json(ApiResponse.success(
        { verified: true, verificationToken, expiresIn: 600 },
        'Email verified successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

}
