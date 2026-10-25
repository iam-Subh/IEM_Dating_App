const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

/** Loads a TypeScript module and the relative modules it imports; anything else is an empty stub. */
function load(file, cache = new Map()) {
  const full = path.resolve(file);
  if (cache.has(full)) return cache.get(full);
  const exported = {};
  cache.set(full, exported);
  const source = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const localRequire = (specifier) => (specifier.startsWith('.')
    ? load(path.join(path.dirname(full), `${specifier}.ts`), cache)
    : {});
  vm.runInNewContext(source, { exports: exported, require: localRequire, Math, Date, Array, Object, String, Number });
  return exported;
}

/** Values made inside the sandbox have its own prototypes; compare them as plain data. */
const plain = (value) => JSON.parse(JSON.stringify(value));

const create = path.join(__dirname, '../src/features/stories/create');
const story = load(path.join(create, 'composition/story.ts'));
const filters = load(path.join(create, 'filters.ts'));

const video = (durationMs, trim) => ({
  ...story.newStoryItem({ kind: 'video', uri: 'file:///v.mp4', width: 1080, height: 1920, durationMs }),
  trim,
});

test('a video up to 60 seconds is one story; longer is split into 60 second parts', () => {
  assert.equal(story.videoParts(video(45_000, { startMs: 0, endMs: 45_000 })).length, 1);
  assert.equal(story.videoParts(video(60_300, { startMs: 0, endMs: 60_300 })).length, 1, 'half a second of slack');
  const parts = story.videoParts(video(150_000, { startMs: 0, endMs: 150_000 }));
  assert.deepEqual(plain(parts.map((part) => [part.startMs, part.endMs, part.partIndex, part.partCount])), [
    [0, 60_000, 1, 3], [60_000, 120_000, 2, 3], [120_000, 150_000, 3, 3],
  ]);
  const folded = story.videoParts(video(120_600, { startMs: 0, endMs: 120_600 }));
  assert.equal(folded.length, 2, 'a last part under a second joins the one before');
  assert.equal(folded[1].endMs, 120_600);
  const trimmed = story.videoParts(video(200_000, { startMs: 30_000, endMs: 100_000 }));
  assert.deepEqual(plain(trimmed.map((part) => [part.startMs, part.endMs])), [[30_000, 90_000], [90_000, 100_000]]);
});

test('a story lasts its photo duration, its music clip, or its video length', () => {
  const photo = story.newStoryItem({ kind: 'photo', uri: 'file:///p.jpg', width: 1080, height: 1920 });
  assert.equal(story.storyDurationMs(photo), 5000);
  assert.equal(story.storyDurationMs({ ...photo, photoDurationMs: 22_000 }), 15_000);
  assert.equal(story.storyDurationMs({ ...photo, photoDurationMs: 300 }), 1000);
  assert.equal(story.storyDurationMs({ ...photo, music: { lengthMs: 10_000 } }), 10_000);
  assert.equal(story.storyDurationMs(video(90_000, { startMs: 10_000, endMs: 40_000 })), 30_000);
  assert.equal(story.postedCount([photo, video(150_000, { startMs: 0, endMs: 150_000 })]), 4);
});

test('portrait media fills the canvas, anything wider is shown whole', () => {
  assert.equal(story.fitModeFor(1080, 1920), 'cover');
  assert.equal(story.fitModeFor(3000, 4000), 'contain');
  assert.equal(story.fitModeFor(1920, 1080), 'contain');
});

test('only interactive stickers and music go to the server', () => {
  const photo = story.newStoryItem({ kind: 'photo', uri: 'file:///p.jpg', width: 1080, height: 1920 });
  const composition = story.toServerComposition({
    ...photo,
    layers: [
      { id: 't', kind: 'text', text: 'hi', font: 'classic', color: '#fff', background: 'none', align: 'center', size: 90, transform: { x: 1, y: 2, scale: 1, rotation: 0 } },
      { id: 's', kind: 'sticker', sticker: { id: 's', type: 'poll', question: 'Q', options: ['A', 'B'], style: 'default', transform: { x: 540.123, y: 5000, scale: 40, rotation: 12.34 } } },
    ],
    music: { provider: 'jiosaavn', trackId: 'x', title: 'Song', artists: 'A', startMs: 0, lengthMs: 15_000, display: 'lyrics', track: { id: 'x' } },
  });
  assert.equal(composition.interactive.length, 1);
  assert.deepEqual(plain(composition.interactive[0].transform), { x: 540.1, y: 3840, scale: 20, rotation: 12.3 }, 'rounded and kept in the server bounds');
  assert.equal(composition.music.track, undefined, 'the full song record stays on the phone');
  assert.equal(composition.music.trackId, 'x');
});

test('filter matrices: neutral is identity, grayscale removes colour, brightness adds, contrast pivots on grey', () => {
  const identity = filters.colorMatrix({ brightness: 0, contrast: 0, saturation: 0, warmth: 0, grayscale: false });
  assert.deepEqual(plain(identity), [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);
  const apply = (matrix, [r, g, b]) => [0, 1, 2].map((row) => matrix[row * 5] * r + matrix[row * 5 + 1] * g + matrix[row * 5 + 2] * b + matrix[row * 5 + 4]);
  const gray = apply(filters.colorMatrix({ brightness: 0, contrast: 0, saturation: 0, warmth: 0, grayscale: true }), [1, 0, 0]);
  assert.ok(Math.abs(gray[0] - gray[1]) < 1e-9 && Math.abs(gray[1] - gray[2]) < 1e-9, 'red becomes a grey');
  const bright = apply(filters.colorMatrix({ brightness: 0.1, contrast: 0, saturation: 0, warmth: 0, grayscale: false }), [0.5, 0.5, 0.5]);
  assert.ok(bright.every((value) => Math.abs(value - 0.6) < 1e-9));
  const contrasted = apply(filters.colorMatrix({ brightness: 0, contrast: 0.5, saturation: 0, warmth: 0, grayscale: false }), [0.5, 0.5, 0.5]);
  assert.ok(contrasted.every((value) => Math.abs(value - 0.5) < 1e-3), 'mid grey stays mid grey');
  assert.equal(filters.filterById('nope').id, 'normal');
  assert.ok(filters.STORY_FILTERS.length >= 12);
});
