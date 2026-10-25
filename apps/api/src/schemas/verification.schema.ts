import { z } from 'zod';

const institutionCode = z.string().min(2).max(40);
const email = z.string().email().max(255);

export const sendStudentVerificationSchema = z.object({
  body: z.object({ institutionCode, email }).strict(),
});

export const verifyStudentVerificationSchema = z.object({
  body: z.object({
    institutionCode,
    email,
    challengeId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/),
    // Only asked for when the email domain is shared by more than one
    // institution (UEM Kolkata and UEM Jaipur), and only ever approximate.
    location: z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    }).strict().optional(),
    // Set while verifying when the account has none - a Google sign-up
    // (GOOGLE_SIGNUP_PLAN.md 1.4) - so the college email can sign in too.
    password: z.string().min(8, 'Password must be at least 8 characters long').max(200).optional(),
  }).strict(),
});

export const switchAccountSchema = z.object({
  body: z.object({
    switchToken: z.string().min(20).max(2048),
    deviceInfo: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
});
