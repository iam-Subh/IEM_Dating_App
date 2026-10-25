const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, dependencies = {}) {
  const exported = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { exports: exported, require: name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  return exported;
}

const { profileIntentionDesign } = load('components/profileIntentionDesign.ts');
const { DATING_INTENTIONS } = load('core/profile/profileOptions.ts');
const { demoProfiles } = load('features/discovery/demo/demoProfiles.ts', {
  '../../../store': { store: { getState: () => ({ auth: { user: null } }) } },
  '../../location/distanceUnits': { distanceBand: () => '', unitOf: () => 'km' },
});

test('every selectable dating intention has a different design', () => {
  const designs = DATING_INTENTIONS.map(option => profileIntentionDesign(option.id));
  assert.ok(designs.every(design => design.id !== 'unknown'));
  assert.equal(new Set(designs.map(design => design.id)).size, DATING_INTENTIONS.length);
});

test('stored answers tolerate case and spacing, including the older relationship label', () => {
  const expected = profileIntentionDesign('Long-term partner');
  assert.strictEqual(profileIntentionDesign('  LONG-TERM   partner  '), expected);
  assert.strictEqual(profileIntentionDesign('A long-term relationship'), expected);
  assert.equal(profileIntentionDesign('long-term, but short-term ok').id, 'long-flexible');
});

test('unrecognized labels use a neutral design rather than another dating intention', () => {
  for (const value of ['', 'Something meaningful', 'Open to dating', 'constructor', '__proto__']) {
    assert.equal(profileIntentionDesign(value).id, 'unknown');
  }
});

test('demo cards include exactly one profile for each current intention', () => {
  assert.equal(demoProfiles.length, DATING_INTENTIONS.length);
  for (const option of DATING_INTENTIONS) {
    const profiles = demoProfiles.filter(profile => profile.seeking === option.id);
    assert.equal(profiles.length, 1, `Missing or repeated demo option: ${option.id}`);
    assert.notEqual(profileIntentionDesign(profiles[0].seeking).id, 'unknown');
  }
});
