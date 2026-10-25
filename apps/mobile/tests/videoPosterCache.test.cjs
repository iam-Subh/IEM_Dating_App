const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
  '../src/features/auth/onboarding/videoPosterCache.ts'), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText, {exports: exportsObject});
const {createVideoPosterCache} = exportsObject;

test('cards share one thumbnail request and reuse it after returning from a modal', async () => {
  let calls = 0;
  let finish;
  const cache = createVideoPosterCache(() => {calls++; return new Promise(resolve => {finish = resolve;});});
  const first = cache.get('video');
  const second = cache.get('video');
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  const poster = {uri: 'file://poster.jpg', duration: 30};
  finish(poster);
  assert.equal(await first, poster);
  assert.equal(cache.read('video'), poster);
  assert.equal(await cache.get('video'), poster);
  assert.equal(calls, 1);
});

test('an uploaded URL reuses the local video thumbnail without loading the video again', async () => {
  let calls = 0;
  const poster = {uri: 'file://poster.jpg', duration: 30};
  const cache = createVideoPosterCache(async () => {calls++; return poster;});
  await cache.get('file://video.mp4');
  cache.copy('file://video.mp4', 'https://server/video.mp4');
  assert.equal(cache.read('https://server/video.mp4'), poster);
  assert.equal(await cache.get('https://server/video.mp4'), poster);
  assert.equal(calls, 1);
});

test('upload can share a thumbnail that is still being generated', async () => {
  let finish;
  let calls = 0;
  const cache = createVideoPosterCache(() => {calls++; return new Promise(resolve => {finish = resolve;});});
  const local = cache.get('local');
  cache.copy('local', 'remote');
  const remote = cache.get('remote');
  await Promise.resolve();
  finish({uri: 'poster', duration: 20});
  assert.equal(await local, await remote);
  assert.equal(calls, 1);
});

test('a failed thumbnail request can retry and cannot replace a different video thumbnail', async () => {
  let calls = 0;
  const cache = createVideoPosterCache(async uri => {
    calls++;
    if (calls === 1) throw new Error('decode failed');
    return {uri: `poster-${uri}`, duration: 20};
  });
  await assert.rejects(cache.get('first'), /decode failed/);
  assert.equal(cache.read('first'), undefined);
  assert.equal((await cache.get('first')).uri, 'poster-first');
  assert.equal((await cache.get('replacement')).uri, 'poster-replacement');
  assert.equal(cache.read('first').uri, 'poster-first');
});

test('thumbnail memory cache retains recently used entries within its limit', async () => {
  const cache = createVideoPosterCache(async uri => ({uri, duration: 20}), 2);
  await cache.get('one'); await cache.get('two');
  cache.read('one');
  await cache.get('three');
  assert.equal(cache.read('two'), undefined);
  assert.equal(cache.read('one').uri, 'one');
  assert.equal(cache.read('three').uri, 'three');
});

function nativePosterService(failSave = false) {
  const released = [];
  const listeners = new Map();
  let loads = 0;
  const player = {
    addListener(name, callback) {listeners.set(name, callback); return {remove: () => listeners.delete(name)};},
    replaceAsync() {loads++; queueMicrotask(() => listeners.get('sourceLoad')?.({duration: 30})); return Promise.resolve();},
    async generateThumbnailsAsync(time) {
      assert.equal(time, 0.5);
      return [{release: () => released.push('thumbnail')}];
    },
    release() {released.push('player');},
    play() {assert.fail('Thumbnail extraction must not play the video');},
  };
  const modules = {
    'react-native': {Platform: {OS: 'android'}},
    'expo-video': {createVideoPlayer: () => player},
    './videoPosterCache': exportsObject,
    'expo-image-manipulator': {
      SaveFormat: {JPEG: 'jpeg'},
      ImageManipulator: {manipulate: () => ({
        async renderAsync() {return {
          async saveAsync() {if (failSave) throw new Error('save failed'); return {uri: 'file://poster.jpg'};},
          release() {released.push('image');},
        };},
        release() {released.push('context');},
      })},
    },
  };
  const service = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
    '../src/features/auth/onboarding/videoPosterService.ts'), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  }).outputText, {exports: service, require: name => modules[name], setTimeout, clearTimeout});
  return {cache: service.videoPosters, released, listeners, loads: () => loads};
}

test('native poster generation saves one still image and releases all decoder resources', async () => {
  const service = nativePosterService();
  const poster = await service.cache.get('video');
  assert.equal(poster.uri, 'file://poster.jpg');
  await service.cache.get('video');
  assert.equal(service.loads(), 1);
  assert.deepEqual(service.released, ['image', 'context', 'thumbnail', 'player']);
  assert.equal(service.listeners.size, 0);
});

test('failed poster saving still releases native images and the decoder', async () => {
  const service = nativePosterService(true);
  await assert.rejects(service.cache.get('video'), /save failed/);
  assert.deepEqual(service.released, ['image', 'context', 'thumbnail', 'player']);
  assert.equal(service.listeners.size, 0);
});
