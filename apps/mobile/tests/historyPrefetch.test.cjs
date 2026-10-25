const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/chat/historyPrefetch.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exported });
const { createHistoryPrefetch } = exported;

test('scroll consumption shares an unfinished prefetch', async () => {
  let calls = 0;
  let finish;
  const cache = createHistoryPrefetch(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const prefetched = cache.prime('older');
  const consumed = cache.take('older');
  await Promise.resolve();
  finish({ messages: ['one'] });
  assert.equal(await prefetched, await consumed);
  assert.equal(calls, 1);
});

test('a ready page needs no second request and does not load all history', async () => {
  const calls = [];
  const cache = createHistoryPrefetch(async cursor => { calls.push(cursor); return cursor; });
  await cache.prime('page-2');
  assert.equal(await cache.take('page-2'), 'page-2');
  assert.deepEqual(calls, ['page-2']);
  await cache.prime('page-3');
  assert.deepEqual(calls, ['page-2', 'page-3']);
});

test('failed prefetch retries when the page is needed', async () => {
  let calls = 0;
  const cache = createHistoryPrefetch(async () => { if (++calls === 1) throw new Error('offline'); return 'page'; });
  await assert.rejects(cache.prime('older'));
  assert.equal(await cache.take('older'), 'page');
  assert.equal(calls, 2);
});
