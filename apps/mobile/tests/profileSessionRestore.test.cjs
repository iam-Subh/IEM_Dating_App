const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const moduleState = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/store/authSlice.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { module: moduleState, exports: moduleState.exports, require });
const { default: reducer, setCredentials, updateUser, logout } = moduleState.exports;
const profile = { id: 'account-a', name: 'Subh', isVerified: true, age: 20,
  department: 'CSE', graduationYear: 2027, preferencesConfirmedAt: '2026-09-01',
  photos: [{ id: 'photo-a', photoUrl: 'https://example.com/photo.jpg', isPrimary: true }] };

function persistedProfile() {
  let state = reducer(undefined, setCredentials({ user: profile, token: 'old-token', nextRequiredStep: null }));
  // The token is not persisted. Restore the profile as after a process restart.
  return JSON.parse(JSON.stringify({ ...state, token: null }));
}
const refresh = (user, nextRequiredStep = null) => setCredentials({ user, token: 'new-token',
  nextRequiredStep, restoreCachedProfile: true });

test('a cold start preserves the saved membership badge and profile media for the same account', () => {
  const state = reducer(persistedProfile(), refresh({ id: 'account-a', name: 'Subh', isVerified: false }));
  assert.equal(state.user.isVerified, true);
  assert.equal(state.user.age, 20);
  assert.equal(state.user.photos[0].id, 'photo-a');
  assert.equal(state.token, 'new-token');
  assert.equal(state.isAuthenticated, true);
});

test('the authoritative Profile response can remove the saved badge', () => {
  const restored = reducer(persistedProfile(), refresh({ id: 'account-a', isVerified: false }));
  const updated = reducer(restored, updateUser({ id: 'account-a', isVerified: false }));
  assert.equal(updated.user.isVerified, false);
  assert.equal(reducer(updated, refresh({ id: 'account-a', isVerified: false })).user.isVerified, false);
});

test('another account does not receive saved verification or photos', () => {
  const state = reducer(persistedProfile(), refresh({ id: 'account-b', isVerified: false }));
  assert.equal(state.user.id, 'account-b');
  assert.equal(state.user.isVerified, false);
  assert.equal(state.user.photos, undefined);
});

test('a normal sign-in replaces the user, and a new session has no saved badge to infer', () => {
  const state = reducer(persistedProfile(), setCredentials({ user: { id: 'account-a', isVerified: false }, token: 'login-token', nextRequiredStep: null }));
  assert.equal(state.user.isVerified, false);
  assert.equal(state.user.photos, undefined);
  const signedOut = reducer(persistedProfile(), logout());
  assert.equal(reducer(signedOut, refresh({ id: 'account-a', isVerified: false })).user.isVerified, false);
});

test('saved verification does not bypass the current required onboarding step', () => {
  const state = reducer(persistedProfile(), refresh({ id: 'account-a', isVerified: false }, 'studentVerification'));
  assert.equal(state.nextRequiredStep, 'studentVerification');
  assert.equal(state.isAuthenticated, false);
});
