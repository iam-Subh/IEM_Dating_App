export function compatibilityValue(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
    ? value
    : null;
}
export function compatibilityColor(value: number | null) {
  if (value === null) return "#9ca3af";
  return value >= 60 ? "#4ade80" : value >= 40 ? "#facc15" : "#f87171";
}
export function compatibilityLabel(value: unknown) {
  const score = compatibilityValue(value);
  return score === null
    ? "Compatibility unavailable"
    : `Compatibility ${score}/100`;
}
