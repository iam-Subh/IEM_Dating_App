const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/chat/messageWindow.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exported });

test('a delayed old page cannot enter a replaced message window', async () => {
  const window = exported.createMessageWindow();
  let release;
  const response = new Promise(resolve => { release = resolve; });
  const ticket = window.capture();
  const rows = ['search-result'];
  const pending = response.then(page => {
    if (window.isCurrent(ticket)) rows.push(...page);
  });
  window.invalidate();
  release(['old-page']);
  await pending;
  assert.deepEqual(rows, ['search-result']);
  assert.equal(window.isCurrent(window.capture()), true);
});

test('returning to latest does not revive requests from the earlier latest window', () => {
  const window = exported.createMessageWindow();
  const latest = window.capture();
  window.invalidate();
  const search = window.capture();
  window.invalidate();
  assert.equal(window.isCurrent(latest), false);
  assert.equal(window.isCurrent(search), false);
});

test('closing a screen invalidates all outstanding requests', () => {
  const window = exported.createMessageWindow();
  const older = window.capture();
  const newer = window.capture();
  window.invalidate();
  assert.equal(window.isCurrent(older), false);
  assert.equal(window.isCurrent(newer), false);
});
