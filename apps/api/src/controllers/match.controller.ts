import { Request, Response, NextFunction } from 'express';
import { MatchService } from '../services/match.service';
import { NewMatchService } from '../services/new-match.service';
import { ApiResponse } from '../utils/ApiResponse';

export class MatchController {
  static async unmatch(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await MatchService.unmatch((req as any).user.sub, req.params.matchId as string);
      res.status(200).json(ApiResponse.success(result, 'Match ended'));
    } catch (error) { next(error); }
  }
  static async getPendingMatches(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user.sub;
      const matches = await MatchService.getMatches(userId);
      res.status(200).json(ApiResponse.success(matches));
    } catch (error) {
      next(error);
    }
  }

  static async newMatches(req: Request, res: Response, next: NextFunction) {
    try {
      res.status(200).json(ApiResponse.success(await NewMatchService.list((req as any).user.sub)));
    } catch (error) { next(error); }
  }

  static async markSeen(req: Request, res: Response, next: NextFunction) {
    try {
      res.status(200).json(ApiResponse.success(await NewMatchService.markSeen((req as any).user.sub, String(req.params.matchId))));
    } catch (error) { next(error); }
  }

  static async intro(req: Request, res: Response, next: NextFunction) {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(ApiResponse.success(await NewMatchService.intro((req as any).user.sub, String(req.params.matchId))));
    } catch (error) { next(error); }
  }

  static async swipe(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user.sub;
      const { targetUserId, action } = req.body;
      const result = await MatchService.performSwipe(userId, targetUserId, action);
      res.status(200).json(ApiResponse.success(result, 'Swipe recorded'));
    } catch (error) {
      if ((error as Error).message.includes('limit')) {
        return res.status(429).json(ApiResponse.error((error as Error).message));
      }
      next(error);
    }
  }
}
