import { Router } from 'express';
import { z } from 'zod';
import { protect } from '../middlewares/auth.middleware';
import { ApiResponse } from '../utils/ApiResponse';
import { FEEDBACK_AREAS, FeedbackService } from '../services/feedback.service';

/** Bug reports and the in-app rating (docs/FEEDBACK.md). */
const router = Router();
router.use(protect);

const reportSchema = z.object({
  clientId: z.string().trim().min(8).max(64),
  area: z.enum(FEEDBACK_AREAS),
  description: z.string().trim().min(10, 'Tell us a little more - at least 10 characters.').max(2000),
  source: z.enum(['form', 'shake', 'error', 'rating']).default('form'),
  // App version, phone, screen, recent errors: shown to staff only.
  diagnostics: z.record(z.string(), z.unknown()).nullish()
    .refine((value) => !value || JSON.stringify(value).length <= 20_000, 'Technical details are too long'),
  attachments: z.array(z.object({ kind: z.enum(['photo', 'video']) })).max(6).default([]),
}).strict();

router.post('/reports', async (req, res, next) => {
  try {
    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(ApiResponse.error(parsed.error.issues[0]?.message ?? 'Check the report'));
    res.status(201).json(ApiResponse.success(await FeedbackService.createReport((req as any).user.sub, parsed.data)));
  } catch (error) { next(error); }
});
router.post('/reports/:id/attachments/:attachmentId/complete', async (req, res, next) => {
  try { res.json(ApiResponse.success(await FeedbackService.completeAttachment((req as any).user.sub, String(req.params.id), String(req.params.attachmentId)))); }
  catch (error) { next(error); }
});
router.get('/reports', async (req, res, next) => {
  try { res.json(ApiResponse.success(await FeedbackService.myReports((req as any).user.sub))); } catch (error) { next(error); }
});
router.post('/rating', async (req, res, next) => {
  try {
    const parsed = z.object({ score: z.number().int().min(1).max(5), comment: z.string().max(1000).nullish(), appVersion: z.string().max(30).nullish() }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json(ApiResponse.error('A score from 1 to 5'));
    const saved = await FeedbackService.rate((req as any).user.sub, parsed.data);
    res.status(201).json(ApiResponse.success({ id: saved.id }));
  } catch (error) { next(error); }
});

export default router;
