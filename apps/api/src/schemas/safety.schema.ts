import { z } from 'zod';

export const reportSchema = z.object({
  body: z.object({
    reportedUserId: z.string().uuid(),
    matchId: z.string().uuid().optional(),
    // A code from report-reasons.ts; older apps send a short phrase.
    reason: z.string().min(3).max(120),
    description: z.string().max(2000).optional(),
    sourceType: z.enum(['profile', 'message', 'story', 'rose', 'comment']).optional(),
    sourceId: z.string().uuid().optional()
  })
});
