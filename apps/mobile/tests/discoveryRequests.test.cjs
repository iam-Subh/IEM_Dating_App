const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exportsForTest = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/discovery/discoveryRequests.ts'), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS},
}).outputText, {exports: exportsForTest, AbortController});

test('a refresh cancels an older request and prevents stale responses', () => {
  const requests = exportsForTest.createDiscoveryRequests();
  const older = requests.begin(true);
  assert.equal(requests.begin(false), null);
  const latest = requests.begin(true);
  assert.equal(older.signal.aborted, true);
  assert.equal(older.isLatest(), false);
  assert.equal(latest.isLatest(), true);
  older.finish();
  assert.equal(requests.begin(false), null, 'old finally must not release the newer request');
});

test('accepted state updates remain valid after finally; the next request invalidates them', () => {
  const requests = exportsForTest.createDiscoveryRequests();
  const first = requests.begin(true);
  first.finish();
  assert.equal(first.isLatest(), true);
  const page = requests.begin(false);
  assert.ok(page);
  assert.equal(first.isLatest(), false);
  requests.cancel();
  assert.equal(page.signal.aborted, true);
  assert.equal(page.isLatest(), false);
});
