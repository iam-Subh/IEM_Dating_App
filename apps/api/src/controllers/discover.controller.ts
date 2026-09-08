import { Request, Response, NextFunction } from "express";
import { RecommendationService } from "../services/recommendation.service";
import { SwipeService } from "../services/swipe.service";
import { ImpressionService } from "../services/impression.service";
import { HttpError } from "../utils/httpError";
import { z } from "zod";
import { logger } from "../utils/logger";

export class DiscoverController {
  static async getRecommendations(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const started = Date.now();
    try {
      const limit =
        req.query.limit === undefined ? 20 : Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 40)
        throw new HttpError(400, "Limit must be between 1 and 40");
      if (req.query.page && req.query.page !== "1")
        throw new HttpError(409, "Use a discovery cursor", "DECK_EXPIRED");
      if (
        req.query.cursor !== undefined &&
        typeof req.query.cursor !== "string"
      )
        throw new HttpError(400, "Invalid cursor");
      const data = await RecommendationService.getRecommendations(
        (req as any).user.sub,
        req.query.cursor as string | undefined,
        limit,
        (work) => res.once("finish", work),
      );
      res.once("finish", () =>
        logger.info("discovery.page", {
          durationMs: Date.now() - started,
          state: data.state,
          deliveredCards: data.cards.length,
          existingDeck: Boolean(req.query.cursor),
          status: res.statusCode,
        }),
      );
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
  static async swipe(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = z
        .object({
          targetId: z.string().uuid(),
          action: z.enum(["like", "pass"]),
        })
        .safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "Invalid swipe");
      const data = await SwipeService.perform(
        (req as any).user.sub,
        parsed.data.targetId,
        parsed.data.action,
      );
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
  static async visible(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = z
        .object({ impressionId: z.string().uuid() })
        .safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "Invalid impression");
      await ImpressionService.recordVisible(
        (req as any).user.sub,
        parsed.data.impressionId,
      );
      res.status(200).json({ success: true });
    } catch (error) {
      next(error);
    }
  }
}
