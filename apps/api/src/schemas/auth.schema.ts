import { z } from 'zod';

export const registerSchema = z.object({
  body: z.object({
    email: z.string().email().regex(/^[a-zA-Z0-9._-]+\d{4}@iem\.edu\.in$/, 'Must use a valid university email (e.g., firstname.lastname2024@iem.edu.in)'),
    name: z.string().min(2),
    department: z.string().min(2).optional(),
    graduationYear: z.number().int().min(2020).max(2100).optional(),
    password: z.string().min(8, 'Password must be at least 8 characters long'),
    verificationToken: z.string().uuid(),
    institutionCode: z.string().min(2).max(40).optional()
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string(),
    deviceInfo: z.any().optional()
  }),
});

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1),
    deviceInfo: z.record(z.string(), z.unknown()).optional()
  })
});

export const sendOtpSchema = z.object({
  body: z.object({
    email: z.string().email().regex(
      /^[a-zA-Z0-9._-]+\d{4}@iem\.edu\.in$/i,
      'Must use a valid college email (e.g., firstname.lastname2024@iem.edu.in)'
    ),
  }),
});

export const verifyOtpSchema = z.object({
  body: z.object({
    email: z.string().email(),
    code: z.string().length(6, 'Code must be exactly 6 digits'),
    challengeId: z.string().uuid(),
  }),
});

export const sendPhoneOtpSchema = z.object({
  body: z.object({
    phone: z.string().regex(
      /^\+91\d{10}$/,
      'Must be a valid Indian phone number (e.g., +919876543210)'
    ),
  }),
});

export const verifyPhoneOtpSchema = z.object({
  body: z.object({
    phone: z.string().regex(/^\+91\d{10}$/, 'Invalid phone number'),
    code: z.string().length(6, 'Code must be exactly 6 digits'),
    challengeId: z.string().uuid(),
  }),
});

export const recoveryStartSchema = z.object({
  body: z.object({ email: z.string().email() }),
});

export const recoveryCompleteSchema = z.object({
  body: z.object({
    email: z.string().email(),
    challengeId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/),
    newPassword: z.string().min(8),
  }),
});
