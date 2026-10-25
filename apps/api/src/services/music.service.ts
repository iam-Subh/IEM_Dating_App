import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { redisClient } from '../utils/redis';
import { HttpError } from '../utils/httpError';
import { logger } from '../utils/logger';
import { cleanTitle, parseLrc, type LyricLine } from '../utils/lrc';
import type { StoryMusic } from '../schemas/story-composition.schema';
import { JioSaavnProvider, type MusicTrack } from './music/jiosaavn.provider';
import { LrclibClient, artistMatches, lyricsTier, pickLyricsCandidate, type LrclibRecord } from './music/lrclib.client';

const PAGE_SIZE = 20;
const NOT_FOUND_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

export type LyricsResult = {
  status: 'found' | 'plain_only' | 'instrumental';
  lines: LyricLine[];
  plainText: string | null;
};

async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  try {
    const hit = await redisClient.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    // Redis unavailable: go to the source.
  }
  const value = await load();
  redisClient.set(key, JSON.stringify(value), 'EX', ttlSeconds).catch(() => undefined);
  return value;
}

/**
 * Songs for the music sticker and their timed lyrics.
 *
 * The app never calls either upstream directly: this is the one place the
 * source can be swapped or switched off, results are cached so a campus
 * searching the same song makes one upstream call, and explicit songs are
 * filtered here.
 */
export class MusicService {
  static assertEnabled() {
    if (process.env.MUSIC_ENABLED === 'false') throw new HttpError(503, 'Music is unavailable right now', 'MUSIC_UNAVAILABLE');
  }

  private static visible(tracks: MusicTrack[], allowExplicit: boolean) {
    const seen = new Set<string>();
    return tracks.filter((track) => {
      if (seen.has(track.id) || (!allowExplicit && track.explicit)) return false;
      seen.add(track.id);
      return true;
    });
  }

  static async trending(allowExplicit = false) {
    this.assertEnabled();
    const tracks = await cached('music:trending:v1', 30 * 60, () => JioSaavnProvider.trending(50));
    return { tracks: this.visible(tracks, allowExplicit) };
  }

  static async search(query: string, page: number, allowExplicit = false) {
    this.assertEnabled();
    const normalized = query.trim().replace(/\s+/g, ' ').toLowerCase();
    if (normalized.length < 1) return { tracks: [], page: 1, hasMore: false };
    const safePage = Math.min(Math.max(1, Math.floor(page) || 1), 50);
    const result = await cached(`music:search:v1:${safePage}:${normalized.slice(0, 100)}`, 5 * 60, () => JioSaavnProvider.search(normalized, safePage, PAGE_SIZE));
    return {
      tracks: this.visible(result.tracks, allowExplicit),
      page: safePage,
      hasMore: safePage * PAGE_SIZE < result.total,
    };
  }

  static async track(trackId: string): Promise<MusicTrack> {
    this.assertEnabled();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(trackId)) throw new HttpError(404, 'Song is unavailable', 'MUSIC_TRACK_UNAVAILABLE');
    const track = await cached(`music:track:v1:${trackId}`, 24 * 60 * 60, async () => {
      const found = await JioSaavnProvider.song(trackId);
      if (!found) throw new HttpError(404, 'Song is unavailable', 'MUSIC_TRACK_UNAVAILABLE');
      return found;
    });
    void this.saveSnapshot(track).catch(() => undefined);
    return track;
  }

  private static saveSnapshot(track: MusicTrack) {
    const data = {
      title: track.title.slice(0, 300),
      artists: track.artists.slice(0, 500),
      album: track.album?.slice(0, 300) ?? null,
      durationMs: track.durationMs,
      language: track.language?.slice(0, 40) ?? null,
      explicit: track.explicit,
      artworkUrl: track.artwork.large ?? track.artwork.medium,
      sourceUrl: track.sourceUrl,
      fetchedAt: new Date(),
    };
    return prisma.musicTrack.upsert({
      where: { provider_providerTrackId: { provider: track.provider, providerTrackId: track.id } },
      create: { provider: track.provider, providerTrackId: track.id, ...data },
      update: data,
    });
  }

  /** Records a song used in a published Story, so the Story never depends on the music API for its title. */
  static async recordUse(music: StoryMusic) {
    const existing = await prisma.musicTrack.findUnique({ where: { provider_providerTrackId: { provider: music.provider, providerTrackId: music.trackId } } });
    if (existing) return;
    try {
      await this.track(music.trackId);
    } catch {
      await prisma.musicTrack.create({
        data: {
          provider: music.provider, providerTrackId: music.trackId, title: music.title, artists: music.artists,
          durationMs: 0, artworkUrl: music.artworkUrl ?? null,
        },
      }).catch(() => undefined);
    }
  }

  /**
   * Timed lyrics from LRCLIB, matched once per song and stored.
   *
   * 1. Exact match on track, first artist, album and duration.
   * 2. Search by track and artist; keep candidates within 3 s, prefer synced.
   * 3. The same search with the title cleaned of "(From …)", "- Remix", "feat.".
   * A miss is stored and asked again after 7 days, as LRCLIB grows.
   */
  static async lyrics(trackId: string): Promise<LyricsResult> {
    this.assertEnabled();
    const stored = await prisma.musicLyrics.findUnique({ where: { provider_providerTrackId: { provider: 'jiosaavn', providerTrackId: trackId } } });
    if (stored && stored.status !== 'not_found') {
      return { status: stored.status as LyricsResult['status'], lines: (stored.lines as LyricLine[] | null) ?? [], plainText: stored.plainText };
    }
    if (stored && Date.now() - stored.checkedAt.getTime() < NOT_FOUND_RETRY_MS) {
      throw new HttpError(404, "Lyrics aren't available for this song", 'LYRICS_NOT_FOUND');
    }

    const track = await this.track(trackId);
    let record: LrclibRecord | null = null;
    try {
      record = await this.matchLyrics(track);
    } catch (error) {
      logger.warn('Lyrics lookup failed', { trackId, error: (error as Error)?.message });
      throw new HttpError(503, 'Lyrics are unavailable right now', 'LYRICS_UNAVAILABLE');
    }

    const durationMs = track.durationMs || Math.round((record?.duration ?? 0) * 1000);
    const result: LyricsResult | null = !record
      ? null
      : record.instrumental
        ? { status: 'instrumental', lines: [], plainText: null }
        : record.syncedLyrics
          ? { status: 'found', lines: parseLrc(record.syncedLyrics, durationMs), plainText: record.plainLyrics }
          : record.plainLyrics
            ? { status: 'plain_only', lines: [], plainText: record.plainLyrics }
            : null;

    const data = {
      lrclibId: record?.id ?? null,
      status: result?.status ?? 'not_found',
      lines: result?.lines.length ? (result.lines as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      plainText: result?.plainText ?? null,
      checkedAt: new Date(),
    };
    await prisma.musicLyrics.upsert({
      where: { provider_providerTrackId: { provider: 'jiosaavn', providerTrackId: trackId } },
      create: { provider: 'jiosaavn', providerTrackId: trackId, ...data },
      update: data,
    });
    if (!result) throw new HttpError(404, "Lyrics aren't available for this song", 'LYRICS_NOT_FOUND');
    return result;
  }

  /**
   * JioSaavn credits composers and singers together ("Mithoon, Arijit Singh"),
   * and LRCLIB files a song under whoever uploaded it, so every credited artist
   * is tried. Synced lyrics end the search; plain lyrics or an instrumental
   * entry are kept only as a fallback in case nothing synced turns up.
   */
  private static async matchLyrics(track: MusicTrack): Promise<LrclibRecord | null> {
    const artists = track.artists.split(',').map((artist) => artist.trim()).filter(Boolean).slice(0, 4);
    const durationSeconds = track.durationMs / 1000;
    let fallback: LrclibRecord | null = null;
    const consider = (record: LrclibRecord | null) => {
      if (!record || lyricsTier(record) >= 3) return false;
      if (record.syncedLyrics) return true;
      if (!fallback || lyricsTier(record) < lyricsTier(fallback)) fallback = record;
      return false;
    };

    for (const artist of artists) {
      const exact = await LrclibClient.get({ track: track.title, artist, album: track.album, durationSeconds });
      if (consider(exact)) return exact;
    }
    const titles = [...new Set([track.title, cleanTitle(track.title)])].filter(Boolean);
    for (const title of titles) {
      const records = (await LrclibClient.search({ track: title })).filter((record) => artistMatches(record.artistName, artists));
      const candidate = pickLyricsCandidate(records, durationSeconds);
      if (consider(candidate)) return candidate;
    }
    return fallback;
  }
}
