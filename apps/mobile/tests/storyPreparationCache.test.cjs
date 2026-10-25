const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(name, context) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/stories', name), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, { exports, ...context });
  return exports;
}

test('tray prefetch and tap share one image download, including later cache hits', async () => {
  let downloaded;
  let requests = 0;
  const sources = load('storySources.ts', {
    require: name => name === 'react-native'
      ? { Image: { prefetch: () => { requests++; return new Promise(resolve => { downloaded = resolve; }); } } }
      : {},
  });
  const tray = sources.prepareStoryPhoto('https://example.test/photo');
  const tap = sources.prepareStoryPhoto('https://example.test/photo');
  assert.equal(tray, tap);
  downloaded(true);
  await tray;
  assert.equal(await sources.prepareStoryPhoto('https://example.test/photo'), true);
  assert.equal(requests, 1);
});

test('failed image preparation can retry its download', async () => {
  let requests = 0;
  const sources = load('storySources.ts', {
    require: name => name === 'react-native'
      ? { Image: { prefetch: async () => ++requests > 1 } } : {},
  });
  assert.equal(await sources.prepareStoryPhoto('https://example.test/photo'), false);
  assert.equal(await sources.prepareStoryPhoto('https://example.test/photo'), true);
  assert.equal(requests, 2);
});

function videoPool() {
  const timers = new Map();
  let serial = 0;
  const pool = load('preparedStoryVideo.ts', {
    setTimeout: callback => { timers.set(++serial, callback); return serial; },
    clearTimeout: id => timers.delete(id),
  });
  return { ...pool, timers };
}

test('the viewer receives the prepared video once without releasing its buffer', () => {
  const pool = videoPool();
  let releases = 0;
  const player = { release: () => { releases++; } };
  pool.retainStoryVideo('video', player);
  assert.equal(pool.takeStoryVideo('other'), null);
  assert.equal(pool.takeStoryVideo('video'), player);
  assert.equal(pool.takeStoryVideo('video'), null);
  assert.equal(pool.timers.size, 0);
  assert.equal(releases, 0);
});

test('replaced or abandoned prepared videos release their native players', () => {
  const pool = videoPool();
  let releases = 0;
  pool.retainStoryVideo('first', { release: () => { releases++; } });
  pool.retainStoryVideo('second', { release: () => { releases++; } });
  assert.equal(releases, 1);
  [...pool.timers.values()][0]();
  assert.equal(releases, 2);
  assert.equal(pool.takeStoryVideo('second'), null);
});
