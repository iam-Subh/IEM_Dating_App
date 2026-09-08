import { z } from 'zod';

export const reportSchema = z.object({
  body: z.object({
    reportedUserId: z.string().uuid(),
    matchId: z.string().uuid().optional(),
    reason: z.string().min(3),
    description: z.string().max(2000).optional(),
    sourceType: z.enum(['profile', 'message', 'story']).optional(),
    sourceId: z.string().uuid().optional()
  })
});
