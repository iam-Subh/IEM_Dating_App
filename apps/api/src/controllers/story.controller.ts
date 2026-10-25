import { NextFunction, Request, Response } from 'express';
import { ApiResponse } from '../utils/ApiResponse';
import { FollowService } from '../services/follow.service';
import { StoryService } from '../services/story.service';
import { HttpError } from '../utils/httpError';
import { StoryInsightService } from '../services/story-insight.service';

const userId = (req: Request) => (req as any).user.sub as string;

export class StoryController {
  static async requestFollow(req: Request, res: Response, next: NextFunction) {
    try { const data = await FollowService.request(userId(req), req.body.userId); res.status(data.repeated ? 200 : 201).json(ApiResponse.success(data)); } catch (error) { next(error); }
  }
  static async respondFollow(req: Request, res: Response, next: NextFunction) {
    try { res.json(ApiResponse.success(await FollowService.respond(userId(req), String(req.params.followId), req.body.accept))); } catch (error) { next(error); }
  }
  static async removeFollow(req: Request, res: Response, next: NextFunction) {
    try {
      const direction = req.query.direction === 'follower' ? 'follower' : 'following';
      res.json(ApiResponse.success(await FollowService.remove(userId(req), String(req.params.userId), direction)));
    } catch (error) { next(error); }
  }
  static async requests(req: Request, res: Response, next: NextFunction) {
    try { res.json(ApiResponse.success(await FollowService.requests(userId(req)))); } catch (error) { next(error); }
  }
  static async followers(req: Request, res: Response, next: NextFunction) {
    try { res.json(ApiResponse.success(await FollowService.list(userId(req), 'followers'))); } catch (error) { next(error); }
  }
  static async following(req: Request, res: Response, next: NextFunction) {
    try { res.json(ApiResponse.success(await FollowService.list(userId(req), 'following'))); } catch (error) { next(error); }
  }
  static async requestUpload(req: Request, res: Response, next: NextFunction) {
    try { res.status(201).json(ApiResponse.success(await StoryService.requestUpload(userId(req), String(req.query.ext ?? 'jpg')))); } catch (error) { next(error); }
  }
  static async completeUpload(req: Request, res: Response, next: NextFunction) {
    try { res.json(ApiResponse.success(await StoryService.completeUpload(userId(req), String(req.params.assetId)))); } catch (error) { next(error); }
  }
  static async publish(req: Request, res: Response, next: NextFunction) {
    try { const data = await StoryService.publish(userId(req), req.body); res.status(data.repeated ? 200 : 201).json(ApiResponse.success(data)); } catch (error) { next(error); }
  }
  static async feed(req: Request, res: Response, next: NextFunction) {
    try { res.json(ApiResponse.success(await StoryService.feedPage(userId(req), typeof req.query.cursor === 'string' ? req.query.cursor : undefined, Number(req.query.limit ?? 50)))); } catch (error) { next(error); }
  }
  static async tray(req: Request, res: Response, next: NextFunction) {
    try { res.json(ApiResponse.success(await StoryService.tray(userId(req)))); } catch (error) { next(error); }
  }
  /** One person's live Stories as a tray group, to open them from their profile. */
  static async owner(req: Request, res: Response, next: NextFunction) {
    try {
      const ownerId = String(req.params.userId ?? '');
      if (!/^[0-9a-f-]{36}$/i.test(ownerId)) throw new HttpError(404, 'Story is unavailable', 'STORY_UNAVAILABLE');
      const group = await StoryService.ownerGroup(userId(req), ownerId);
      if (!group) throw new HttpError(404, 'Story is unavailable', 'STORY_UNAVAILABLE');
      res.json(ApiResponse.success({ group }));
    } catch (error) { next(error); }
  }
  static async like(req: Request, res: Response, next: NextFunction) {
    try { res.json(ApiResponse.success(await StoryService.setLike(userId(req), String(req.params.storyId), req.body.liked))); } catch (error) { next(error); }
  }
  static async readUrl(req: Request, res: Response, next: NextFunction) {
    try { res.json(ApiResponse.success(await StoryService.readUrl(userId(req), String(req.params.storyId)))); } catch (error) { next(error); }
  }
  static async get(req: Request, res: Response, next: NextFunction) {
    try { res.json(ApiResponse.success(await StoryService.get(userId(req), String(req.params.storyId)))); } catch (error) { next(error); }
  }
  static async recordView(req: Request, res: Response, next: NextFunction) {
    try { res.json(ApiResponse.success(await StoryService.recordView(userId(req), String(req.params.storyId)))); } catch (error) { next(error); }
  }
  static async viewers(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(ApiResponse.success(await StoryService.viewersPage(
        userId(req), String(req.params.storyId), typeof req.query.cursor === 'string' ? req.query.cursor : undefined, Number(req.query.limit ?? 50),
        typeof req.query.q === 'string' ? req.query.q : undefined,
      )));
    } catch (error) { next(error); }
  }
  static async remove(req: Request, res: Response, next: NextFunction) {
    try { res.json(ApiResponse.success(await StoryService.remove(userId(req), String(req.params.storyId)))); } catch (error) { next(error); }
  }
  static async mute(req: Request, res: Response, next: NextFunction) {
    try { res.json(ApiResponse.success(await StoryService.mute(userId(req), String(req.params.authorId), req.body.muted))); } catch (error) { next(error); }
  }
  static async reply(req: Request, res: Response, next: NextFunction) {
    try {
      res.status(201).json(ApiResponse.success(await StoryService.reply(
        userId(req), String(req.params.storyId), req.body.content, req.body.clientMessageId, req.body.kind ?? 'text',
      )));
    } catch (error) { next(error); }
  }
  static async settings(req: Request, res: Response, next: NextFunction) {
    try { res.json(ApiResponse.success(await StoryService.settings(userId(req), req.body))); } catch (error) { next(error); }
  }
  static async recordInsightEvents(req: Request, res: Response, next: NextFunction) {
    try {
      await StoryInsightService.recordEvents(userId(req), req.body.batchId, req.body.events);
      res.status(202).json(ApiResponse.success({ recorded: true }));
    } catch (error) { next(error); }
  }
  static async insights(req: Request, res: Response, next: NextFunction) {
    try { res.json(ApiResponse.success(await StoryInsightService.get(userId(req), String(req.params.storyId)))); } catch (error) { next(error); }
  }
}
