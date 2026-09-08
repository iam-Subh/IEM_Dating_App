import { NextFunction, Request, Response } from 'express';
import { ApiResponse } from '../utils/ApiResponse';
import { FollowService } from '../services/follow.service';
import { StoryService } from '../services/story.service';

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
    try { res.status(201).json(ApiResponse.success(await StoryService.reply(userId(req), String(req.params.storyId), req.body.content, req.body.clientMessageId))); } catch (error) { next(error); }
  }
  static async settings(req: Request, res: Response, next: NextFunction) {
    try { res.json(ApiResponse.success(await StoryService.settings(userId(req), req.body))); } catch (error) { next(error); }
  }
}
