const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, relative), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { module, exports: module.exports, require, Date });
  return module.exports;
}
const { default: reducer, setCredentials, setNextRequiredStep, saveOnboardingDraft, completeOnboarding, logout, updateUser } = load('../src/store/authSlice.ts');
const values = load('../src/features/auth/onboarding/profileValues.ts');
const flow = load('../src/features/auth/onboarding/onboardingFlow.ts');
const recording = load('../src/features/auth/onboarding/profileVideoRecording.ts');
const user = { id: 'a', department: 'CSE', graduationYear: 2027, preferencesConfirmedAt: '2026-10-05' };

test('make main photo preserves the remaining photo order and crop source positions', () => {
  const photos = ['first', 'second', 'third', null, null, null];
  assert.deepEqual(Array.from(values.makeMainPhoto(photos, 2)), ['third', 'first', 'second', null, null, null]);
  const originals = ['first-original', null, 'third-original', null, null, null];
  assert.deepEqual(Array.from(values.makeMainPhoto(originals, 1)), [null, 'first-original', 'third-original', null, null, null]);
  assert.deepEqual(photos, ['first', 'second', 'third', null, null, null]);
  assert.equal(values.makeMainPhoto(photos, -1), photos);
  assert.equal(values.makeMainPhoto(photos, 6), photos);
  assert.equal(values.makeMainPhoto(photos, 1.5), photos);
});

test('optional profile steps stay in the main sequence before matching and verification', () => {
  const routes = ['SeekingSelection', 'OrientationSelection', 'Interests', 'ShareMore',
    'LifestyleHabits', 'PersonalityTraits', 'SocialSelection', 'MatchingPreferences',
    'PhotoUpload', 'RealPersonCheck', 'OnboardingReview'];
  for (let i = 0; i < routes.length - 1; i++) {
    assert.equal(flow.nextProfileStep(routes[i]), routes[i + 1]);
    assert.equal(flow.previousProfileStep(routes[i + 1]), routes[i]);
  }
  assert.equal(flow.nextProfileStep('OnboardingReview'), undefined);
  assert.equal(flow.previousProfileStep('HouseRules'), undefined);
  assert.equal(flow.nextProfileStep('Unknown'), undefined);
});

test('a saved draft survives session renewal and keeps the account out of discovery', () => {
  let state = reducer(undefined, setCredentials({ user, token: 'a', nextRequiredStep: 'profile' }));
  state = reducer(state, saveOnboardingDraft({ step: 'PhotoUpload', fields: { name: 'Student', degree: 'B.Tech' } }));
  state = reducer(state, setCredentials({ user, token: 'renewed', nextRequiredStep: null, restoreCachedProfile: true }));
  assert.equal(state.isAuthenticated, false);
  assert.equal(state.onboardingDraft.step, 'PhotoUpload');
  assert.equal(state.onboardingDraft.fields.name, 'Student');
  state = reducer(state, setNextRequiredStep(null));
  assert.equal(state.isAuthenticated, false);
  assert.equal(state.onboardingDraft.step, 'PhotoUpload');
});
test('draft fields exclude credentials and private face captures', () => {
  const state = reducer(undefined, saveOnboardingDraft({ fields: { name: 'Student', password: 'secret', token: 'secret', code: '123456', faceFrames: ['private'], uploadTickets: ['private'] } }));
  assert.deepEqual(Object.keys(state.onboardingDraft.fields), ['name']);
});
test('residency and college life survive draft restoration, including day scholar false', () => {
  const state = reducer(undefined, saveOnboardingDraft({fields: {
    isHosteller: false, attendanceMood: 'Regular', hangoutSpots: ['Library'],
  }}));
  assert.equal(state.onboardingDraft.fields.isHosteller, false);
  assert.equal(state.onboardingDraft.fields.attendanceMood, 'Regular');
  assert.deepEqual(state.onboardingDraft.fields.hangoutSpots, ['Library']);
});
test('another account and logout clear the previous draft', () => {
  let state = reducer(undefined, setCredentials({ user, token: 'a' }));
  state = reducer(state, saveOnboardingDraft({ step: 'BirthdaySelection', fields: { name: 'A' } }));
  const switched = reducer(state, setCredentials({ user: { ...user, id: 'b' }, token: 'b' }));
  assert.equal(switched.onboardingDraft, null);
  assert.equal(reducer(state, logout()).onboardingDraft, null);
});
test('only final completion clears the draft; unconfirmed preferences retain the required gate', () => {
  let state = reducer(undefined, setCredentials({ user: { ...user, preferencesConfirmedAt: null }, token: 'a' }));
  state = reducer(state, saveOnboardingDraft({ step: 'OnboardingReview' }));
  const incomplete = reducer(state, completeOnboarding());
  assert.equal(incomplete.isAuthenticated, false);
  assert.equal(incomplete.nextRequiredStep, 'discoveryPreferences');
  state = reducer(state, updateUser({ preferencesConfirmedAt: '2026-10-05' }));
  assert.ok(state.onboardingDraft);
  const complete = reducer(state, completeOnboarding());
  assert.equal(complete.isAuthenticated, true);
  assert.equal(complete.onboardingDraft, null);
});
test('birthday validation rejects impossible dates, future dates, and malformed input', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  for (const parts of [['31', '04', '2000'], ['29', '02', '2001'], ['01', '13', '2000'], ['01', '01', '2027'], ['a', '01', '2000']]) assert.equal(values.birthdayFromParts(...parts, now), null);
  assert.equal(values.birthdayFromParts('29', '02', '2000', now).age, 26);
  assert.equal(values.birthdayFromParts('05', '10', '2008', now).age, 18);
  assert.equal(values.birthdayFromParts('06', '10', '2008', now).age, 17);
});
test('media reads support API photo records and legacy URLs; duration limits are inclusive', () => {
  assert.equal(JSON.stringify(values.profilePhotoUrls([{ photoUrl: 'https://example.com/a.jpg' }, 'https://example.com/b.jpg', null, { id: 'broken' }])), JSON.stringify(['https://example.com/a.jpg', 'https://example.com/b.jpg']));
  for (const duration of [null, undefined, NaN, 14999, 60001]) assert.equal(values.validProfileVideoDuration(duration), false);
  for (const duration of [15000, 30000, 60000]) assert.equal(values.validProfileVideoDuration(duration), true);
});

test('recording time follows elapsed clock time after delayed UI ticks', () => {
  assert.equal(recording.recordingSeconds(null, 20000), 0);
  assert.equal(recording.recordingSeconds(1000, 1999), 0);
  assert.equal(recording.recordingSeconds(1000, 16000), 15);
  assert.equal(recording.recordingSeconds(1000, 38250), 37);
  assert.equal(recording.recordingSeconds(1000, 81000), 60);
  assert.equal(recording.recordingSeconds(1000, 999), 0);
  assert.equal(recording.recordingTimeLabel(59), '0:59');
  assert.equal(recording.recordingTimeLabel(60), '1:00');
});
