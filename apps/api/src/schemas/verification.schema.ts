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
  }).strict(),
});
