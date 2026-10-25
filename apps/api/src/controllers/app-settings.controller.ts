import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { HttpError } from '../utils/httpError';
import { ApiResponse } from '../utils/ApiResponse';
import { AppSettingsService } from '../services/app-settings.service';
import { TeamUpdatesService } from '../services/team-updates.service';

const toggle = z.object({ key: z.string().min(1).max(40), value: z.boolean() }).strict();
const teamUpdate = z.object({ title: z.string().trim().min(3).max(80), body: z.string().trim().min(3).max(240), url: z.string().max(200).optional() }).strict();

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join('; '), 'INVALID_SETTING');
  return parsed.data;
}

export class AppSettingsController {
  static async read(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(ApiResponse.success(await AppSettingsService.read((req as any).user.sub)));
    } catch (error) { next(error); }
  }

  static async setNotification(req: Request, res: Response, next: NextFunction) {
    try {
      const { key, value } = parse(toggle, req.body);
      res.json(ApiResponse.success(await AppSettingsService.setNotification((req as any).user.sub, key, value)));
    } catch (error) { next(error); }
  }

  /** Admin: send an update from Team IEM Connect to everyone who wants them. */
  static async sendTeamUpdate(req: Request, res: Response, next: NextFunction) {
    try {
      const input = parse(teamUpdate, req.body);
      res.status(202).json(ApiResponse.success(await TeamUpdatesService.send(input), 'Team update is being sent'));
    } catch (error) { next(error); }
  }
}
