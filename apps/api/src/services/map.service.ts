import { Prisma, User } from '@prisma/client';
import { MAX_MAP_PLACES } from '@iem-dating/shared/location';
import { prisma } from '../utils/prisma';
import { redisClient } from '../utils/redis';
import { HttpError } from '../utils/httpError';
import { haversineKm } from '../utils/geo';
import { asViewer, effectiveRadiusKm, eligibleSql, setupComplete } from './eligibility.service';
import { cacheGet, cacheSet } from './discovery-cards.service';

/**
 * The map (LOCATION_SPEC.md section 9), modelled on happn's but keeping only
 * the parts that are safe in a single-college app.
 *
 * The rule running through every layer: **"who" is only ever shown through
 * things people chose to put on their profile, never through where their
 * phone is.**
 *
 * - Campuses: how many eligible people have each campus as their *home*
 *   campus - a profile fact, available without any location.
 * - Spots: public places people opted to pin to their map profile (happn's
 *   CrushPoints, not its crossings).
 * - Areas: distance mode only - how many eligible people are in each ~6 km
 *   tile around you, as bands, hourly, never who. Tiles below the floor are
 *   blank, and a tile with no qualifying neighbour is suppressed too, because
 *   Strava's heatmap showed that sparse aggregates still point at people.
 *
 * Everyone who switched on "hide me from maps" is left out of every count.
 */

/** Below this, a count is shown only as "a few" and never opens a list. Same as Explore's floor. */
export const MAP_MIN_COUNT = 10;
/** Areas are tiles of 3 x 3 grid cells (0.06 degrees, ~6 km). */
export const MAP_TILE_DEGREES = 0.06;
/** The map is a snapshot, not a live view. */
const MAP_CACHE_SECONDS = 60 * 60;
/** A place served by search can be pinned for this long. */
const SERVED_PLACE_SECONDS = 24 * 60 * 60;

export type MapBand = 'none' | 'few' | '10+' | '25+' | '50+' | '100+';

export function mapBand(count: number): MapBand {
  if (count <= 0) return 'none';
  if (count < MAP_MIN_COUNT) return 'few';
  if (count < 25) return '10+';
  if (count < 50) return '25+';
  if (count < 100) return '50+';
  return '100+';
}

/**
 * Which tiles may be shown: at or above the floor, and with at least one of
 * the eight neighbouring tiles also at or above it. A lone busy tile in an
 * otherwise empty area is exactly the Strava failure: it points at the one
 * place those few people are.
 */
export function visibleTiles(tiles: Map<string, number>) {
  const key = (i: number, j: number) => `${i}:${j}`;
  const shown: { i: number; j: number; count: number }[] = [];
  for (const [id, count] of tiles) {
    if (count < MAP_MIN_COUNT) continue;
    const [i, j] = id.split(':').map(Number);
    let neighbour = false;
    for (let di = -1; di <= 1 && !neighbour; di += 1) {
      for (let dj = -1; dj <= 1; dj += 1) {
        if ((di || dj) && (tiles.get(key(i + di, j + dj)) ?? 0) >= MAP_MIN_COUNT) {
          neighbour = true;
          break;
        }
      }
    }
    if (neighbour) shown.push({ i, j, count });
  }
  return shown;
}

/** Public-place kinds a person can pin. No neighbourhoods, generic buildings, offices or stations. */
const SPOT_KEYS = new Set(['amenity', 'shop', 'tourism', 'leisure', 'historic', 'sport', 'club']);
const PRIVATE_VALUES = new Set([
  'house', 'residential', 'apartments', 'detached', 'semidetached_house', 'terrace', 'dormitory',
  'bungalow', 'hamlet', 'isolated_dwelling', 'farm', 'plot', 'yes', 'garage', 'garages', 'shed',
  'hut', 'cabin', 'houseboat', 'static_caravan', 'shelter', 'parking', 'parking_space', 'toilets',
]);

type ServedPlace = {
  externalId: string;
  name: string;
  subtitle: string;
  category: string | null;
  latitude: number;
  longitude: number;
};

/** "fast_food" -> "Fast food": OpenStreetMap's kind of place, readable. */
function categoryLabel(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.replace(/_/g, ' ').trim();
  return (text.charAt(0).toUpperCase() + text.slice(1)).slice(0, 40);
}

/**
 * Bumped whenever someone becomes *less* visible on the map - "hide me from
 * maps" switched on, or a spot unpinned - so every cached map snapshot is
 * rebuilt rather than showing them for up to an hour. Additions wait for the
 * hourly snapshot as before, so the map still cannot be diffed minute by
 * minute to watch someone arrive.
 */
const MAP_EPOCH_KEY = 'map:epoch';

export async function bumpMapEpoch() {
  await redisClient.incr(MAP_EPOCH_KEY).catch(() => undefined);
}

export class MapService {
  /**
   * Search for a public place to pin (9.2). Every result is remembered for a
   * day, and only a remembered result can be pinned: the app cannot invent a
   * "place" with coordinates of its choosing, such as someone's hostel.
   */
  static async searchPlaces(query: string, near?: { latitude: number; longitude: number }) {
    const q = query.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (q.length < 2) return [];
    const url = new URL(`${(process.env.PLACES_API_BASE_URL || 'https://photon.komoot.io').replace(/\/$/, '')}/api/`);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '20');
    url.searchParams.set('lang', 'en');
    if (near) {
      // Bias only; rounded to ~11 km so the provider never sees a precise point.
      url.searchParams.set('lat', String(Math.round(near.latitude * 10) / 10));
      url.searchParams.set('lon', String(Math.round(near.longitude * 10) / 10));
    }
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': 'IEMConnect/1.0 (map spots)' },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new HttpError(503, 'Place search is unavailable right now', 'PLACES_UNAVAILABLE');
    }
    if (!response.ok) throw new HttpError(503, 'Place search is unavailable right now', 'PLACES_UNAVAILABLE');
    const body = await response.json() as {
      features?: Array<{ properties?: Record<string, any>; geometry?: { coordinates?: [number, number] } }>;
    };
    const results: ServedPlace[] = [];
    const seen = new Set<string>();
    for (const feature of body.features ?? []) {
      const p = feature.properties ?? {};
      const [longitude, latitude] = feature.geometry?.coordinates ?? [];
      if (!p.name || !SPOT_KEYS.has(p.osm_key) || PRIVATE_VALUES.has(p.osm_value)) continue;
      if (typeof latitude !== 'number' || typeof longitude !== 'number') continue;
      const externalId = `osm:${p.osm_type ?? 'X'}${p.osm_id ?? ''}`.slice(0, 160);
      if (seen.has(externalId)) continue;
      seen.add(externalId);
      const subtitle = [p.street, p.district ?? p.locality, p.city]
        .filter(Boolean)
        .filter((part: string, index: number, list: string[]) => list.indexOf(part) === index)
        .slice(0, 3)
        .join(', ');
      results.push({
        externalId,
        name: String(p.name).slice(0, 120),
        subtitle: subtitle.slice(0, 200),
        category: categoryLabel(p.osm_value),
        latitude: Number(latitude.toFixed(6)),
        longitude: Number(longitude.toFixed(6)),
      });
      if (results.length >= 15) break;
    }
    await Promise.all(results.map((place) =>
      redisClient
        .set(`mapplace:served:${place.externalId}`, JSON.stringify(place), 'EX', SERVED_PLACE_SECONDS)
        .catch(() => undefined)));
    return results.map(({ externalId, name, subtitle, category }) => ({ externalId, name, subtitle, category }));
  }

  static async myPlaces(userId: string) {
    const rows = await prisma.userMapPlace.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    const places = await prisma.mapPlace.findMany({ where: { id: { in: rows.map((row) => row.placeId) } } });
    return rows.flatMap((row) => {
      const place = places.find((entry) => entry.id === row.placeId);
      return place ? [{ id: place.id, name: place.name, subtitle: place.subtitle, category: place.category }] : [];
    });
  }

  static async addMyPlace(userId: string, externalId: string) {
    const served = await cacheGet(`mapplace:served:${externalId}`);
    if (!served) {
      throw new HttpError(409, 'Search for the place again, then add it.', 'PLACE_SEARCH_EXPIRED');
    }
    const place = JSON.parse(served) as ServedPlace;
    const stored = await prisma.mapPlace.upsert({
      where: { externalId: place.externalId },
      create: {
        source: 'osm',
        externalId: place.externalId,
        name: place.name,
        subtitle: place.subtitle || null,
        category: place.category ?? null,
        latitude: place.latitude,
        longitude: place.longitude,
      },
      update: { name: place.name, subtitle: place.subtitle || null, category: place.category ?? null },
    });
    // Count and pin under one per-person lock, so two taps at once cannot
    // both pass the count and make a fourth spot.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`map-places:${userId}`}, 0))`;
      const already = await tx.userMapPlace.findUnique({ where: { userId_placeId: { userId, placeId: stored.id } } });
      if (already) return;
      const count = await tx.userMapPlace.count({ where: { userId } });
      if (count >= MAX_MAP_PLACES) {
        throw new HttpError(409, `You can pin up to ${MAX_MAP_PLACES} spots. Remove one first.`, 'MAP_PLACE_LIMIT');
      }
      await tx.userMapPlace.create({ data: { userId, placeId: stored.id } });
    });
    return this.myPlaces(userId);
  }

  static async removeMyPlace(userId: string, placeId: string) {
    const removed = await prisma.userMapPlace.deleteMany({ where: { userId, placeId } });
    // Leaving a spot shows on every map now, not after the hourly snapshot.
    if (removed.count) await bumpMapEpoch();
    return this.myPlaces(userId);
  }

  /** The map for one viewer: an hourly snapshot of the layers, plus their own position live. */
  static async map(userId: string) {
    // Browsing as a viewer: while hidden at a place, from the phone's private position.
    const me = asViewer(await prisma.user.findUniqueOrThrow({ where: { id: userId } }));
    const own = await this.ownPosition(me);
    if (!setupComplete(me)) {
      // Hidden at a place on purpose (their shown location is cleared while
      // they are there) reads differently from unfinished setup.
      const hiddenHere = me.discoveryMode === 'distance' && !!me.locationHiddenAt;
      return { mode: me.discoveryMode, me: own, campuses: [], spots: [], areas: [], state: 'setup_required' as const, hiddenHere };
    }
    const hour = Math.floor(Date.now() / 3_600_000);
    const epoch = (await cacheGet(MAP_EPOCH_KEY)) ?? '0';
    const key = `map:v2:${userId}:${me.eligibilityVersion}:${epoch}:${hour}`;
    const cached = await cacheGet(key);
    let layers: Awaited<ReturnType<typeof MapService.layers>> | null = null;
    if (cached) {
      try { layers = JSON.parse(cached); } catch { layers = null; }
    }
    if (!layers) {
      layers = await this.layers(me);
      cacheSet(key, JSON.stringify(layers), MAP_CACHE_SECONDS);
    }
    return { mode: me.discoveryMode, me: own, ...layers, state: 'ok' as const };
  }

  /** Where the viewer sees themselves: their own cell, or their campus. Only ever shown to them. */
  private static async ownPosition(me: User) {
    if (me.discoveryMode === 'distance' && me.latitude !== null && me.longitude !== null) {
      return { latitude: Number(me.latitude), longitude: Number(me.longitude), kind: 'cell' as const };
    }
    if (me.campusId) {
      const campus = await prisma.institutionCampus.findUnique({ where: { id: me.campusId } });
      if (campus?.latitude != null && campus.longitude != null) {
        return { latitude: Number(campus.latitude), longitude: Number(campus.longitude), kind: 'campus' as const };
      }
    }
    return null;
  }

  private static async layers(me: User) {
    // Everyone eligible for this viewer, swiped or not: the map is about who
    // is around, not about who is left in the deck. Hidden people are out.
    // Only verified students are counted: the glow reflects them (GOOGLE_SIGNUP_PLAN.md 2.7).
    const base = Prisma.sql`${eligibleSql(me, new Date(), false)} AND NOT u.hide_from_maps
      AND EXISTS (SELECT 1 FROM student_memberships counted_membership
        WHERE counted_membership.user_id = u.id AND counted_membership.status = 'verified'
          AND counted_membership.verified_at IS NOT NULL
          AND (counted_membership.expires_at IS NULL OR counted_membership.expires_at > now()))`;

    const campusRows = await prisma.$queryRaw<{ campus_id: string; count: number }[]>(Prisma.sql`
      SELECT u.campus_id, count(*)::int AS count FROM users u
      WHERE ${base} AND u.campus_id IS NOT NULL
      GROUP BY u.campus_id`);
    const counted = new Map(campusRows.map((row) => [row.campus_id, row.count]));
    // The campuses shown are those of the institutions the viewer can reach,
    // plus their own, so an empty campus still reads "none" rather than vanishing.
    const membership = await prisma.studentMembership.findUnique({ where: { userId: me.id }, select: { institutionId: true } });
    const campusIds = [...counted.keys(), ...(me.campusId ? [me.campusId] : [])];
    const campuses = await prisma.institutionCampus.findMany({
      where: {
        isActive: true,
        latitude: { not: null },
        longitude: { not: null },
        OR: [{ id: { in: campusIds } }, ...(membership ? [{ institutionId: membership.institutionId }] : [])],
      },
      include: { institution: { select: { code: true } } },
      orderBy: [{ institutionId: 'asc' }, { sortOrder: 'asc' }],
    });
    const campusLayer = campuses.map((campus) => {
      const count = counted.get(campus.id) ?? 0;
      return {
        id: campus.id,
        name: campus.name,
        institution: campus.institution.code,
        latitude: Number(campus.latitude),
        longitude: Number(campus.longitude),
        band: mapBand(count),
        // A list opens only at the floor, the same as Explore's.
        canList: count >= MAP_MIN_COUNT,
      };
    });

    const spotRows = await prisma.$queryRaw<{ place_id: string; count: number }[]>(Prisma.sql`
      SELECT ump.place_id, count(*)::int AS count
      FROM user_map_places ump JOIN users u ON u.id = ump.user_id
      WHERE ${base}
      GROUP BY ump.place_id
      ORDER BY count DESC
      LIMIT 200`);
    const places = await prisma.mapPlace.findMany({ where: { id: { in: spotRows.map((row) => row.place_id) } } });
    const spotLayer = spotRows.flatMap((row) => {
      const place = places.find((entry) => entry.id === row.place_id);
      return place
        ? [{
          id: place.id,
          name: place.name,
          subtitle: place.subtitle,
          category: place.category,
          latitude: Number(place.latitude),
          longitude: Number(place.longitude),
          band: mapBand(row.count),
          canList: row.count >= MAP_MIN_COUNT,
        }]
        : [];
    });

    let areaLayer: { latitude: number; longitude: number; size: number; band: MapBand }[] = [];
    if (me.discoveryMode === 'distance' && me.latitude !== null && me.longitude !== null) {
      const tileRows = await prisma.$queryRaw<{ i: number; j: number; count: number }[]>(Prisma.sql`
        SELECT floor(u.latitude / ${MAP_TILE_DEGREES})::int AS i,
               floor(u.longitude / ${MAP_TILE_DEGREES})::int AS j,
               count(*)::int AS count
        FROM users u
        WHERE ${base} AND u.discovery_mode = 'distance' AND u.latitude IS NOT NULL AND u.longitude IS NOT NULL
        GROUP BY 1, 2`);
      const tiles = new Map(tileRows.map((row) => [`${row.i}:${row.j}`, row.count]));
      const mine = { latitude: Number(me.latitude), longitude: Number(me.longitude) };
      areaLayer = visibleTiles(tiles)
        .map(({ i, j, count }) => ({
          latitude: Number(((i + 0.5) * MAP_TILE_DEGREES).toFixed(6)),
          longitude: Number(((j + 0.5) * MAP_TILE_DEGREES).toFixed(6)),
          size: MAP_TILE_DEGREES,
          band: mapBand(count),
        }))
        // Only tiles within reach; the rest of the city is not this viewer's business.
        .filter((tile) => haversineKm(mine, tile) <= effectiveRadiusKm(me) + 5);
    }

    return { campuses: campusLayer, spots: spotLayer, areas: areaLayer };
  }
}
