import { NextFunction, Request, Response } from 'express';
import { ApiResponse } from '../utils/ApiResponse';
import { HttpError } from '../utils/httpError';
import { StoryArchiveService } from '../services/story-archive.service';

const userId = (req: Request) => (req as any).user.sub as string;
const cursorOf = (req: Request) => (typeof req.query.cursor === 'string' && req.query.cursor.length <= 200 ? req.query.cursor : undefined);
const limitOf = (req: Request) => {
  const raw = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : NaN;
  return Number.isFinite(raw) ? raw : undefined;
};

type Handler = (req: Request) => Promise<unknown>;
const handle = (handler: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(ApiResponse.success(await handler(req))); } catch (error) { next(error); }
};

/** The owner's private Archive: ended Stories kept after the tray, a calendar view, and "On this day". */
export const StoryArchiveController = {
  list: handle((req) => StoryArchiveService.list(
    userId(req), cursorOf(req), limitOf(req),
    typeof req.query.date === 'string' ? req.query.date : undefined,
  )),

  calendar: handle((req) => {
    const month = typeof req.query.month === 'string' ? req.query.month : '';
    if (!month) throw new HttpError(400, 'month is required', 'ARCHIVE_MONTH_REQUIRED');
    return StoryArchiveService.calendar(userId(req), month);
  }),

  memories: handle((req) => StoryArchiveService.memories(userId(req))),
};
