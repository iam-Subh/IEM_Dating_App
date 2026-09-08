import { Request, Response, NextFunction } from 'express';
import { SafetyService } from '../services/safety.service';
import { ApiResponse } from '../utils/ApiResponse';
import { z } from 'zod';

export class SafetyController {
  /**
   * POST /safety/report — File a report against a user.
   */
  static async report(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user.sub;
      const report = await SafetyService.fileReport(userId, req.body);
      res.status(201).json(ApiResponse.success(report, 'Report submitted successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /safety/reports — Admin: list reports (filterable by ?status=pending).
   */
  static async getReports(req: Request, res: Response, next: NextFunction) {
    try {
      const status = req.query.status as string | undefined;
      const page = parseInt(req.query.page as string) || 1;
      const result = await SafetyService.getReports(status, page);
      res.status(200).json(ApiResponse.success(result));
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /safety/reports/:id/resolve — Admin: resolve a report.
   * Body: { action: 'resolved' | 'dismissed', banUser?: boolean }
   */
  static async resolveReport(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { action, banUser } = req.body;

      if (!action || !['resolved', 'reviewed', 'dismissed'].includes(action)) {
        res.status(400).json(ApiResponse.error('Invalid action'));
        return;
      }

      const report = await SafetyService.resolveReport(id, action, banUser);
      res.status(200).json(ApiResponse.success(report, 'Report resolved'));
    } catch (error) {
      next(error);
    }
  }

  static async getCases(req: Request, res: Response, next: NextFunction) {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const page = Math.max(1, Number(req.query.page) || 1);
      res.json(ApiResponse.success(await SafetyService.getCases(status, page)));
    } catch (error) { next(error); }
  }

  static async updateCase(req: Request, res: Response, next: NextFunction) {
    try {
      const schema = z.object({
        status: z.enum(['open', 'reviewing', 'resolved', 'dismissed']).optional(),
        priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
        assignedAdminId: z.string().uuid().nullable().optional(),
        accountAction: z.enum(['none', 'restrict', 'ban', 'restore']).optional(),
        resolution: z.string().min(1).max(2000).optional(),
      }).strict().refine((value) => Object.keys(value).length > 0);
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json(ApiResponse.error('Invalid moderation case update'));
      const result = await SafetyService.updateCase(
        req.params.id as string,
        (req as any).user.sub,
        parsed.data,
      );
      res.json(ApiResponse.success(result));
    } catch (error) { next(error); }
  }
}
