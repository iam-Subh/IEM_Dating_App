import { redisClient } from '../utils/redis';
import { HttpError } from '../utils/httpError';

export type Place = { placeId: string; name: string; subtitle: string };
export type Gif = { id: string; title: string; previewUrl: string; url: string; width: number; height: number };

/** OSM tags that are public places people tag a Story with. Homes and roads are left out. */
const PLACE_KEYS = new Set(['amenity', 'shop', 'tourism', 'leisure', 'historic', 'railway', 'aeroway', 'natural', 'office', 'sport', 'building', 'place', 'club', 'craft']);
const PRIVATE_VALUES = new Set(['house', 'residential', 'apartments', 'detached', 'semidetached_house', 'terrace', 'dormitory', 'bungalow', 'hamlet', 'isolated_dwelling', 'farm', 'plot', 'yes', 'garage', 'garages', 'shed', 'hut', 'cabin', 'houseboat', 'static_caravan']);

async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  try {
    const hit = await redisClient.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    // Redis unavailable.
  }
  const value = await load();
  redisClient.set(key, JSON.stringify(value), 'EX', ttlSeconds).catch(() => undefined);
  return value;
}

/**
 * Search behind the location and GIF stickers. Both go through the server so
 * API keys stay here, results are filtered in one place, and a provider can be
 * replaced without an app release.
 */
export class StorySearchService {
  /**
   * Named public places from Photon (OpenStreetMap), biased towards the
   * person's rough position when the app sends one. Never street addresses or
   * homes: a location sticker on a student's Story must not reveal where they live.
   */
  static async places(query: string, near?: { lat: number; lon: number }): Promise<Place[]> {
    const q = query.trim().replace(/\s+/g, ' ');
    if (q.length < 2) return [];
    const lat = near ? Math.round(near.lat * 10) / 10 : null;
    const lon = near ? Math.round(near.lon * 10) / 10 : null;
    return cached(`places:v1:${lat ?? '-'}:${lon ?? '-'}:${q.toLowerCase().slice(0, 80)}`, 24 * 60 * 60, async () => {
      const url = new URL(`${(process.env.PLACES_API_BASE_URL || 'https://photon.komoot.io').replace(/\/$/, '')}/api/`);
      url.searchParams.set('q', q);
      url.searchParams.set('limit', '20');
      url.searchParams.set('lang', 'en');
      if (lat !== null && lon !== null) {
        url.searchParams.set('lat', String(lat));
        url.searchParams.set('lon', String(lon));
      }
      let response: Response;
      try {
        response = await fetch(url, { headers: { 'User-Agent': 'IEMConnect/1.0 (story location sticker)' }, signal: AbortSignal.timeout(5000) });
      } catch {
        throw new HttpError(503, 'Location search is unavailable right now', 'PLACES_UNAVAILABLE');
      }
      if (!response.ok) throw new HttpError(503, 'Location search is unavailable right now', 'PLACES_UNAVAILABLE');
      const body = await response.json() as { features?: Array<{ properties?: Record<string, any> }> };
      const seen = new Set<string>();
      const places: Place[] = [];
      for (const feature of body.features ?? []) {
        const p = feature.properties ?? {};
        if (!p.name || !PLACE_KEYS.has(p.osm_key) || PRIVATE_VALUES.has(p.osm_value)) continue;
        if (p.osm_key === 'place' && !['city', 'town', 'village', 'suburb', 'neighbourhood', 'quarter', 'island', 'locality'].includes(p.osm_value)) continue;
        const placeId = `${p.osm_type ?? 'X'}${p.osm_id ?? ''}`;
        if (seen.has(placeId)) continue;
        seen.add(placeId);
        const subtitle = [p.district ?? p.locality, p.city, p.state, p.country].filter(Boolean).filter((part, index, list) => list.indexOf(part) === index).slice(0, 3).join(', ');
        places.push({ placeId: placeId.slice(0, 120), name: String(p.name).slice(0, 120), subtitle });
        if (places.length >= 15) break;
      }
      return places;
    });
  }

  /** GIPHY stickers (transparent GIFs, as Instagram's GIF tray shows), rated PG-13 or milder. */
  static async gifs(query: string, offset = 0): Promise<{ gifs: Gif[]; nextOffset: number | null }> {
    const key = process.env.GIPHY_API_KEY;
    if (!key) throw new HttpError(503, 'GIFs are unavailable right now', 'GIFS_UNAVAILABLE');
    const q = query.trim().slice(0, 50);
    const safeOffset = Math.min(Math.max(0, Math.floor(offset) || 0), 480);
    return cached(`gifs:v2:${safeOffset}:${q.toLowerCase()}`, 60 * 60, async () => {
      const endpoint = q ? 'search' : 'trending';
      const url = new URL(`https://api.giphy.com/v1/stickers/${endpoint}`);
      url.searchParams.set('api_key', key);
      if (q) url.searchParams.set('q', q);
      url.searchParams.set('limit', '24');
      url.searchParams.set('offset', String(safeOffset));
      url.searchParams.set('rating', 'pg-13');
      let response: Response;
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      } catch {
        throw new HttpError(503, 'GIFs are unavailable right now', 'GIFS_UNAVAILABLE');
      }
      if (!response.ok) throw new HttpError(503, 'GIFs are unavailable right now', 'GIFS_UNAVAILABLE');
      const body = await response.json() as { data?: any[]; pagination?: { total_count?: number; count?: number; offset?: number } };
      const gifs = (body.data ?? []).flatMap((item): Gif[] => {
        const full = item?.images?.fixed_width ?? item?.images?.original;
        const preview = item?.images?.fixed_width_small ?? full;
        // GIF rather than WebP: the app animates GIFs, but not animated WebP.
        const url = full?.url || full?.webp;
        if (!item?.id || !url) return [];
        return [{ id: String(item.id), title: String(item.title ?? ''), previewUrl: preview?.url || preview?.webp || url, url, width: Number(full.width) || 200, height: Number(full.height) || 200 }];
      });
      const total = body.pagination?.total_count ?? 0;
      const next = safeOffset + (body.pagination?.count ?? gifs.length);
      return { gifs, nextOffset: next < total && gifs.length ? next : null };
    });
  }
}
