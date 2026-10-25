const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/core/profile/clubSelection.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exportsObject });
const { toggleClubSelection, MAX_SELECTED_CLUBS } = exportsObject;

test('selecting a sixth club leaves the five selected clubs unchanged', () => {
  const selected = Object.freeze(['Robotics', 'Tech/Coding', 'Music/Band', 'Dance', 'Drama']);
  assert.equal(selected.length, MAX_SELECTED_CLUBS);
  assert.strictEqual(toggleClubSelection(selected, 'Sports'), selected);
});

test('a user can remove a club at the limit and select a replacement', () => {
  const selected = Object.freeze(['Robotics', 'Tech/Coding', 'Music/Band', 'Dance', 'Drama']);
  const removed = toggleClubSelection(selected, 'Dance');
  const replaced = toggleClubSelection(removed, 'Photography');
  assert.equal(replaced.length, MAX_SELECTED_CLUBS);
  assert.equal(replaced.includes('Dance'), false);
  assert.equal(replaced.includes('Photography'), true);
  assert.equal(selected.includes('Dance'), true);
});

test('sequential updates keep distinct choices and toggle repeated choices off', () => {
  const empty = Object.freeze([]);
  let selected = empty;
  for (const club of ['Robotics', 'Tech/Coding', 'Debate', 'Robotics']) {
    selected = toggleClubSelection(selected, club);
  }
  assert.equal(JSON.stringify(selected), JSON.stringify(['Tech/Coding', 'Debate']));
  assert.equal(empty.length, 0);
});
