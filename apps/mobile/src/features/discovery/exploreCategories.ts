/**
 * Browse's filters that arrive from elsewhere: a campus or spot from the map,
 * an interest from Search (EXPLORE_SPEC.md). Categories are gone - Browse is
 * being rebuilt.
 */

export type AttributeKey =
  | 'hosteller' | 'day_scholar' | 'club' | 'spot' | 'degree'
  // Opened from the map (LOCATION_SPEC.md 9): a campus id or a map place id.
  | 'campus' | 'place';

export type AttributeFilter = { key: AttributeKey; value: string; label: string };

/** Serialised for the API as `key:value` pairs, comma separated. */
export function encodeAttributes(attributes: AttributeFilter[]): string | undefined {
  if (!attributes.length) return undefined;
  return attributes.map((attribute) => `${attribute.key}:${attribute.value}`).join(',');
}

/** The server's reply states (EXPLORE_SPEC.md, sections 6 and 7.4). */
export type ExploreState = 'ok' | 'exhausted' | 'cohort_too_small' | 'setup_required';

