import { NextFunction, Request, Response } from 'express';
import { HttpError } from '../utils/httpError';
import { PreferencesService, preferencesSchema } from '../services/preferences.service';

function parse(body: unknown) {
  const parsed = preferencesSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join('; '), 'INVALID_PREFERENCES');
  return parsed.data;
}

export class PreferencesController {
  static async read(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ success: true, data: await PreferencesService.read((req as any).user.sub) });
    } catch (error) { next(error); }
  }

  static async save(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ success: true, data: await PreferencesService.save((req as any).user.sub, parse(req.body)) });
    } catch (error) { next(error); }
  }

  static async switchArea(req: Request, res: Response, next: NextFunction) {
    try {
      const area = req.body?.area;
      if (area !== 'nearby' && area !== 'college') throw new HttpError(400, 'Choose nearby or college', 'INVALID_AREA');
      res.json({ success: true, data: await PreferencesService.switchArea((req as any).user.sub, area) });
    } catch (error) { next(error); }
  }

  static async estimate(req: Request, res: Response, next: NextFunction) {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, data: await PreferencesService.estimate((req as any).user.sub, parse(req.body)) });
    } catch (error) { next(error); }
  }
}
