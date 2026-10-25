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
    graduationYear: z.number().int().min(1900).max(2100).optional(),
    yearOfStudy: z.number().int().min(1).max(10).optional(),
    height: z.number().int().min(91).max(244).optional(),
    gender: z.string().optional(),
    showGender: z.boolean().optional(),
    orientation: z.array(z.string()).optional(),
    showOrientation: z.boolean().optional(),
    showOnlineStatus: z.boolean().optional(),
    showRecentlyActive: z.boolean().optional(),
    distanceUnit: z.enum(['km', 'mi']).optional(),
    /** Findable by name in Search by people at the same college (SEARCH_SPEC.md, section 7). */
    searchDiscoverable: z.boolean().optional(),
    /** "Who can find me by name": also unverified accounts on my campus. */
    searchByUnverified: z.boolean().optional(),
    notifyLikes: z.boolean().optional(),
    distancePreference: z.number().int().min(1).max(100).optional(),
    seeking: z.string().optional(),
    preferences: preferencesSchema.optional(),
    /** An unverified account's chosen college (GOOGLE_SIGNUP_PLAN.md 1.3). */
    institutionId: z.string().uuid().optional(),
    campus: z.string().max(255).optional(),
    isHosteller: z.boolean().nullable().optional(),
    clubs: z.array(z.string().min(1).max(100)).max(50).optional(),
    hangoutSpots: z.array(z.string().min(1).max(100)).max(50).optional(),
    attendanceMood: z.string().max(100).optional(),
    profileVideoUrl: z.string().url().max(500).nullable().optional(),
    avatarUrl: z.string().url().max(500).nullable().optional(),
    photos: z.array(z.string().url().max(500).nullable()).max(6).optional(),
  }),
});
