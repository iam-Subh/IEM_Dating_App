const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness(saved = [], gate = Promise.resolve()) {
  const files = new Map(saved.map(([, uri]) => [uri, 100]));
  let downloads = 0;
  let stats = 0;
  let size = 100;
  let fail = false;
  class Directory {
    constructor(...parts) { this.uri = parts.map(p => p.uri ?? p).join('/'); }
    get exists() { return true; }
    create() {}
  }
  class File extends Directory {
    get exists() { stats++; return files.has(this.uri); }
    get size() { return files.get(this.uri); }
    delete() { files.delete(this.uri); }
    static async downloadFileAsync(url, destination) {
      downloads++;
      if (fail) throw new Error('Network failure');
      files.set(destination.uri, size);
      return destination;
    }
  }
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/chat/sentMediaCache.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name) {
      if (name === '@react-native-async-storage/async-storage') return {
        getItem: async () => { await gate; return JSON.stringify(saved); },
        setItem: async () => {},
      };
      if (name === 'expo-file-system') return { Directory, File, Paths: { cache: 'file://cache' } };
      if (name === './draftMedia') return { discardDraftMedia: async uri => files.delete(uri) };
      throw new Error(name);
    },
  });
  return { cache: module.exports, files, count: () => downloads, stats: () => stats, setSize: value => size = value, setFail: value => fail = value };
}

test('waits for the stored index before requesting a remote URL', async () => {
  let release;
  const h = harness([['photo', 'file://existing']], new Promise(resolve => { release = resolve; }));
  let urlCalls = 0;
  const pending = h.cache.resolveCachedMedia('photo', async () => { urlCalls++; return 'https://media'; });
  await Promise.resolve();
  assert.equal(urlCalls, 0);
  release();
  assert.equal(await pending, 'file://existing');
  assert.equal(urlCalls, 0);
  assert.equal(h.count(), 0);
});

test('concurrent and repeated requests share one file without signing again', async () => {
  const h = harness();
  let urlCalls = 0;
  const url = async () => { urlCalls++; return 'https://media'; };
  const [a, b] = await Promise.all([h.cache.resolveCachedMedia('photo', url), h.cache.resolveCachedMedia('photo', url)]);
  assert.equal(a, b);
  assert.equal(await h.cache.resolveCachedMedia('photo', url), a);
  assert.equal(urlCalls, 1);
  assert.equal(h.count(), 1);
});

test('keeps original files above 25 MB', async () => {
  const h = harness();
  h.setSize(60 * 1024 * 1024);
  const uri = await h.cache.resolveCachedMedia('video', async () => 'https://media');
  assert.equal(h.cache.sentMediaUri('video'), uri);
  assert.equal(h.files.get(uri), 60 * 1024 * 1024);
});

test('replaces a missing file instead of treating a stale index entry as cached', async () => {
  const h = harness([['photo', 'file://missing']]);
  h.files.clear();
  const uri = await h.cache.resolveCachedMedia('photo', async () => 'https://media');
  assert.notEqual(uri, 'file://missing');
  assert.equal(h.count(), 1);
});

test('a failed download can retry and does not keep an in-flight entry', async () => {
  const h = harness();
  h.setFail(true);
  await assert.rejects(h.cache.resolveCachedMedia('photo', async () => 'https://media'));
  h.setFail(false);
  const uri = await h.cache.resolveCachedMedia('photo', async () => 'https://media');
  assert.equal(h.cache.sentMediaUri('photo'), uri);
  assert.equal(h.count(), 2);
});

test('eviction does not delete a file still referenced by another message', async () => {
  const saved = Array.from({ length: 300 }, (_, i) => [`key-${i}`, i === 0 || i === 299 ? 'file://shared' : `file://item-${i}`]);
  const h = harness(saved);
  await h.cache.resolveCachedMedia('new-photo', async () => 'https://media');
  assert.equal(h.files.has('file://shared'), true);
  assert.equal(h.cache.sentMediaUri('key-299'), 'file://shared');
});

test('limits simultaneous cache requests and drains the queue', async () => {
  const h = harness();
  const release = [];
  let started = 0;
  const pending = Array.from({ length: 5 }, (_, i) => h.cache.resolveCachedMedia(`photo-${i}`, () => {
    started++;
    return new Promise(resolve => release.push(() => resolve('https://media')));
  }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, 3);
  release.splice(0).forEach(resolve => resolve());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, 5);
  release.splice(0).forEach(resolve => resolve());
  await Promise.all(pending);
  assert.equal(h.count(), 5);
});

test('render lookups never read the filesystem; the loader still validates stale files', async () => {
  const h = harness([['photo', 'file://cached']]);
  await h.cache.hydrateSentMediaCache();
  h.files.clear();
  for (let i = 0; i < 100; i++) assert.equal(h.cache.peekSentMediaUri('photo'), 'file://cached');
  assert.equal(h.stats(), 0);
  const uri = await h.cache.resolveCachedMedia('photo', async () => 'https://media');
  assert.notEqual(uri, 'file://cached');
  assert.equal(h.count(), 1);
});
