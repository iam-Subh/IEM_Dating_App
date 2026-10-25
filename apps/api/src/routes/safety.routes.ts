import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma';
import { SafetyController } from '../controllers/safety.controller';
import { SafetyService } from '../services/safety.service';
import { protect } from '../middlewares/auth.middleware';
import { adminGuard } from '../middlewares/adminGuard.middleware';
import { adminAudit } from '../middlewares/adminAudit.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import { reportSchema } from '../schemas/safety.schema';

const router = Router();

// User endpoint — file a report
router.post('/report', protect, validateRequest(reportSchema), SafetyController.report);
// Hidden Words: messages and notes with these are folded away, for this person only.
router.get('/hidden-words', protect, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: (req as any).user.sub }, select: { hiddenWords: true } });
    res.json({ success: true, data: user?.hiddenWords ?? [] });
  } catch (error) { next(error); }
});
router.put('/hidden-words', protect, async (req, res, next) => {
  try {
    const parsed = z.object({ words: z.array(z.string().trim().min(1).max(40)).max(300) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Up to 300 words, each up to 40 characters' });
    const words = [...new Set(parsed.data.words.map((word) => word.toLowerCase()))];
    const user = await prisma.user.update({ where: { id: (req as any).user.sub }, data: { hiddenWords: words }, select: { hiddenWords: true } });
    res.json({ success: true, data: user.hiddenWords });
  } catch (error) { next(error); }
});

// People you can still report after unmatching or blocking.
router.get('/reportable', protect, async (req, res, next) => {
  try { res.json({ success: true, data: await SafetyService.reportable((req as any).user.sub) }); } catch (error) { next(error); }
});

// Admin endpoints — manage reports
router.get('/reports', protect, adminGuard, SafetyController.getReports);
router.patch('/reports/:id/resolve', protect, adminGuard, adminAudit, SafetyController.resolveReport);
router.get('/cases', protect, adminGuard, SafetyController.getCases);
router.patch('/cases/:id', protect, adminGuard, adminAudit, SafetyController.updateCase);

export default router;
