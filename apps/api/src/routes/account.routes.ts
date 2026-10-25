import { Router } from 'express';
import { z } from 'zod';
import { protect } from '../middlewares/auth.middleware';
import { AccountLifecycleService } from '../services/account-lifecycle.service';
import { ApiResponse } from '../utils/ApiResponse';
import { prisma } from '../utils/prisma';
import { Prisma } from '@prisma/client';

const router = Router();
router.use(protect);

router.post('/exports', async (req, res, next) => {
  try { res.status(201).json(ApiResponse.success(await AccountLifecycleService.createExport((req as any).user.sub))); }
  catch (error) { next(error); }
});

router.get('/requests/:id', async (req, res, next) => {
  try { res.json(ApiResponse.success(await AccountLifecycleService.getRequest((req as any).user.sub, req.params.id as string))); }
  catch (error) { next(error); }
});

const DELETION_REASONS = ['found_someone', 'taking_a_break', 'not_enough_matches', 'not_working', 'privacy', 'other'] as const;

router.get('/deletion', async (req, res, next) => {
  try { res.json(ApiResponse.success(await AccountLifecycleService.pendingDeletion((req as any).user.sub))); }
  catch (error) { next(error); }
});

router.post('/deletion', async (req, res, next) => {
  try {
    const parsed = z.object({
      confirmation: z.literal('DELETE'),
      reason: z.enum(DELETION_REASONS).optional(),
      note: z.string().max(500).optional(),
    }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json(ApiResponse.error('Type DELETE to confirm account deletion'));
    const { reason, note } = parsed.data;
    res.status(202).json(ApiResponse.success(await AccountLifecycleService.requestDeletion((req as any).user.sub, { reason, note })));
  } catch (error) { next(error); }
});

router.delete('/deletion', async (req, res, next) => {
  try { res.json(ApiResponse.success(await AccountLifecycleService.cancelDeletion((req as any).user.sub))); }
  catch (error) { next(error); }
});

// DPDP Act section 14: who may exercise this person's data rights if they die or can't.
const nomineeSchema = z.object({
  name: z.string().trim().min(2).max(80),
  contact: z.string().trim().min(5).max(120),
  relation: z.string().trim().max(40).optional(),
}).strict();
router.get('/nominee', protect, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: (req as any).user.sub }, select: { nominee: true } });
    res.json(ApiResponse.success(user?.nominee ?? null));
  } catch (error) { next(error); }
});
router.put('/nominee', protect, async (req, res, next) => {
  try {
    const parsed = nomineeSchema.nullable().safeParse(req.body?.nominee ?? null);
    if (!parsed.success) return res.status(400).json(ApiResponse.error('A name and a phone or email', 'NOMINEE_INVALID'));
    const user = await prisma.user.update({ where: { id: (req as any).user.sub }, data: { nominee: parsed.data ?? Prisma.DbNull }, select: { nominee: true } });
    res.json(ApiResponse.success(user.nominee ?? null));
  } catch (error) { next(error); }
});

export default router;
