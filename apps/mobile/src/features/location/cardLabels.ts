/**
 * The one line a card shows about where someone is from (LOCATION_SPEC.md
 * 6.6, 8.6). "Visiting" wins, because it is the thing most worth knowing;
 * then another institution and, if it is in another city, the city; then the
 * distance band. Never a place name finer than a campus, never a number.
 */
export function placeLine(card: {
  distanceLabel?: string | null;
  institutionLabel?: string | null;
  cityLabel?: string | null;
  visitingLabel?: string | null;
}): string | null {
  const parts: string[] = [];
  if (card.visitingLabel) parts.push(card.visitingLabel);
  else if (card.institutionLabel) {
    parts.push(card.cityLabel ? `${card.institutionLabel} · ${card.cityLabel}` : card.institutionLabel);
  }
  if (card.distanceLabel) parts.push(card.distanceLabel);
  return parts.length ? parts.join(" · ") : null;
}
