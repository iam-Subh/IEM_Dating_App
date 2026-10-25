// Profile reads return photo records. Profile updates accept URL strings.
export function profilePhotoUrls(photos: unknown): string[] {
  if (!Array.isArray(photos)) return [];
  return photos.map(photo => typeof photo === 'string' ? photo : photo?.photoUrl)
    .filter((url): url is string => typeof url === 'string' && url.length > 0).slice(0, 6);
}
export function validProfileVideoDuration(milliseconds: number | null | undefined) {
  return typeof milliseconds === 'number' && Number.isFinite(milliseconds) && milliseconds >= 15_000 && milliseconds <= 60_000;
}
// Keep the same order for photos and their original crop sources.
export function makeMainPhoto<T>(items: T[], index: number): T[] {
  if (!Number.isInteger(index) || index <= 0 || index >= items.length) return items;
  return [items[index], ...items.slice(0, index), ...items.slice(index + 1)];
}
export function birthdayFromParts(day: string, month: string, year: string, now = new Date()) {
  if (!/^\d{1,2}$/.test(day) || !/^\d{1,2}$/.test(month) || !/^\d{4}$/.test(year)) return null;
  const d = Number(day), m = Number(month), y = Number(year);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (y < 1920 || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || date > now) return null;
  const age = now.getFullYear() - y - (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d) ? 1 : 0);
  return { birthday: date.toISOString(), age };
}
