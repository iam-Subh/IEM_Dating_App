import { NextFunction, Request, Response, Router } from 'express';
import { protect } from '../middlewares/auth.middleware';
import { requireDatingEligibility } from '../middlewares/dating.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import { storyPublishRateLimiter } from '../middlewares/rateLimit.middleware';
import { StoryCreationController } from '../controllers/story-creation.controller';
import { storyBatchCreateSchema, storyBatchItemParamsSchema, storyBatchParamsSchema, storyBatchPartsSchema } from '../schemas/story-creation.schema';
import { ApiResponse } from '../utils/ApiResponse';
import { verifyStoryPublishToken } from '../utils/storyPublishToken';

/** Authenticates the device's background worker with a publish token scoped to one batch. */
function publishToken(req: Request, res: Response, next: NextFunction) {
  const [scheme, token] = String(req.headers.authorization ?? '').split(',')[0].trim().split(' ');
  if (scheme !== 'Bearer' || !token) return res.status(401).json(ApiResponse.error('Not authorized, no token provided'));
  try {
    (req as any).storyPublish = verifyStoryPublishToken(token);
    return next();
  } catch {
    return res.status(401).json(ApiResponse.error('Not authorized, token validation failed'));
  }
}

const router = Router();

// The worker's routes, registered first: they use the publish token, not a session.
router.post('/:batchId/items/:itemId/parts', publishToken, validateRequest(storyBatchPartsSchema), StoryCreationController.batchParts);
router.post('/:batchId/items/:itemId/publish', publishToken, validateRequest(storyBatchItemParamsSchema), StoryCreationController.publishBatchItem);
router.post('/:batchId/items/:itemId/skip', publishToken, validateRequest(storyBatchItemParamsSchema), StoryCreationController.skipBatchItem);

router.post('/', protect, requireDatingEligibility, storyPublishRateLimiter, validateRequest(storyBatchCreateSchema), StoryCreationController.createBatch);
router.get('/:batchId', protect, validateRequest(storyBatchParamsSchema), StoryCreationController.batchStatus);
router.post('/:batchId/ticket', protect, validateRequest(storyBatchParamsSchema), StoryCreationController.batchTicket);
router.delete('/:batchId', protect, validateRequest(storyBatchParamsSchema), StoryCreationController.cancelBatch);

export default router;
