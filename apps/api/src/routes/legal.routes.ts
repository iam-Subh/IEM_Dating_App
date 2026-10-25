import { Router } from 'express';
import { z } from 'zod';
import { protect } from '../middlewares/auth.middleware';
import { ApiResponse } from '../utils/ApiResponse';
import { prisma } from '../utils/prisma';
import { LEGAL_UPDATED, LEGAL_VERSION, legalConfig, legalDocument, legalIndex } from '../legal/documents';

/**
 * The published documents for the app, and agreeing to them
 * (docs/SAFETY_AND_LEGAL.md 6), under /api/v1/legal. The same documents are
 * public web pages at /legal (public-pages.routes.ts).
 */
const router = Router();

router.get('/', (_req, res) => {
  const { supportEmail, publicUrl } = legalConfig();
  res.json(ApiResponse.success({ version: LEGAL_VERSION, updated: LEGAL_UPDATED, supportEmail, webUrl: `${publicUrl}/legal`, documents: legalIndex() }));
});

router.get('/:slug', (req, res) => {
  const doc = legalDocument(String(req.params.slug));
  if (!doc) return res.status(404).json(ApiResponse.error('No such document', 'LEGAL_NOT_FOUND'));
  res.json(ApiResponse.success(doc));
});

/** "I agree" - at sign-up, and again when the Terms change in substance. */
router.post('/accept', protect, async (req, res, next) => {
  try {
    const body = z.object({ version: z.number().int().min(1) }).safeParse(req.body);
    if (!body.success || body.data.version !== LEGAL_VERSION) return res.status(400).json(ApiResponse.error('Agree to the current version', 'LEGAL_VERSION_MISMATCH'));
    const user = await prisma.user.update({
      where: { id: (req as any).user.sub },
      data: { termsVersion: LEGAL_VERSION, termsAcceptedAt: new Date() },
      select: { termsVersion: true, termsAcceptedAt: true },
    });
    res.json(ApiResponse.success(user));
  } catch (error) { next(error); }
});

export default router;
