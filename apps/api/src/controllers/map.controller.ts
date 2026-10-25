import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { HttpError } from '../utils/httpError';
import { MapService } from '../services/map.service';

const userId = (req: Request) => (req as any).user.sub as string;

/** The map (LOCATION_SPEC.md section 9). */
export class MapController {
  static async map(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ success: true, data: await MapService.map(userId(req)) });
    } catch (error) { next(error); }
  }

  static async search(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = z.object({
        q: z.string().max(80),
        lat: z.coerce.number().min(-90).max(90).optional(),
        lon: z.coerce.number().min(-180).max(180).optional(),
      }).safeParse(req.query);
      if (!parsed.success) throw new HttpError(400, 'Invalid search', 'INVALID_PLACE_SEARCH');
      const near = parsed.data.lat !== undefined && parsed.data.lon !== undefined
        ? { latitude: parsed.data.lat, longitude: parsed.data.lon }
        : undefined;
      res.json({ success: true, data: { places: await MapService.searchPlaces(parsed.data.q, near) } });
    } catch (error) { next(error); }
  }

  static async mine(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ success: true, data: { places: await MapService.myPlaces(userId(req)) } });
    } catch (error) { next(error); }
  }

  static async add(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = z.object({ externalId: z.string().min(3).max(160) }).strict().safeParse(req.body ?? {});
      if (!parsed.success) throw new HttpError(400, 'Invalid place', 'INVALID_PLACE');
      res.json({ success: true, data: { places: await MapService.addMyPlace(userId(req), parsed.data.externalId) } });
    } catch (error) { next(error); }
  }

  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const placeId = z.string().uuid().safeParse(req.params.placeId);
      if (!placeId.success) throw new HttpError(404, 'That spot is not pinned.', 'MAP_PLACE_NOT_FOUND');
      res.json({ success: true, data: { places: await MapService.removeMyPlace(userId(req), placeId.data) } });
    } catch (error) { next(error); }
  }
}
