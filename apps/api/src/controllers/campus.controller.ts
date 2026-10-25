import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { HttpError } from '../utils/httpError';
import { CampusService } from '../services/campus.service';

const anchorSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
}).strict().nullable();

export class CampusController {
  /** The signed-in person's campus list, for the campus pickers. */
  static async mine(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ success: true, data: await CampusService.mine((req as any).user.sub) });
    } catch (error) { next(error); }
  }

  static async all(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ success: true, data: await CampusService.all() });
    } catch (error) { next(error); }
  }

  /** Admin: drop a campus's map pin (e.g. UEM Jaipur, which OpenStreetMap lacks). */
  static async setAnchor(req: Request, res: Response, next: NextFunction) {
    try {
      const id = z.string().uuid().safeParse(req.params.campusId);
      if (!id.success) throw new HttpError(404, 'Campus not found', 'CAMPUS_NOT_FOUND');
      const parsed = anchorSchema.safeParse(req.body?.anchor ?? null);
      if (!parsed.success) throw new HttpError(400, 'Send { anchor: { latitude, longitude } } or { anchor: null }', 'INVALID_COORDINATES');
      res.json({ success: true, data: await CampusService.setAnchor(id.data, parsed.data) });
    } catch (error) { next(error); }
  }
}
