import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import { redisClient } from '../utils/redis';
import { HttpError } from '../utils/httpError';

const OTP_TTL_SECONDS = 300;
const PROOF_TTL_SECONDS = 600;
const RESEND_SECONDS = 60;
const MAX_ATTEMPTS = 5;

export type OTPPurpose = 'registration' | 'phone_login' | 'student_membership' | 'password_recovery';

function secret(): string {
  const value = process.env.OTP_HMAC_SECRET;
  if (!value || value.length < 32 || value.startsWith('your-')) {
    throw new Error('OTP_HMAC_SECRET must contain at least 32 characters');
  }
  return value;
}

function normalize(identifier: string): string {
  return identifier.trim().toLowerCase();
}

function hmac(value: string): string {
  return createHmac('sha256', secret()).update(value).digest('hex');
}

function equalHex(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function validateOTPConfiguration(): void {
  secret();
}

export class OTPService {
  static async issue(identifier: string, purpose: OTPPurpose) {
    const normalized = normalize(identifier);
    const identityHash = hmac(normalized);
    const challengeId = randomUUID();
    const code = randomInt(100000, 1000000).toString();
    const digest = hmac(`${challengeId}:${purpose}:${identityHash}:${code}`);
    const result = Number(await redisClient.eval(
      `if redis.call('exists', KEYS[1]) == 1 then return 0 end
       redis.call('set', KEYS[1], '1', 'EX', ARGV[1])
       redis.call('hset', KEYS[2], 'digest', ARGV[2], 'attempts', '0')
       redis.call('expire', KEYS[2], ARGV[3])
       return 1`,
      2,
      `otp:cooldown:${purpose}:${identityHash}`,
      `otp:challenge:${challengeId}`,
      RESEND_SECONDS,
      digest,
      OTP_TTL_SECONDS,
    ));
    if (result !== 1) {
      throw new HttpError(429, 'Please wait before requesting a new code', 'OTP_RATE_LIMITED');
    }
    return { challengeId, code, expiresIn: OTP_TTL_SECONDS };
  }

  static async cancel(challengeId: string): Promise<void> {
    await redisClient.del(`otp:challenge:${challengeId}`);
  }

  static async verify(identifier: string, purpose: OTPPurpose, challengeId: string, code: string) {
    const identityHash = hmac(normalize(identifier));
    const expected = hmac(`${challengeId}:${purpose}:${identityHash}:${code}`);
    const result = await redisClient.eval(
      `if redis.call('exists', KEYS[1]) == 0 then return {'expired', ''} end
       local attempts = redis.call('hincrby', KEYS[1], 'attempts', 1)
       local stored = redis.call('hget', KEYS[1], 'digest')
       if attempts > tonumber(ARGV[1]) then
         redis.call('del', KEYS[1])
         return {'exhausted', ''}
       end
       if stored == ARGV[2] then
         redis.call('del', KEYS[1])
         return {'valid', ''}
       end
       return {'invalid', tostring(tonumber(ARGV[1]) - attempts)}`,
      1,
      `otp:challenge:${challengeId}`,
      MAX_ATTEMPTS,
      expected,
    ) as [string, string];

    if (result[0] === 'valid') return { valid: true as const };
    if (result[0] === 'expired') return { valid: false as const, error: 'Code expired. Request a new code.' };
    if (result[0] === 'exhausted') return { valid: false as const, error: 'Too many attempts. Request a new code.' };
    return { valid: false as const, error: `Invalid code. ${result[1]} attempts remaining.` };
  }

  static async createProof(identifier: string, purpose: OTPPurpose): Promise<string> {
    const token = randomUUID();
    await redisClient.set(
      `otp:proof:${token}`,
      hmac(`${purpose}:${normalize(identifier)}`),
      'EX',
      PROOF_TTL_SECONDS,
    );
    return token;
  }

  static async consumeProof(identifier: string, purpose: OTPPurpose, token: string): Promise<void> {
    const expected = hmac(`${purpose}:${normalize(identifier)}`);
    const stored = await redisClient.eval(
      `local value = redis.call('get', KEYS[1])
       if not value then return '' end
       if value == ARGV[1] then redis.call('del', KEYS[1]); return value end
       return ''`,
      1,
      `otp:proof:${token}`,
      expected,
    ) as string;
    if (!stored || !equalHex(stored, expected)) {
      throw new HttpError(400, 'Verification proof is invalid or expired', 'INVALID_VERIFICATION_PROOF');
    }
  }
}
