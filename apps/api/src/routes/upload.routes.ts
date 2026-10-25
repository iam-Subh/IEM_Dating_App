import { Router } from 'express';
import { UploadController } from '../controllers/upload.controller';
import { protect } from '../middlewares/auth.middleware';
import { requireDatingEligibility } from '../middlewares/dating.middleware';

const router = Router();

// Protect all upload routes
router.use(protect, requireDatingEligibility);

// Profile photos and the profile video upload straight to storage with a
// presigned URL, then are checked and processed on completion. The older
// multipart routes (/photos, /video, /media) wrote to the public bucket with
// no content checks and are no longer used by the app, so they are gone.
router.post('/presigned-urls', UploadController.getPresignedUrls);
router.post('/:assetId/complete', UploadController.completePresignedUpload);

export default router;
