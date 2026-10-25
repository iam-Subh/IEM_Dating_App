import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { EXPLORE_ATTRIBUTES, EXPLORE_SORTS, ExploreService, type ExploreAttribute, type ExploreAttributeKey } from '../services/explore.service';
import { SEARCH_MAX_QUERY, SEARCH_RESULT_CAP, SearchPeopleService } from '../services/search-people.service';
import { HttpError } from '../utils/httpError';

const querySchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(40).optional(),
  interests: z.string().max(200).optional(),
  /** `key:value` pairs, comma separated: `hosteller:true,club:Chess`. */
  attributes: z.string().max(200).optional(),
  sort: z.enum(EXPLORE_SORTS).optional(),
});

const peopleSchema = z.object({
  // Over-long input is cut, not refused: the app sends whatever is typed.
  q: z.string().optional().transform((value) => (value ?? '').slice(0, SEARCH_MAX_QUERY)),
  limit: z.coerce.number().int().min(1).max(SEARCH_RESULT_CAP).optional(),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `club:Chess` → `{ key: 'club', value: 'Chess' }`, dropping anything unrecognised. */
function parseAttributes(raw: string | undefined): ExploreAttribute[] {
  if (!raw) return [];
  return raw.split(',').flatMap((pair) => {
    const separator = pair.indexOf(':');
    const key = (separator === -1 ? pair : pair.slice(0, separator)).trim();
    const value = separator === -1 ? '' : pair.slice(separator + 1).trim().slice(0, 80);
    if (!EXPLORE_ATTRIBUTES.includes(key as ExploreAttributeKey)) return [];
    // hosteller and day_scholar carry no value; the others need one.
    if (key !== 'hosteller' && key !== 'day_scholar' && !value) return [];
    // campus and place are ids; anything else would fail the uuid cast.
    if ((key === 'campus' || key === 'place') && !UUID.test(value)) return [];
    return [{ key: key as ExploreAttributeKey, value }];
  });
}

export class SearchController {
  static async explore(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) throw new HttpError(400, 'Explore filters are invalid', 'INVALID_EXPLORE_FILTERS');
      const data = await ExploreService.page((req as any).user.sub, {
        cursor: parsed.data.cursor,
        limit: parsed.data.limit,
        interests: parsed.data.interests?.split(','),
        attributes: parseAttributes(parsed.data.attributes),
        sort: parsed.data.sort,
      });
      res.json({ success: true, data });
    } catch (error) { next(error); }
  }

  static async people(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = peopleSchema.safeParse(req.query);
      if (!parsed.success) throw new HttpError(400, 'Search query is invalid', 'INVALID_SEARCH_QUERY');
      // Never logged or stored: the query lives only for this request (8.3).
      const data = await SearchPeopleService.people((req as any).user.sub, parsed.data.q, parsed.data.limit);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, data });
    } catch (error) { next(error); }
  }

  /** One person's social layer again, for a live update while it is open. */
  static async person(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = String(req.params.userId ?? '');
      const person = UUID.test(userId) ? await SearchPeopleService.person((req as any).user.sub, userId) : null;
      if (!person) throw new HttpError(404, 'This profile is unavailable', 'PERSON_UNAVAILABLE');
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, data: person });
    } catch (error) { next(error); }
  }

  static async datingProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = String(req.params.userId ?? '');
      // A malformed id gets the same answer as every other refusal.
      if (!UUID.test(userId)) throw new HttpError(403, "You can't Like this profile right now.", 'DATING_PROFILE_UNAVAILABLE');
      const data = await SearchPeopleService.datingProfile((req as any).user.sub, userId);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, data });
    } catch (error) { next(error); }
  }
}
