import { NextFunction, Request, Response } from 'express';
import { ApiResponse } from '../utils/ApiResponse';
import { HttpError } from '../utils/httpError';
import { StoryAudienceService } from '../services/story-audience.service';
import { StoryReplyCardService } from '../services/story-reply-card.service';

const userId = (req: Request) => (req as any).user.sub as string;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cursorOf = (req: Request) => (typeof req.query.cursor === 'string' && /^\d{1,6}$/.test(req.query.cursor) ? req.query.cursor : undefined);

type Handler = (req: Request) => Promise<unknown>;
const handle = (handler: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(ApiResponse.success(await handler(req))); } catch (error) { next(error); }
};

/** Story settings, Close Friends, Hide story from, muted authors, and Story cards in chat. */
export const StoryAudienceController = {
  settings: handle((req) => StoryAudienceService.settings(userId(req))),
  people: handle((req) => StoryAudienceService.people(
    userId(req),
    req.query.list === 'hidden' ? 'hidden' : 'close_friends',
    typeof req.query.q === 'string' ? req.query.q.slice(0, 60) : '',
    cursorOf(req),
  )),

  closeFriends: handle((req) => StoryAudienceService.list(userId(req), 'close_friends', cursorOf(req))),
  addCloseFriend: handle((req) => StoryAudienceService.addCloseFriend(userId(req), String(req.params.userId))),
  removeCloseFriend: handle((req) => StoryAudienceService.removeCloseFriend(userId(req), String(req.params.userId))),
  clearCloseFriends: handle((req) => StoryAudienceService.clearCloseFriends(userId(req))),

  hidden: handle((req) => StoryAudienceService.list(userId(req), 'hidden', cursorOf(req))),
  hide: handle((req) => StoryAudienceService.hide(userId(req), String(req.params.userId))),
  unhide: handle((req) => StoryAudienceService.unhide(userId(req), String(req.params.userId))),

  muted: handle((req) => StoryAudienceService.muted(userId(req), cursorOf(req))),

  /** Cards for Story replies that arrived live, after the chat was loaded. */
  replyCards: handle(async (req) => {
    const ids = [...new Set((typeof req.query.ids === 'string' ? req.query.ids.split(',') : []).filter((id) => UUID.test(id)))];
    if (!ids.length || ids.length > 50) throw new HttpError(400, 'Give 1 to 50 story ids', 'INVALID_STORY_IDS');
    const cards = await StoryReplyCardService.cards(userId(req), ids);
    return { cards: [...cards.values()] };
  }),
};
