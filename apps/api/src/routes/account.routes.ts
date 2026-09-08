import { Router } from 'express';
import { z } from 'zod';
import { protect } from '../middlewares/auth.middleware';
import { AccountLifecycleService } from '../services/account-lifecycle.service';
import { ApiResponse } from '../utils/ApiResponse';

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

router.post('/deletion', async (req, res, next) => {
  try {
    const parsed = z.object({ confirmation: z.literal('DELETE') }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json(ApiResponse.error('Type DELETE to confirm account deletion'));
    res.status(202).json(ApiResponse.success(await AccountLifecycleService.requestDeletion((req as any).user.sub)));
  } catch (error) { next(error); }
});

router.delete('/deletion', async (req, res, next) => {
  try { res.json(ApiResponse.success(await AccountLifecycleService.cancelDeletion((req as any).user.sub))); }
  catch (error) { next(error); }
});

export default router;
