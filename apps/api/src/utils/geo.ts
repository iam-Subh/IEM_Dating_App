/**
 * Geo helpers for distance-based discovery.
 *
 * Design notes:
 * - Coordinates are snapped to a ~1km grid BEFORE storage. Exact coordinates
 *   are never persisted and never leave the server. Returning precise
 *   distances lets an attacker trilaterate a user's home address by sampling
 *   from three positions, which has caused real stalking incidents on other
 *   dating apps.
 * - Distances shown to users are bucketed, never exact.
 * - Retrieval uses a cheap bounding box in SQL (indexed) and then refines
 *   with haversine in memory. This needs no Postgres extensions, so it works
 *   on any managed instance. PostGIS is the upgrade path once a single
 *   bounding box stops being selective enough.
 */

const EARTH_RADIUS_KM = 6371;
/** ~1.1km at the equator; the grid users are snapped to. */
const GRID_DEGREES = 0.01;

export type Coords = { latitude: number; longitude: number };

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Snap a raw GPS fix to the privacy grid. Always apply before storing. */
export function snapToGrid(coords: Coords): Coords {
  return {
    latitude: Math.round(coords.latitude / GRID_DEGREES) * GRID_DEGREES,
    longitude: Math.round(coords.longitude / GRID_DEGREES) * GRID_DEGREES,
  };
}

export function isValidCoords(coords: Partial<Coords>): coords is Coords {
  const { latitude: lat, longitude: lng } = coords;
  return (
    typeof lat === 'number' && typeof lng === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
    // 0,0 is in the Atlantic - almost always an uninitialised value.
    !(lat === 0 && lng === 0)
  );
}

/** Great-circle distance in km. */
export function haversineKm(a: Coords, b: Coords): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}

/**
 * Bounding box for a radius search. Used as an indexed SQL prefilter before
 * the exact haversine pass, so the database never scans the whole table.
 */
export function boundingBox(center: Coords, radiusKm: number) {
  const latDelta = radiusKm / EARTH_RADIUS_KM * 180 / Math.PI;

  // Longitude degrees shrink towards the poles. Guard against the cosine
  // collapsing to ~0 near them, which would produce an unusable box.
  const cosLat = Math.cos(toRad(center.latitude));
  const lngDelta = Math.abs(center.latitude) + latDelta >= 90
    ? 180
    : Math.asin(Math.min(1, Math.sin(radiusKm / EARTH_RADIUS_KM) / Math.abs(cosLat))) * 180 / Math.PI;
  // Use the full longitude range when the box crosses the antimeridian.
  const wraps = center.longitude - lngDelta < -180 || center.longitude + lngDelta > 180;

  return {
    minLat: Math.max(-90, center.latitude - latDelta),
    maxLat: Math.min(90, center.latitude + latDelta),
    minLng: wraps ? -180 : Math.max(-180, center.longitude - lngDelta),
    maxLng: wraps ? 180 : Math.min(180, center.longitude + lngDelta),
  };
}

/**
 * Bucketed distance for display. Never return the raw number to a client.
 */
export function distanceLabel(km: number): string {
  if (km < 1) return 'Less than 1 km away';
  if (km < 5) return '1-5 km away';
  if (km < 10) return '5-10 km away';
  if (km < 25) return '10-25 km away';
  if (km < 50) return '25-50 km away';
  if (km < 100) return '50-100 km away';
  return 'Over 100 km away';
}
