import jwt from 'jsonwebtoken';
import { validateOTPConfiguration } from '../services/otp.service';

const ISSUER = process.env.JWT_ISSUER || 'iem-connect-api';
const AUDIENCE = process.env.JWT_AUDIENCE || 'iem-connect-mobile';

function requiredSecret(name: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET'): string {
  const value = process.env[name];
  if (!value || value.length < 32 || value.startsWith('your-') || value.startsWith('default-')) {
    throw new Error(`${name} must be an independent secret with at least 32 characters`);
  }
  return value;
}

export function validateAuthConfiguration(): void {
  const accessSecret = requiredSecret('JWT_ACCESS_SECRET');
  const refreshSecret = requiredSecret('JWT_REFRESH_SECRET');
  if (accessSecret === refreshSecret) {
    throw new Error('JWT access and refresh secrets must be different');
  }
  validateOTPConfiguration();
}

export const generateTokens = (userId: string, _identifier: string, jti: string, _role: string = 'user', sessionVersion = 1) => {
  validateAuthConfiguration();
  const common = { sub: userId, jti, sv: sessionVersion };
  const options = { algorithm: 'HS256' as const, issuer: ISSUER, audience: AUDIENCE };
  const accessToken = jwt.sign({ ...common, type: 'access' }, requiredSecret('JWT_ACCESS_SECRET'), { ...options, expiresIn: '15m' });
  const refreshToken = jwt.sign({ ...common, type: 'refresh' }, requiredSecret('JWT_REFRESH_SECRET'), { ...options, expiresIn: '30d' });
  
  return { accessToken, refreshToken };
};

export const verifyAccessToken = (token: string) => {
  const decoded = jwt.verify(token, requiredSecret('JWT_ACCESS_SECRET'), {
    algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE,
  });
  if (typeof decoded === 'string' || decoded.type !== 'access' || typeof decoded.sub !== 'string' || typeof decoded.jti !== 'string' || typeof decoded.sv !== 'number') {
    throw new Error('Invalid access token claims');
  }
  return decoded;
};

export const verifyRefreshToken = (token: string) => {
  const decoded = jwt.verify(token, requiredSecret('JWT_REFRESH_SECRET'), {
    algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE,
  });
  if (typeof decoded === 'string' || decoded.type !== 'refresh' || typeof decoded.sub !== 'string' || typeof decoded.jti !== 'string' || typeof decoded.sv !== 'number') {
    throw new Error('Invalid refresh token claims');
  }
  return decoded;
};
