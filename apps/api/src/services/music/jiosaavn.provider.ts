import { HttpError } from '../../utils/httpError';

export type MusicTrack = {
  provider: 'jiosaavn';
  id: string;
  title: string;
  artists: string;
  album: string | null;
  durationMs: number;
  language: string | null;
  explicit: boolean;
  artwork: { small: string | null; medium: string | null; large: string | null };
  /** 96 kbps for previews and playback over photos; 160 kbps for mixing into video. */
  streams: { preview: string | null; standard: string | null };
  sourceUrl: string | null;
};

type Quality = { quality?: string; url?: string };

const ENTITIES: Record<string, string> = { '&quot;': '"', '&amp;': '&', '&#039;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>' };

export function decodeEntities(value: unknown): string {
  return String(value ?? '').replace(/&(quot|amp|#039|apos|lt|gt);/g, (entity) => ENTITIES[entity] ?? entity).trim();
}

function pick(list: Quality[] | undefined, wanted: string[]): string | null {
  if (!Array.isArray(list)) return null;
  for (const quality of wanted) {
    const found = list.find((item) => item?.quality === quality && typeof item.url === 'string');
    if (found?.url) return found.url;
  }
  return null;
}

/** Maps one song from the JioSaavn API into the app's shape. Returns null for anything that is not a playable song. */
export function normalizeSaavnSong(raw: any): MusicTrack | null {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.name) return null;
  const preview = pick(raw.downloadUrl, ['96kbps', '160kbps', '48kbps', '320kbps']);
  const standard = pick(raw.downloadUrl, ['160kbps', '320kbps', '96kbps']);
  if (!preview && !standard) return null;
  const primary: string[] = Array.isArray(raw.artists?.primary)
    ? raw.artists.primary.map((artist: any) => decodeEntities(artist?.name)).filter(Boolean)
    : [];
  const artists = primary.length ? [...new Set(primary)].join(', ') : decodeEntities(raw.primaryArtists);
  const durationSeconds = Number(raw.duration);
  return {
    provider: 'jiosaavn',
    id: raw.id,
    title: decodeEntities(raw.name),
    artists,
    album: raw.album?.name ? decodeEntities(raw.album.name) : null,
    durationMs: Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds * 1000) : 0,
    language: typeof raw.language === 'string' ? raw.language : null,
    explicit: raw.explicitContent === true || raw.explicitContent === 1 || raw.explicitContent === '1',
    artwork: {
      small: pick(raw.image, ['150x150', '50x50', '500x500']),
      medium: pick(raw.image, ['500x500', '150x150']),
      large: pick(raw.image, ['500x500']),
    },
    streams: { preview: preview ?? standard, standard: standard ?? preview },
    sourceUrl: typeof raw.url === 'string' ? raw.url : null,
  };
}

/**
 * JioSaavn songs through the unofficial API deployment in MUSIC_API_BASE_URL.
 *
 * Its `/songs/{id}/suggestions` route fails and it has no lyrics route, so
 * neither is used. Search pages are 1-based: page 0 returns shifted results.
 */
export class JioSaavnProvider {
  static readonly TRENDING_PLAYLIST_ID = '47599074';

  private static get base() {
    return (process.env.MUSIC_API_BASE_URL || 'https://my-saavan-api.vercel.app').replace(/\/$/, '');
  }

  private static async get(path: string, params: Record<string, string | number>) {
    const url = new URL(`${this.base}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    let response: Response;
    try {
      response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(Number(process.env.MUSIC_API_TIMEOUT_MS ?? 4000)) });
    } catch {
      throw new HttpError(503, 'Music is unavailable right now', 'MUSIC_UNAVAILABLE');
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new HttpError(503, 'Music is unavailable right now', 'MUSIC_UNAVAILABLE');
    const body = await response.json().catch(() => null) as { success?: boolean; data?: unknown } | null;
    if (!body?.success) throw new HttpError(503, 'Music is unavailable right now', 'MUSIC_UNAVAILABLE');
    return body.data as any;
  }

  static async search(query: string, page: number, limit: number) {
    const data = await this.get('/api/search/songs', { query, page: Math.max(1, page), limit });
    const results = Array.isArray(data?.results) ? data.results : [];
    return { total: Number(data?.total ?? 0), tracks: results.map(normalizeSaavnSong).filter(Boolean) as MusicTrack[] };
  }

  static async song(id: string) {
    const data = await this.get(`/api/songs/${encodeURIComponent(id)}`, {});
    const raw = Array.isArray(data) ? data[0] : data;
    return normalizeSaavnSong(raw);
  }

  static async trending(limit: number) {
    const data = await this.get('/api/playlists', { id: this.TRENDING_PLAYLIST_ID, limit });
    const songs = Array.isArray(data?.songs) ? data.songs : [];
    return songs.map(normalizeSaavnSong).filter(Boolean) as MusicTrack[];
  }
}
