import { NextFunction, Request, Response } from 'express';
import { ApiResponse } from '../utils/ApiResponse';
import { HttpError } from '../utils/httpError';
import { StandoutsMetricsService } from '../services/standouts-metrics.service';
import { StandoutsWorker } from '../services/standouts.worker';
import { istDay } from '../services/discovery-cards.service';

/** Admin: how Standouts is doing, and the night run on demand (STANDOUTS_PLAN.md 6, 8). */
export class StandoutsAdminController {
  static async metrics(req: Request, res: Response, next: NextFunction) {
    try {
      const days = Number(req.query.days ?? 7);
      res.json(ApiResponse.success(await StandoutsMetricsService.summary(Number.isFinite(days) ? days : 7)));
    } catch (error) { next(error); }
  }

  /** Runs today's night run now (v3 or shadow must be on). Already finished: nothing to do. */
  static async run(req: Request, res: Response, next: NextFunction) {
    try {
      const day = typeof req.body?.day === 'string' ? req.body.day : istDay();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, 'day must be YYYY-MM-DD', 'INVALID_DAY');
      const result = await StandoutsWorker.run(day);
      res.json(ApiResponse.success(result ?? { skipped: true }, result ? 'Night run finished' : 'Nothing to run'));
    } catch (error) { next(error); }
  }
}
