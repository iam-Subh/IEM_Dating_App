import { Request, Response, NextFunction } from "express";
import { prisma } from "../utils/prisma";
import {
  discoverySettingsSchema,
  ageAt,
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
      if (
        parsed.data.discoveryMode === "distance" &&
        (me.latitude === null || me.longitude === null || !me.locationConsentAt)
      )
        throw new HttpError(
          400,
          "Share your location first, or select college discovery",
        );
      const updated = await prisma.user.update({
        where: { id },
        data: {
          ...parsed.data,
          showMeCategories: [...new Set(parsed.data.showMeCategories)],
          preferencesConfirmedAt: new Date(),
          eligibilityVersion: { increment: 1 },
        },
      });
      res.json({
        success: true,
        data: { preferencesConfirmedAt: updated.preferencesConfirmedAt },
      });
    } catch (error) {
      next(error);
    }
  }
}
