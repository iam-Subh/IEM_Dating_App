import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { SearchService } from '../services/search.service';
import { HttpError } from '../utils/httpError';

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(40).optional(),
  category: z.enum(['for_you', 'new_here', 'active', 'shared_interests', 'same_department']).optional(),
  interests: z.string().max(200).optional(),
});

export class SearchController {
  static async explore(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) throw new HttpError(400, 'Explore filters are invalid', 'INVALID_EXPLORE_FILTERS');
      const data = await SearchService.explore((req as any).user.sub, {
        ...parsed.data,
        interests: parsed.data.interests?.split(','),
      });
      res.json({ success: true, data });
    } catch (error) { next(error); }
  }
}
