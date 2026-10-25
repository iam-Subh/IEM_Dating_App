const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/screens/main/profile/profileVideoSourceRequests.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported });
const { createVideoSourceRequest, selectVideoSource, takeVideoSource } = exported;

test('dismissal without a choice does not launch a picker', () => {
  const id = createVideoSourceRequest();
  assert.equal(takeVideoSource(id), null);
});

test('a selected source is delivered once even if dismissal completion fires twice', () => {
  for (const source of ['camera', 'library']) {
    const id = createVideoSourceRequest();
    selectVideoSource(id, source);
    assert.equal(takeVideoSource(id), source);
    assert.equal(takeVideoSource(id), null);
  }
});

test('late selection after an editor closes cannot reopen its picker', () => {
  const id = createVideoSourceRequest();
  takeVideoSource(id);
  selectVideoSource(id, 'camera');
  assert.equal(takeVideoSource(id), null);
});

test('reopening the sheet does not reuse a previous choice', () => {
  const first = createVideoSourceRequest();
  selectVideoSource(first, 'library');
  const second = createVideoSourceRequest();
  assert.notEqual(first, second);
  assert.equal(takeVideoSource(second), null);
  assert.equal(takeVideoSource(first), 'library');
});
