/**
 * Which web pages may call the API: CORS_ORIGIN, one address or several
 * separated by commas - the app's web build (:8081) and the admin panel
 * (:5174) in development. Unset: any.
 */
export function corsOrigin(): string | string[] {
  const list = (process.env.CORS_ORIGIN ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
  if (!list.length) return '*';
  return list.length === 1 ? list[0] : list;
}
