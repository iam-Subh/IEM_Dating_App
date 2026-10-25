export type LrclibRecord = {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
};

/** How far a candidate's duration may be from the song's before it is a different recording. */
export const LYRICS_DURATION_TOLERANCE_SECONDS = 3;

/** Synced lyrics beat plain lyrics, which beat an "instrumental" entry. */
export function lyricsTier(record: LrclibRecord): number {
  if (record.syncedLyrics) return 0;
  if (record.plainLyrics) return 1;
  return record.instrumental ? 2 : 3;
}

/** Loose artist comparison: "Pritam, Arijit Singh" matches "Arijit Singh". */
export function artistMatches(recordArtist: string | null | undefined, artists: string[]): boolean {
  const normalize = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
  const record = normalize(recordArtist ?? '');
  if (!record) return false;
  return artists.map(normalize).filter(Boolean).some((artist) => record.includes(artist) || artist.includes(record));
}

/**
 * The best lyric candidate for a song: within the duration tolerance, synced
 * lyrics first, then plain, then instrumental, then the closest duration. A
 * song credited to its composer can have an instrumental version under the
 * same title, which must never win over the sung one.
 */
export function pickLyricsCandidate(records: LrclibRecord[], durationSeconds: number): LrclibRecord | null {
  const usable = records
    .filter((record) => record && typeof record.duration === 'number')
    .filter((record) => !durationSeconds || Math.abs(record.duration - durationSeconds) <= LYRICS_DURATION_TOLERANCE_SECONDS)
    .filter((record) => lyricsTier(record) < 3);
  usable.sort((first, second) => (
    lyricsTier(first) - lyricsTier(second)
    || Math.abs(first.duration - durationSeconds) - Math.abs(second.duration - durationSeconds)
  ));
  return usable[0] ?? null;
}

/**
 * LRCLIB, the free and open synced lyrics database.
 *
 * `/api/get` is an exact match (track, artist, album, duration within about
 * two seconds); `/api/search` returns candidates to choose from.
 */
export class LrclibClient {
  private static get base() {
    return (process.env.LYRICS_API_BASE_URL || 'https://lrclib.net').replace(/\/$/, '');
  }

  private static async request(path: string, params: Record<string, string | number>) {
    const url = new URL(`${this.base}${path}`);
    for (const [key, value] of Object.entries(params)) if (value !== '') url.searchParams.set(key, String(value));
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': process.env.LYRICS_USER_AGENT || 'IEMConnect/1.0 (story music lyrics)' },
      signal: AbortSignal.timeout(Number(process.env.MUSIC_API_TIMEOUT_MS ?? 4000)),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`LRCLIB returned HTTP ${response.status}`);
    return response.json();
  }

  static async get(input: { track: string; artist: string; album: string | null; durationSeconds: number }): Promise<LrclibRecord | null> {
    return await this.request('/api/get', {
      track_name: input.track,
      artist_name: input.artist,
      album_name: input.album ?? '',
      duration: Math.round(input.durationSeconds),
    }) as LrclibRecord | null;
  }

  static async search(input: { track: string; artist?: string }): Promise<LrclibRecord[]> {
    const body = await this.request('/api/search', { track_name: input.track, artist_name: input.artist ?? '' });
    return Array.isArray(body) ? body as LrclibRecord[] : [];
  }
}
