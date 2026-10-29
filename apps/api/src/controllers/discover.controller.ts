import { Request, Response, NextFunction } from "express";
import { RecommendationService } from "../services/recommendation.service";
import { SwipeService } from "../services/swipe.service";
import { ImpressionService } from "../services/impression.service";
import { LIKES_SORTS, LikesService } from "../services/likes.service";
import { ROSE_COMMENT_MAX, RoseService } from "../services/rose.service";
import { StandoutsService } from "../services/standouts.service";
import { RewindService } from "../services/rewind.service";
import { LIKE_COMMENT_MAX, LikeCommentService } from "../services/like-comment.service";
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
          // A Rose rides along with the Like, spent in the same transaction.
          rose: z.boolean().optional(),
          comment: z.string().trim().max(ROSE_COMMENT_MAX).optional(),
          // A comment about one photo or the bio (like-comment.service.ts).
          about: z
            .discriminatedUnion("kind", [
              z.object({ kind: z.literal("photo"), photoUrl: z.string().url().max(1000) }),
              z.object({ kind: z.literal("bio") }),
            ])
            .optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "Invalid swipe");
      const comment = parsed.data.comment || null;
      const data = await SwipeService.perform(
        (req as any).user.sub,
        parsed.data.targetId,
        parsed.data.action,
        parsed.data.rose ? { comment } : undefined,
        parsed.data.about && comment ? { comment, about: parsed.data.about } : undefined,
      );
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
  /** Would this comment be sent? The same check as the swipe, nothing written. */
  static async checkComment(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = z.object({ comment: z.string().trim().min(1).max(LIKE_COMMENT_MAX) }).safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "Write a comment first", "INVALID_COMMENT");
      LikeCommentService.check(parsed.data.comment);
      res.status(200).json({ success: true, data: { ok: true } });
    } catch (error) {
      next(error);
    }
  }
  /** Who has liked you and can be answered, Roses first (STANDOUTS_LIKES_SPEC.md 4). */
  static async likesYou(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = z
        .object({
          cursor: z.string().max(120).optional(),
          limit: z.coerce.number().int().min(1).max(40).optional(),
          sort: z.enum(LIKES_SORTS).optional(),
        })
        .safeParse(req.query);
      if (!parsed.success) throw new HttpError(400, "Likes filters are invalid", "INVALID_LIKES_QUERY");
      const data = await LikesService.received((req as any).user.sub, parsed.data);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** The dot on the heart: whether anything is new, and whether a Rose is among it (4.4). */
  static async likesSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await LikesService.summary((req as any).user.sub);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  static async likesSeen(req: Request, res: Response, next: NextFunction) {
    try {
      await LikesService.markSeen((req as any).user.sub);
      res.status(200).json({ success: true, data: { seen: true } });
    } catch (error) {
      next(error);
    }
  }

  /** "Not for me" on a Standout: hidden for the day, never a Pass (5.4). */
  static async hideStandout(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = z.object({ userId: z.string().uuid() }).safeParse(req.params);
      if (!parsed.success) throw new HttpError(400, "Invalid profile", "INVALID_STANDOUT");
      const data = await StandoutsService.hide((req as any).user.sub, parsed.data.userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** Whether the last swipe can still be undone, and for how long. */
  static async rewindStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await RewindService.available((req as any).user.sub);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** Undo the last swipe, narrowly (EXPLORE_SPEC.md, section 12). */
  static async rewind(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = z
        .object({ targetId: z.string().uuid().optional() })
        .safeParse(req.body ?? {});
      if (!parsed.success) throw new HttpError(400, "Invalid rewind");
      const data = await RewindService.rewind((req as any).user.sub, parsed.data.targetId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** The day's Standouts: Rose-only, personalised, no counts (EXPLORE_SPEC.md, section 11). */
  static async standouts(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await StandoutsService.today((req as any).user.sub);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** "Learning your type": swipes so far, for the Explore pill and the ring on the Standouts icon. */
  static async standoutsLearning(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await StandoutsService.learning((req as any).user.sub);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** The Rose balance, after any overdue weekly top-up. */
  static async roses(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await RoseService.balance((req as any).user.sub);
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
