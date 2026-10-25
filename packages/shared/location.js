/**
 * Location constants shared by the app and the server (LOCATION_SPEC.md).
 *
 * They live in one place because the phone rounds a precise fix to the grid
 * *before* sending it (section 6.2), and the server rounds again on arrival.
 * If the two ever disagreed on the grid, a precise fix could land in a
 * different cell on each side and the "did I move?" check would misfire.
 */

/** ~2.2 km x 2.1 km at Kolkata's latitude; matches approximate location (section 6.4). */
const GRID_DEGREES = 0.02;

/** The only radii offered (section 6.5). Fewer radii, fewer answers for the radius oracle. */
const RADIUS_PRESETS_KM = [5, 10, 15, 25, 50, 100];

/** How far "show people further away" reaches once the radius runs out. */
const EXPANDED_RADIUS_KM = 100;

/** A location older than this leaves other people's decks (section 6.8). */
const LOCATION_STALE_DAYS = 14;

/** A location older than this is erased (section 6.8). */
const LOCATION_ERASE_DAYS = 30;

/** The app refreshes a location older than this when it comes to the foreground (section 6.7). */
const LOCATION_REFRESH_HOURS = 6;

/** Saved places, at most (section 7). */
const MAX_SAVED_PLACES = 3;

/** Map spots, at most (section 9.2). */
const MAX_MAP_PLACES = 3;

function snapCoordinate(value) {
  // toFixed then Number drops floating-point noise such as 22.580000000000002,
  // so the same cell always serialises the same way on both sides.
  return Number((Math.round(value / GRID_DEGREES) * GRID_DEGREES).toFixed(6));
}

/** Snap a fix to the grid. Always apply before storing or sending. */
function snapToGrid(coords) {
  return { latitude: snapCoordinate(coords.latitude), longitude: snapCoordinate(coords.longitude) };
}

function sameCell(a, b) {
  return Math.abs(a.latitude - b.latitude) < 1e-6 && Math.abs(a.longitude - b.longitude) < 1e-6;
}

/** The smallest preset at or above `km`, so converting never shrinks someone's audience. */
function toRadiusPreset(km) {
  const value = Number(km);
  if (!Number.isFinite(value)) return 100;
  return RADIUS_PRESETS_KM.find((preset) => value <= preset) ?? 100;
}

module.exports = {
  GRID_DEGREES,
  RADIUS_PRESETS_KM,
  EXPANDED_RADIUS_KM,
  LOCATION_STALE_DAYS,
  LOCATION_ERASE_DAYS,
  LOCATION_REFRESH_HOURS,
  MAX_SAVED_PLACES,
  MAX_MAP_PLACES,
  snapToGrid,
  sameCell,
  toRadiusPreset,
};
