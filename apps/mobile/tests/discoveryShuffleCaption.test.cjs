const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/discovery/discoveryShuffleCaption.ts'), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText, {exports: exported});

test('each completed transfer advances the caption and repeated cycles stay valid', () => {
  for (let turn = 0; turn < 300; turn++) {
    assert.equal(exported.shuffleMessageIndex(turn + .99), turn % 3);
    assert.equal(exported.shuffleMessage(turn).title, exported.shuffleMessage(turn % 3).title);
  }
});
test('invalid and negative animation values cannot produce an undefined caption', () => {
  for (const value of [NaN, Infinity, -Infinity, undefined, -1, -3, -100.5]) {
    assert.equal(typeof exported.shuffleMessage(value).title, 'string');
    assert.equal(typeof exported.shuffleMessage(value).detail, 'string');
    assert.ok(exported.shuffleMessageIndex(value) >= 0 && exported.shuffleMessageIndex(value) < 3);
  }
  assert.equal(exported.shuffleMessage(NaN).title, exported.shuffleMessage(0).title);
});
