import { ApiResponse } from '../utils/ApiResponse';
import { ProfileNudity } from '../services/profile-nudity.service';
import { BirthdayChangeService } from '../services/birthday-change.service';
import { Router } from 'express';
import { ProfileController } from '../controllers/profile.controller';
import { ProfileVideoService } from '../services/profile-video.service';
import { protect } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import { updateProfileSchema } from '../schemas/profile.schema';
import { DiscoverySettingsController } from '../controllers/discovery-settings.controller';
import { discoveryRateLimiter, locationRateLimiter } from '../middlewares/rateLimit.middleware';
import { PreferencesController } from '../controllers/preferences.controller';
import { AppSettingsController } from '../controllers/app-settings.controller';
import { LocationController } from '../controllers/location.controller';
import { CampusController } from '../controllers/campus.controller';

const router = Router();

router.get('/', protect, ProfileController.getProfile);
// The profile video's state for Edit profile, and restarting failed processing.
router.get('/video', protect, async (req, res, next) => {
  try { res.setHeader('Cache-Control', 'no-store'); res.json({ success: true, data: await ProfileVideoService.read((req as any).user.sub) }); } catch (error) { next(error); }
});
router.post('/video/retry', protect, async (req, res, next) => {
  try { res.json({ success: true, data: await ProfileVideoService.retry((req as any).user.sub) }); } catch (error) { next(error); }
});
router.get('/readiness', protect, ProfileController.getReadiness);
// A second birthday change: support, with a photo of an ID (GOOGLE_SIGNUP_PLAN.md 6.2).
router.post('/birthday-requests/upload-url', protect, async (req, res, next) => {
  try { res.json(ApiResponse.success(await BirthdayChangeService.uploadUrl((req as any).user.sub))); } catch (error) { next(error); }
});
router.post('/birthday-requests', protect, async (req, res, next) => {
  try {
    const { newBirthday, idObjectKey } = req.body ?? {};
    if (typeof newBirthday !== 'string' || typeof idObjectKey !== 'string') return res.status(400).json(ApiResponse.error('A new birthday and an ID photo are required'));
    res.status(201).json(ApiResponse.success(await BirthdayChangeService.create((req as any).user.sub, newBirthday, idObjectKey)));
  } catch (error) { next(error); }
});
router.get('/birthday-requests/mine', protect, async (req, res, next) => {
  try { res.json(ApiResponse.success(await BirthdayChangeService.mine((req as any).user.sub))); } catch (error) { next(error); }
});
router.get('/matches/:matchId', protect, ProfileController.getMatchProfile);
router.get('/discovery', protect, DiscoverySettingsController.get);
router.put('/discovery', protect, DiscoverySettingsController.update);
// My preferences (PREFERENCES_SPEC.md): read, save on Done, and a live estimate while editing.
router.get('/preferences', protect, PreferencesController.read);
router.put('/preferences', protect, PreferencesController.save);
router.put('/preferences/area', protect, PreferencesController.switchArea);
// App settings: notifications, this phone, Team IEM Connect.
router.get('/app-settings', protect, AppSettingsController.read);
router.put('/app-settings/notifications', protect, AppSettingsController.setNotification);
router.post('/preferences/estimate', protect, discoveryRateLimiter, PreferencesController.estimate);
router.put('/', protect, validateRequest(updateProfileSchema), ProfileController.updateProfile);

router.get('/campuses', protect, CampusController.mine);

// Location (LOCATION_SPEC.md). Writes that can move someone share the burst limit.
router.get('/location', protect, LocationController.status);
router.put('/location', protect, locationRateLimiter, ProfileController.updateLocation);
router.delete('/location', protect, ProfileController.removeLocation);
router.put('/location/settings', protect, LocationController.settings);
router.put('/location/source', protect, locationRateLimiter, LocationController.source);
router.post('/location/places', protect, locationRateLimiter, LocationController.savePlace);
router.patch('/location/places/:placeId', protect, LocationController.updatePlace);
router.delete('/location/places/:placeId', protect, LocationController.deletePlace);

// A photo or video waiting for the nudity check's review: the owner can take it back (docs/NUDITY_CHECK.md).
router.delete('/pending-media/:id', protect, async (req, res, next) => {
  try {
    await ProfileNudity.withdraw((req as any).user.sub, String(req.params.id));
    res.json(ApiResponse.success({ withdrawn: true }));
  } catch (error) { next(error); }
});

export default router;
