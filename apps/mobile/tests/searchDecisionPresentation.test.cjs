const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
  '../src/features/search/searchDecisionPresentation.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported, Date });
const { decisionDate, decisionTitle, DECISION_APPEARANCE } = exported;

test('decision dates follow calendar days instead of elapsed 24-hour periods', () => {
  const now = new Date(2026, 9, 1, 0, 1);
  assert.equal(decisionDate(new Date(2026, 8, 30, 23, 59).toISOString(), now), 'Yesterday');
  assert.equal(decisionDate(new Date(2026, 9, 1, 0, 0).toISOString(), now), 'Today');
  assert.equal(decisionDate(new Date(2026, 8, 29).toISOString(), now), '2 days ago');
  assert.equal(decisionDate(new Date(2026, 8, 22).toISOString(), now), '9 days ago');
});

test('invalid or future dates do not produce broken or negative relative labels', () => {
  const now = new Date(2026, 9, 1);
  assert.equal(decisionDate('invalid', now), '');
  assert.doesNotMatch(decisionDate(new Date(2026, 9, 2).toISOString(), now), /ago|Today|Yesterday/);
});

test('the sheet describes only the user decision and preserves hyphenated names', () => {
  assert.equal(decisionTitle('Alexandria-Rose With A Long Name', { kind: 'matched' }),
    'You and Alexandria-Rose are matched');
  assert.equal(decisionTitle('Ishita Roy', { kind: 'liked' }), 'You liked Ishita');
  assert.equal(decisionTitle('Neha Kapoor', { kind: 'rose' }), 'You sent Neha a Rose');
  assert.equal(decisionTitle('Kabir Malhotra', { kind: 'passed' }), 'You passed on Kabir');
  assert.match(DECISION_APPEARANCE.liked.detail, /If you both like/);
  assert.match(DECISION_APPEARANCE.passed.detail, /immediately after/);
});
