const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const exportsForTest = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
  '../src/screens/main/profile/profileEditNavigation.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exportsForTest });
const { profileEditorParams } = exportsForTest;
const profile = {
  id: 'saved-account', photos: [{ id: 'one', photoUrl: 'https://example.com/photo.jpg' }],
  preferences: { bio: 'My saved bio', interests: ['poetry', 'coding'] },
  clubs: ['Photography'], seeking: 'Long-term partner', degree: 'M.Tech', gender: 'Man', showGender: false,
  yearOfStudy: 3, graduationYear: 2027,
  orientation: ['Straight'], showOrientation: false,
};

test('section edits retain the account and target the requested section', () => {
  for (const section of ['photos', 'video', 'about', 'visibility', 'campus']) {
    const params = profileEditorParams('EditProfile', profile, section);
    assert.equal(params.profile, profile);
    assert.equal(params.section, section);
  }
  assert.equal(profileEditorParams('EditProfile', profile).section, undefined);
});

test('bio, interests, and dating intention editors receive saved answers', () => {
  assert.equal(profileEditorParams('EditBio', profile).currentBio, profile.preferences.bio);
  assert.equal(profileEditorParams('EditInterests', profile).currentInterests, profile.preferences.interests);
  assert.equal(profileEditorParams('EditSeeking', profile).currentSeeking, profile.seeking);
  assert.equal(profileEditorParams('EditDegree', profile).currentDegree, profile.degree);
  const studies = profileEditorParams('EditStudies', profile);
  assert.equal(studies.currentDegree, profile.degree);
  assert.equal(studies.currentYearOfStudy, 3);
  assert.equal(studies.currentGraduationYear, 2027);
});

test('identity editors retain answers and hidden visibility settings', () => {
  const gender = profileEditorParams('EditGender', profile);
  assert.equal(gender.currentGender, 'Man');
  assert.equal(gender.currentShowGender, false);
  const orientation = profileEditorParams('EditOrientation', profile);
  assert.equal(orientation.currentOrientation, profile.orientation);
  assert.equal(orientation.currentShowOrientation, false);
});

test('missing answers open empty editors without changing the saved profile', () => {
  const empty = {};
  assert.equal(profileEditorParams('EditBio', empty).currentBio, '');
  assert.equal(profileEditorParams('EditInterests', empty).currentInterests.length, 0);
  assert.equal(profileEditorParams('EditOrientation', empty).currentOrientation.length, 0);
  assert.equal(profileEditorParams('EditDegree', empty).currentDegree, undefined);
  assert.deepEqual(empty, {});
});
