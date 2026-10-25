/**
 * The admin panel's line to the API (apps/api, /api/v1). Signs in like the
 * app does; the access token lasts 15 minutes and is renewed with the
 * refresh token, once, when a request comes back 401.
 */
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000/api/v1';
const KEY = 'iem-admin-session';

type Session = { accessToken: string; refreshToken: string };
let session: Session | null = (() => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
})();
let renewing: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function save(next: Session | null) {
  session = next;
  try { next ? localStorage.setItem(KEY, JSON.stringify(next)) : localStorage.removeItem(KEY); } catch { /* private window */ }
  listeners.forEach((listener) => listener());
}

export const hasSession = () => !!session;
export function onSessionChange(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

const DEVICE = { platform: 'web', deviceName: 'Admin panel', model: navigator.userAgent.slice(0, 80) };

async function renew() {
  renewing ??= (async () => {
    if (!session) return false;
    try {
      const response = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken, deviceInfo: DEVICE }),
      });
      if (!response.ok) { save(null); return false; }
      const data = (await response.json()).data;
      save({ accessToken: data.accessToken, refreshToken: data.refreshToken });
      return true;
    } catch { return false; }
  })().finally(() => { renewing = null; });
  return renewing;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}, retry = true): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (response.status === 401 && retry && session && (await renew())) return api<T>(path, init, false);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(json.message ?? json.error ?? `Request failed (${response.status})`, response.status, json.code);
  return json.data as T;
}

export async function signIn(email: string, password: string) {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, deviceInfo: DEVICE }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(json.message ?? 'Could not sign in', response.status, json.code);
  save({ accessToken: json.data.accessToken, refreshToken: json.data.refreshToken });
}

export async function signOut() {
  await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
  save(null);
}
