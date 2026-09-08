import { z } from 'zod';

const boundedStringMap = z.record(z.string().max(50), z.string().max(200))
  .refine((value) => Object.keys(value).length <= 20, 'Too many preference fields');
const preferencesSchema = z.object({
  bio: z.string().max(2000).optional(),
  interests: z.array(z.string().min(1).max(100)).max(100).optional(),
  lifestyle: boundedStringMap.optional(),
  personality: boundedStringMap.optional(),
}).strict();

export const updateProfileSchema = z.object({
  body: z.object({
    name: z.string().min(2).optional(),
    birthday: z.string().datetime().optional(),
    department: z.string().min(2).optional(),
    degree: z.string().min(1).max(255).optional(),
    graduationYear: z.number().int().min(2020).max(2100).optional(),
    yearOfStudy: z.number().int().min(1).max(10).optional(),
    gender: z.string().optional(),
    showGender: z.boolean().optional(),
    orientation: z.array(z.string()).optional(),
    showOrientation: z.boolean().optional(),
    distancePreference: z.number().int().min(1).max(100).optional(),
    seeking: z.string().optional(),
    preferences: preferencesSchema.optional(),
    campus: z.string().max(255).optional(),
    isHosteller: z.boolean().optional(),
    clubs: z.array(z.string().min(1).max(100)).max(50).optional(),
    hangoutSpots: z.array(z.string().min(1).max(100)).max(50).optional(),
    attendanceMood: z.string().max(100).optional(),
    profileVideoUrl: z.string().url().max(500).nullable().optional(),
    avatarUrl: z.string().url().max(500).nullable().optional(),
    photos: z.array(z.string().url().max(500).nullable()).max(6).optional(),
  }),
});
