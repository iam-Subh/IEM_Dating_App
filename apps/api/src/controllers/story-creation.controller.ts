import { NextFunction, Request, Response } from 'express';
import { ApiResponse } from '../utils/ApiResponse';
import type { StoryPublishClaims } from '../utils/storyPublishToken';
import { MusicService } from '../services/music.service';
import { StoryBatchService } from '../services/story-batch.service';
import { StorySearchService } from '../services/story-search.service';
import { StoryService } from '../services/story.service';
import { StoryCaptionService } from '../services/story-captions.service';
import { StoryStickerService } from '../services/story-sticker.service';

const userId = (req: Request) => (req as any).user.sub as string;
const claims = (req: Request) => (req as any).storyPublish as StoryPublishClaims;
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const number = (value: unknown) => {
  const parsed = typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

type Handler = (req: Request) => Promise<unknown>;
const handle = (handler: Handler, status = 200) => async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(status).json(ApiResponse.success(await handler(req))); } catch (error) { next(error); }
};

/** Story creation: background batches, interactive stickers, music and sticker search. */
export const StoryCreationController = {
  createBatch: handle((req) => StoryBatchService.create(userId(req), req.body), 201),
  batchStatus: handle((req) => StoryBatchService.status(userId(req), String(req.params.batchId))),
  batchTicket: handle((req) => StoryBatchService.ticket(userId(req), String(req.params.batchId))),
  cancelBatch: handle((req) => StoryBatchService.cancel(userId(req), String(req.params.batchId))),
  batchParts: handle((req) => StoryBatchService.parts(claims(req), String(req.params.batchId), String(req.params.itemId), req.body ?? {})),
  skipBatchItem: handle((req) => StoryBatchService.skipItem(claims(req), String(req.params.batchId), String(req.params.itemId), typeof req.body?.reason === 'string' ? req.body.reason : undefined)),
  publishBatchItem: handle((req) => StoryBatchService.publishItem(claims(req), String(req.params.batchId), String(req.params.itemId))),

  stickers: handle((req) => StoryStickerService.forStory(userId(req), String(req.params.storyId))),
  respondSticker: handle((req) => StoryStickerService.respond(userId(req), String(req.params.storyId), String(req.params.stickerId), req.body)),
  stickerResults: handle((req) => StoryStickerService.results(userId(req), String(req.params.storyId), String(req.params.stickerId))),
  stickerLinkTap: handle((req) => StoryStickerService.linkTap(userId(req), String(req.params.storyId), String(req.params.stickerId))),

  person: handle((req) => StoryStickerService.person(
    userId(req), String(req.params.userId), typeof req.query.storyId === 'string' && UUID.test(req.query.storyId) ? req.query.storyId : undefined,
  )),
  addYoursThread: handle((req) => StoryService.addYoursThread(userId(req), String(req.params.threadId))),
  createCaptions: handle((req) => StoryCaptionService.create(userId(req)), 201),
  startCaptions: handle((req) => StoryCaptionService.start(userId(req), String(req.params.jobId))),
  captionStatus: handle((req) => StoryCaptionService.status(userId(req), String(req.params.jobId))),
  mentionSearch: handle((req) => StoryStickerService.searchMentions(userId(req), text(req.query.q, 60), req.query.audience === 'close_friends' ? 'close_friends' : 'followers')),
  placeSearch: handle(async (req) => {
    const lat = number(req.query.lat);
    const lon = number(req.query.lon);
    const near = lat !== undefined && lon !== undefined && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : undefined;
    return { places: await StorySearchService.places(text(req.query.q, 80), near) };
  }),
  gifSearch: handle((req) => StorySearchService.gifs(text(req.query.q, 50), number(req.query.offset) ?? 0)),

  musicTrending: handle((req) => MusicService.trending(req.query.explicit === '1')),
  musicSearch: handle((req) => MusicService.search(text(req.query.q, 100), number(req.query.page) ?? 1, req.query.explicit === '1')),
  musicTrack: handle(async (req) => ({ track: await MusicService.track(String(req.params.trackId)) })),
  musicLyrics: handle((req) => MusicService.lyrics(String(req.params.trackId))),
};
