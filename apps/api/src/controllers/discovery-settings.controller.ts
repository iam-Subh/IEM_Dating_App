import { Request, Response, NextFunction } from "express";
import { ERASED_POSITION, LocationService, SAVE_PLACE_FIX_MINUTES } from "../services/location.service";
import { prisma } from "../utils/prisma";
import {
  discoverySettingsSchema,
  ageAt,
  hasFreshLocation,
} from "../services/eligibility.service";
import { HttpError } from "../utils/httpError";
export class DiscoverySettingsController {
  static async get(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: (req as any).user.sub },
        select: {
          discoveryCategory: true,
          showMeCategories: true,
          minAgePref: true,
          maxAgePref: true,
          discoveryMode: true,
          distancePreference: true,
          expandRadius: true,
          collegeScope: true,
          campusId: true,
          preferencesConfirmedAt: true,
          college: true,
          birthday: true,
        },
      });
      res.json({
        success: true,
        data: { ...user, birthday: undefined, age: ageAt(user.birthday) },
      });
    } catch (error) {
      next(error);
    }
  }
  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = discoverySettingsSchema.safeParse(req.body);
      if (!parsed.success)
        throw new HttpError(
          400,
          parsed.error.issues.map((x) => x.message).join("; "),
        );
      const id = (req as any).user.sub;
      const me = await prisma.user.findUniqueOrThrow({ where: { id } });
      const age = ageAt(me.birthday);
      if (age === null || age < 18 || age > 120)
        throw new HttpError(400, "Set a valid adult birthday in your profile");
      if (parsed.data.discoveryMode === "college" && !me.college?.trim())
        throw new HttpError(400, "Set your college first");
      // Distance mode needs a location recent enough to use (LOCATION_SPEC.md
      // 6.8). A fix shared moments ago from college mode is kept only as the
      // baseline, so switching promotes it to the displayed location.
      const justShared =
        me.liveLatitude !== null &&
        me.liveLongitude !== null &&
        !!me.liveUpdatedAt &&
        Date.now() - me.liveUpdatedAt.getTime() <= SAVE_PLACE_FIX_MINUTES * 60_000;
      const promote =
        parsed.data.discoveryMode === "distance" && !hasFreshLocation(me) && justShared && !!me.locationConsentAt;
      if (parsed.data.discoveryMode === "distance" && !hasFreshLocation(me) && !promote)
        throw new HttpError(
          400,
          "Share your location first, or select college discovery",
          "LOCATION_REQUIRED",
        );
      // "My campus" with no campus set would match nobody, silently.
      if (parsed.data.collegeScope === "campus" && !me.campusId)
        throw new HttpError(400, "Choose your campus in your profile first", "CAMPUS_REQUIRED");
      // Only a real change to the radius counts against the daily budget; the
      // app sends it on every save (LOCATION_SPEC.md 6.3).
      const radiusChanged = await LocationService.assertRadiusChangeAllowed(
        id,
        me.distancePreference,
        parsed.data.distancePreference,
      );
      const updated = await prisma.user.update({
        where: { id },
        data: {
          ...parsed.data,
          showMeCategories: [...new Set(parsed.data.showMeCategories)],
          preferencesConfirmedAt: new Date(),
          eligibilityVersion: { increment: 1 },
          // College mode is decided by verified membership alone, so stored
          // coordinates would have no purpose - and data without a purpose is
          // erased, not kept (LOCATION_SPEC.md 6.6, DPDP). The consent stamp
          // stays as the audit record; sharing again asks again.
          ...(parsed.data.discoveryMode === "college" ? ERASED_POSITION : {}),
          ...(promote
            ? {
              latitude: me.liveLatitude,
              longitude: me.liveLongitude,
              locationUpdatedAt: new Date(),
              locationSource: "live",
              activePlaceId: null,
            }
            : {}),
        },
      });
      if (radiusChanged) await LocationService.recordRadiusChange(id);
      res.json({
        success: true,
        data: { preferencesConfirmedAt: updated.preferencesConfirmedAt },
      });
    } catch (error) {
      next(error);
    }
  }
}
