import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { HttpError } from '../utils/httpError';
import { LocationService } from '../services/location.service';

const userId = (req: Request) => (req as any).user.sub as string;

const settingsSchema = z.object({
  hideDistance: z.boolean().optional(),
  hideFromMaps: z.boolean().optional(),
  // null turns invisible hours off; minutes after midnight, India time.
  invisibleHours: z
    .object({ start: z.number().int().min(0).max(1439), end: z.number().int().min(0).max(1439) })
    .nullable()
    .optional(),
}).strict();

const placeSchema = z.object({ label: z.string().max(60) }).strict();
const placeChangeSchema = z.object({
  label: z.string().max(60).optional(),
  hideHere: z.boolean().optional(),
}).strict();
const sourceSchema = z.object({
  placeId: z.string().uuid().nullable(),
  // Going back to the phone sends the phone's fix with the switch, so the
  // saved place and the new position change together.
  fix: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.enum(['precise', 'approximate']).optional(),
    accuracyM: z.number().min(0).optional(),
  }).strict().optional(),
}).strict();

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join('; '), 'INVALID_LOCATION_REQUEST');
  return parsed.data;
}

/** Location settings (LOCATION_SPEC.md sections 6, 7 and 9.4). */
export class LocationController {
  static async status(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ success: true, data: await LocationService.status(userId(req)) });
    } catch (error) { next(error); }
  }

  static async settings(req: Request, res: Response, next: NextFunction) {
    try {
      const change = parse(settingsSchema, req.body);
      res.json({ success: true, data: await LocationService.updateSettings(userId(req), change) });
    } catch (error) { next(error); }
  }

  static async savePlace(req: Request, res: Response, next: NextFunction) {
    try {
      const { label } = parse(placeSchema, req.body);
      res.status(201).json({ success: true, data: await LocationService.savePlace(userId(req), label) });
    } catch (error) { next(error); }
  }

  static async updatePlace(req: Request, res: Response, next: NextFunction) {
    try {
      const placeId = z.string().uuid().safeParse(req.params.placeId);
      if (!placeId.success) throw new HttpError(404, 'That place is not saved.', 'PLACE_NOT_FOUND');
      const change = parse(placeChangeSchema, req.body);
      res.json({ success: true, data: await LocationService.updatePlace(userId(req), placeId.data, change) });
    } catch (error) { next(error); }
  }

  static async deletePlace(req: Request, res: Response, next: NextFunction) {
    try {
      const placeId = z.string().uuid().safeParse(req.params.placeId);
      if (!placeId.success) throw new HttpError(404, 'That place is not saved.', 'PLACE_NOT_FOUND');
      res.json({ success: true, data: await LocationService.deletePlace(userId(req), placeId.data) });
    } catch (error) { next(error); }
  }

  static async source(req: Request, res: Response, next: NextFunction) {
    try {
      const { placeId, fix } = parse(sourceSchema, req.body);
      if (fix && placeId !== null) throw new HttpError(400, 'A fix only goes with switching back to your phone.', 'INVALID_LOCATION_REQUEST');
      res.json({ success: true, data: await LocationService.useSource(userId(req), placeId, fix) });
    } catch (error) { next(error); }
  }
}
