const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/discovery/media/preparation.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported });
const { createImagePreparation, photoPreparationWindow } = exported;
const flush = () => new Promise(resolve => setImmediate(resolve));

test('limits concurrent requests and drops obsolete queued images after a swipe', async () => {
  const calls = [], finish = new Map();
  const queue = createImagePreparation(uri => { calls.push(uri); return new Promise(resolve => finish.set(uri, resolve)); });
  queue.update(['a', 'b', 'stale']);
  await flush();
  assert.deepEqual(calls, ['a', 'b']);
  queue.update(['new', 'a']);
  finish.get('a')();
  await flush();
  assert.deepEqual(calls, ['a', 'b', 'new']);
  queue.stop();
  finish.get('b')(); finish.get('new')();
  await flush();
});

test('deduplicates requests and stops queued work when leaving the screen', async () => {
  const calls = [], finish = new Map();
  const queue = createImagePreparation(uri => { calls.push(uri); return new Promise(resolve => finish.set(uri, resolve)); });
  queue.update(['a', 'a', 'b', 'c']);
  await flush();
  queue.stop(); finish.get('a')(); finish.get('b')();
  await flush();
  queue.update(['a', 'b']);
  await flush();
  assert.deepEqual(calls, ['a', 'b']);
});

test('does not repeatedly fetch failed images on every render', async () => {
  let calls = 0;
  const queue = createImagePreparation(async () => { calls++; throw new Error('offline'); });
  queue.update(['a']); await flush();
  queue.update(['a']); await flush();
  assert.equal(calls, 1);
});

test('prepares two current photos, two next photos and one third photo despite video errors', () => {
  const cards = [
    { photos: ['a1', 'a2', 'a3'], videoState: 'error' },
    { photos: ['b1', 'b2', 'b3'], videoState: 'error' },
    { photos: ['c1', 'c2'] },
    { photos: ['d1'] },
  ];
  assert.deepEqual(Array.from(photoPreparationWindow(cards)), ['a1', 'a2', 'b1', 'b2', 'c1']);
  assert.deepEqual(Array.from(photoPreparationWindow(cards, 'a2')), ['a1', 'a2', 'a3', 'b1', 'b2', 'c1']);
});

test('video preparation gate remains closed until all priority photos complete', async () => {
  const finish = new Map();
  const queue = createImagePreparation(uri => new Promise(resolve => finish.set(uri, resolve)));
  queue.update(['a', 'b']);
  await flush();
  assert.equal(queue.isPrepared(['a', 'b']), false);
  finish.get('a')(); await flush();
  assert.equal(queue.isPrepared(['a', 'b']), false);
  finish.get('b')(); await flush();
  assert.equal(queue.isPrepared(['a', 'b']), true);
});

test('fetches a video card\'s poster before its photos', () => {
  const cards = [
    { video: 'v0', videoPoster: 'p0', photos: ['a1', 'a2', 'a3'] },
    { video: 'v1', videoPoster: 'p1', photos: ['b1'] },
    { photos: ['c1'] },
  ];
  assert.deepEqual(Array.from(photoPreparationWindow(cards)), ['p0', 'a1', 'a2', 'p1', 'b1', 'c1']);
});
