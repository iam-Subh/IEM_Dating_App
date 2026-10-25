const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/stories/prepareStoryOpening.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const photo = { url: 'https://example.test/photo.jpg', contentType: 'image/jpeg' };
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup({ source = photo, prefetch = async () => true } = {}) {
  const exports = {};
  let statusListener;
  const calls = { released: 0, retained: 0, removed: 0, videos: 0, photos: 0 };
  const player = {
    status: 'loading',
    addListener: (_name, callback) => { statusListener = callback; return { remove: () => { calls.removed++; } }; },
    replaceAsync: async () => {},
    release: () => { calls.released++; },
  };
  vm.runInNewContext(code, {
    exports, setTimeout, clearTimeout,
    require: name => name === 'expo-video' ? { createVideoPlayer: () => { calls.videos++; return player; } }
      : name === './preparedStoryVideo' ? { retainStoryVideo: () => { calls.retained++; } }
      : { loadStorySource: async () => source, prepareStoryPhoto: (...args) => { calls.photos++; return prefetch(...args); } },
  });
  return { prepare: exports.prepareStoryOpening, calls, status: value => statusListener({ status: value }) };
}

test('opening waits for the photo download even when its URL is cached', async () => {
  let loaded;
  const { prepare } = setup({ prefetch: () => new Promise(resolve => { loaded = resolve; }) });
  let opened = false;
  const pending = prepare('photo', new AbortController().signal).then(() => { opened = true; });
  await tick();
  assert.equal(opened, false);
  loaded(true);
  await pending;
  assert.equal(opened, true);
});

test('a failed photo download rejects instead of opening an empty viewer', async () => {
  const { prepare } = setup({ prefetch: async () => false });
  await assert.rejects(prepare('photo', new AbortController().signal), /could not load/);
});

test('video preparation waits for playable media and retains the buffer for the viewer', async () => {
  const { prepare, status, calls } = setup({ source: { url: 'https://example.test/video.mp4', contentType: 'video/mp4' } });
  let opened = false;
  const pending = prepare('video', new AbortController().signal).then(() => { opened = true; });
  await tick();
  assert.equal(opened, false);
  status('readyToPlay');
  await pending;
  assert.equal(calls.released, 0);
  assert.equal(calls.retained, 1);
  assert.equal(calls.removed, 1);
});

test('leaving the tray cancels video loading and releases native resources', async () => {
  const { prepare, calls } = setup({ source: { url: 'https://example.test/video.mp4', contentType: 'video/mp4' } });
  const controller = new AbortController();
  const pending = prepare('video', controller.signal);
  const rejected = assert.rejects(pending, /cancelled/);
  await tick();
  controller.abort();
  await rejected;
  assert.equal(calls.released, 1);
  assert.equal(calls.removed, 1);
});

test('locked stories open their hint without downloading private media', async () => {
  const { prepare, calls } = setup({ source: { ...photo, locked: { hint: 'Say hello', preview: null } } });
  const source = await prepare('locked', new AbortController().signal);
  assert.equal(source.locked.hint, 'Say hello');
  assert.equal(calls.photos, 0);
  assert.equal(calls.videos, 0);
});
