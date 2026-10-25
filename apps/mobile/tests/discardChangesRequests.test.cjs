const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/discardChangesRequests.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported });
const { createDiscardRequest, finishDiscardRequest, cancelDiscardRequest } = exported;

test('confirmation exits only once if native dismissal and cleanup both finish the request', () => {
  const results = [];
  const id = createDiscardRequest((discard) => results.push(discard));
  finishDiscardRequest(id, true);
  finishDiscardRequest(id, false);
  assert.deepEqual(results, [true]);
});

test('a dismissal result preserves the draft', () => {
  const results = [];
  const id = createDiscardRequest((discard) => results.push(discard));
  finishDiscardRequest(id, false);
  assert.deepEqual(results, [false]);
});

test('an editor removed elsewhere cannot receive a late discard callback', () => {
  const results = [];
  const id = createDiscardRequest((discard) => results.push(discard));
  cancelDiscardRequest(id);
  finishDiscardRequest(id, true);
  assert.deepEqual(results, []);
});

test('requests from different editors remain separate and use string route parameters', () => {
  const results = [];
  const first = createDiscardRequest((discard) => results.push(['first', discard]));
  const second = createDiscardRequest((discard) => results.push(['second', discard]));
  assert.notEqual(first, second);
  assert.deepEqual(JSON.parse(JSON.stringify({ requestId: first })), { requestId: first });
  finishDiscardRequest(second, false);
  finishDiscardRequest(first, true);
  assert.deepEqual(results, [['second', false], ['first', true]]);
});
