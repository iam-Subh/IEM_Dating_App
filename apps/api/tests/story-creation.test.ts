/**
 * Unit tests for story creation: lyrics parsing and matching, JioSaavn
 * normalisation, link sticker checks and composition validation. No network,
 * database or storage: every upstream response is a saved fixture.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTitle, parseLrc } from '../src/utils/lrc';
import { checkLinkShape } from '../src/utils/linkSafety';
import { decodeEntities, normalizeSaavnSong } from '../src/services/music/jiosaavn.provider';
import { artistMatches, pickLyricsCandidate, type LrclibRecord } from '../src/services/music/lrclib.client';
import { revealOf, storyCompositionSchema } from '../src/schemas/story-composition.schema';
import { captionSegments } from '../src/services/story-captions.service';

/** Trimmed from GET /api/songs/aRZbUYD7 on 2026-09-14. */
const SAAVN_SONG = {
  id: 'aRZbUYD7', name: 'Tum Hi Ho', type: 'song', year: '2013', duration: 262, label: 'T-Series', explicitContent: false,
  language: 'hindi', hasLyrics: true, url: 'https://www.jiosaavn.com/song/tum-hi-ho/EToxUyFpcwQ',
  album: { id: '1139549', name: 'Aashiqui 2' },
  artists: { primary: [{ id: '702592', name: 'Mithoon' }, { id: '459320', name: 'Arijit Singh' }], all: [] },
  image: [
    { quality: '50x50', url: 'https://c.saavncdn.com/430/Aashiqui-2-Hindi-2013-50x50.jpg' },
    { quality: '150x150', url: 'https://c.saavncdn.com/430/Aashiqui-2-Hindi-2013-150x150.jpg' },
    { quality: '500x500', url: 'https://c.saavncdn.com/430/Aashiqui-2-Hindi-2013-500x500.jpg' },
  ],
  downloadUrl: [
    { quality: '12kbps', url: 'https://aac.saavncdn.com/430/x_12.mp4' },
    { quality: '48kbps', url: 'https://aac.saavncdn.com/430/x_48.mp4' },
    { quality: '96kbps', url: 'https://aac.saavncdn.com/430/x_96.mp4' },
    { quality: '160kbps', url: 'https://aac.saavncdn.com/430/x_160.mp4' },
    { quality: '320kbps', url: 'https://aac.saavncdn.com/430/x_320.mp4' },
  ],
};

const transform = { x: 540, y: 960, scale: 1, rotation: 0 };

test('LRC lines become timed lines that end where the next begins', () => {
  const lines = parseLrc('[ar: Arijit Singh]\n[00:11.20] Hum tere bin\n[00:15.55] Tere bina\n\n[00:25.7]\n[01:02.345]Last line', 70_000);
  assert.deepEqual(lines, [
    { startMs: 11_200, endMs: 15_550, text: 'Hum tere bin' },
    { startMs: 15_550, endMs: 25_700, text: 'Tere bina' },
    { startMs: 25_700, endMs: 62_345, text: '' },
    { startMs: 62_345, endMs: 70_000, text: 'Last line' },
  ]);
});

test('a line with several timestamps is repeated at each, in time order', () => {
  const lines = parseLrc('[00:30.00][00:10.00]Chorus\n[00:20.00]Verse', 40_000);
  assert.deepEqual(lines.map((line) => [line.startMs, line.text]), [[10_000, 'Chorus'], [20_000, 'Verse'], [30_000, 'Chorus']]);
  assert.equal(lines[2].endMs, 40_000);
});

test('titles lose the parts that stop lyrics from matching', () => {
  assert.equal(cleanTitle('Kesariya (From "Brahmastra")'), 'Kesariya');
  assert.equal(cleanTitle('Apna Bana Le - Remix'), 'Apna Bana Le');
  assert.equal(cleanTitle('Song feat. Someone'), 'Song');
  assert.equal(cleanTitle('Tum Hi Ho'), 'Tum Hi Ho');
});

test('the lyric candidate is within 3 seconds, synced first, then closest', () => {
  const record = (id: number, duration: number, synced: boolean): LrclibRecord => ({
    id, trackName: 'T', artistName: 'A', albumName: null, duration, instrumental: false,
    plainLyrics: 'words', syncedLyrics: synced ? '[00:01.00]words' : null,
  });
  assert.equal(pickLyricsCandidate([record(1, 262, false), record(2, 264, true), record(3, 261, true)], 262)?.id, 3);
  assert.equal(pickLyricsCandidate([record(1, 262, false)], 262)?.id, 1, 'plain lyrics when nothing synced is close');
  assert.equal(pickLyricsCandidate([record(1, 280, true)], 262), null, 'a different recording is not used');
  const instrumental: LrclibRecord = { ...record(9, 262, false), instrumental: true, plainLyrics: null };
  assert.equal(pickLyricsCandidate([instrumental, record(4, 263, false)], 262)?.id, 4, 'an instrumental entry never beats sung lyrics');
  assert.equal(pickLyricsCandidate([instrumental], 262)?.id, 9, 'but is used when it is all there is');
});

test('artists match loosely across credit styles', () => {
  assert.equal(artistMatches('Pritam, Arijit Singh, Amitabh Bhattacharya', ['Arijit Singh']), true);
  assert.equal(artistMatches('Arijit Singh', ['Mithoon', 'Arijit Singh']), true);
  assert.equal(artistMatches('A.R. Rahman', ['a r rahman']), true);
  assert.equal(artistMatches('Shreya Ghoshal', ['Mithoon', 'Arijit Singh']), false);
});

test('a JioSaavn song is normalised with the right artwork and streams', () => {
  const track = normalizeSaavnSong(SAAVN_SONG)!;
  assert.equal(track.id, 'aRZbUYD7');
  assert.equal(track.title, 'Tum Hi Ho');
  assert.equal(track.artists, 'Mithoon, Arijit Singh');
  assert.equal(track.album, 'Aashiqui 2');
  assert.equal(track.durationMs, 262_000);
  assert.equal(track.explicit, false);
  assert.equal(track.artwork.small, SAAVN_SONG.image[1].url);
  assert.equal(track.artwork.large, SAAVN_SONG.image[2].url);
  assert.equal(track.streams.preview, 'https://aac.saavncdn.com/430/x_96.mp4');
  assert.equal(track.streams.standard, 'https://aac.saavncdn.com/430/x_160.mp4');
  assert.equal(normalizeSaavnSong({ ...SAAVN_SONG, downloadUrl: [] }), null, 'a song with no stream is not offered');
  assert.equal(decodeEntities('Gehra Hua (From &quot;Dhurandhar&quot;) &amp; more'), 'Gehra Hua (From "Dhurandhar") & more');
});

test('link stickers accept public web links only', () => {
  assert.equal(checkLinkShape('example.com/page').ok, true);
  assert.deepEqual(checkLinkShape('https://iem.edu.in/events?x=1'), { ok: true, url: 'https://iem.edu.in/events?x=1', host: 'iem.edu.in' });
  for (const bad of ['javascript:alert(1)', 'http://192.168.1.10/admin', 'https://[::1]/', 'http://localhost:3000', 'https://user:pass@example.com', 'ftp://example.com', 'https://intranet', `https://example.com/${'a'.repeat(2100)}`]) {
    assert.equal(checkLinkShape(bad).ok, false, bad);
  }
});

test('a composition is validated: unique ids, a real quiz answer, a sane countdown', () => {
  const valid = storyCompositionSchema.parse({
    version: 1,
    interactive: [
      { id: 'poll1', type: 'poll', question: 'Canteen or cafe?', options: ['Canteen', 'Cafe'], transform },
      { id: 'quiz1', type: 'quiz', question: 'Fest date?', options: ['Fri', 'Sat', 'Sun'], correctIndex: 2, transform },
      { id: 'count1', type: 'countdown', title: 'Fest', endsAt: new Date(Date.now() + 86_400_000).toISOString(), transform },
    ],
    music: { provider: 'jiosaavn', trackId: 'aRZbUYD7', title: 'Tum Hi Ho', artists: 'Arijit Singh', startMs: 60_000, lengthMs: 15_000, display: 'lyrics' },
  });
  assert.equal(valid.interactive[0].type, 'poll');
  assert.equal((valid.interactive[0] as { style: string }).style, 'default');

  assert.equal(storyCompositionSchema.safeParse({
    version: 1,
    interactive: [
      { id: 'a', type: 'question', prompt: 'Ask me', transform },
      { id: 'a', type: 'question', prompt: 'Again', transform },
    ],
  }).success, false, 'duplicate sticker ids');
  assert.equal(storyCompositionSchema.safeParse({
    version: 1,
    interactive: [{ id: 'q', type: 'quiz', question: 'Pick', options: ['A', 'B'], correctIndex: 3, transform }],
  }).success, false, 'the correct answer must be an option');
  assert.equal(storyCompositionSchema.safeParse({
    version: 1,
    interactive: [{ id: 'c', type: 'countdown', title: 'Old', endsAt: new Date(Date.now() - 3_600_000).toISOString(), transform }],
  }).success, false, 'a countdown cannot end in the past');
  assert.equal(storyCompositionSchema.safeParse({ version: 1, interactive: [{ id: 'x', type: 'text', transform }] }).success, false, 'decorative layers are not stored');
  assert.equal(storyCompositionSchema.safeParse({
    version: 1,
    interactive: [{ id: 'g', type: 'gif', url: 'https://media2.giphy.com/media/abc/200w.gif?cid=1', width: 480, height: 360, transform }],
  }).success, true, 'a GIPHY sticker is kept so it animates');
  assert.equal(storyCompositionSchema.safeParse({
    version: 1,
    interactive: [{ id: 'g', type: 'gif', url: 'https://evil.example.com/x.gif', width: 480, height: 360, transform }],
  }).success, false, 'GIFs only from GIPHY');
});

test('Frames and Reveal: a frame keeps its photo size, a story has one Reveal', () => {
  const transform = { x: 540, y: 960, scale: 1, rotation: 0 };
  const parsed = storyCompositionSchema.parse({
    version: 1,
    interactive: [
      { id: 'f', type: 'frame', width: 600, height: 750, transform },
      { id: 'r', type: 'reveal', hint: '  guess who  ', transform },
    ],
  });
  assert.equal((parsed.interactive[1] as { hint: string }).hint, 'guess who');
  assert.deepEqual(revealOf(parsed), { hint: 'guess who' });
  assert.equal(revealOf({ version: 1, interactive: [] }), null);
  assert.equal(revealOf(null), null);
  assert.equal(storyCompositionSchema.safeParse({
    version: 1,
    interactive: [{ id: 'a', type: 'reveal', transform }, { id: 'b', type: 'reveal', transform }],
  }).success, false, 'only one Reveal');
});

test('captions break at sentence ends, seven words and pauses', () => {
  const word = (content: string, start: number, end: number) => ({ type: 'pronunciation', start_time: String(start), end_time: String(end), alternatives: [{ content }] });
  const punctuation = (content: string) => ({ type: 'punctuation', alternatives: [{ content }] });
  const segments = captionSegments([
    word('Hello', 0.1, 0.4), word('everyone', 0.45, 0.9), punctuation('.'),
    word('one', 1.0, 1.1), word('two', 1.15, 1.2), word('three', 1.25, 1.3), word('four', 1.35, 1.4), word('five', 1.45, 1.5), word('six', 1.55, 1.6), word('seven', 1.65, 1.7), word('eight', 1.75, 1.8),
    word('later', 3.5, 3.6),
  ]);
  assert.deepEqual(segments.map((segment) => segment.text), ['Hello everyone.', 'one two three four five six seven', 'eight', 'later']);
  assert.equal(segments[0].startMs, 100);
  assert.equal(segments[0].endMs, 900);
  assert.equal(segments[2].endMs, 2450, 'a short line stays up for 0.7 s');
});

test('Add Yours: a prompt is required, a thread id is optional, one per story', () => {
  const transform = { x: 540, y: 960, scale: 1, rotation: 0 };
  const start = { id: 'a', type: 'addYours', prompt: 'Show your hostel view', transform };
  assert.equal(storyCompositionSchema.safeParse({ version: 1, interactive: [start] }).success, true);
  assert.equal(storyCompositionSchema.safeParse({ version: 1, interactive: [{ ...start, threadId: '00000000-0000-4000-8000-000000000009', music: true }] }).success, true);
  assert.equal(storyCompositionSchema.safeParse({ version: 1, interactive: [{ ...start, prompt: '  ' }] }).success, false, 'empty prompt');
  assert.equal(storyCompositionSchema.safeParse({ version: 1, interactive: [start, { ...start, id: 'b' }] }).success, false, 'only one Add Yours');
});
