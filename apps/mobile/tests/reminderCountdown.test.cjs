const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Only the plain functions are tested: React and the icons are stubbed.
function load() {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/verification/ReminderParts.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText, {
    module, exports: module.exports, Date, Math, String,
    require: (name) => name === 'react-native' ? { StyleSheet: { create: (styles) => styles, hairlineWidth: 1 } } : name === 'react' ? { default: {}, useEffect() {}, useState() {} } : {},
  });
  return module.exports;
}

test('daily limits reset at midnight in India', () => {
  const { msUntilReset } = load();
  // 18:30 UTC is midnight in India.
  assert.equal(msUntilReset(Date.UTC(2026, 9, 24, 18, 30, 0)), 24 * 60 * 60_000, 'just reset: a full day');
  assert.equal(msUntilReset(Date.UTC(2026, 9, 24, 18, 29, 59)), 1000, 'one second before');
  assert.equal(msUntilReset(Date.UTC(2026, 9, 24, 10, 30, 0)), 8 * 60 * 60_000, '16:00 in India: 8 hours');
});

test('the countdown reads hh:mm:ss and never goes below zero', () => {
  const { formatCountdown } = load();
  assert.equal(formatCountdown(8 * 3_600_000 + 42 * 60_000 + 10_000), '08:42:10');
  assert.equal(formatCountdown(999), '00:00:00');
  assert.equal(formatCountdown(-5000), '00:00:00');
});
