const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, modules) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  }).outputText, {exports, require: name => modules[name]});
  return exports;
}
const mobile = load(path.join(__dirname, '../src/store/authSlice.ts'), {
  '@reduxjs/toolkit': require('@reduxjs/toolkit'),
});
const {OnboardingService} = load(path.join(__dirname, '../../api/src/services/onboarding.service.ts'), {
  '../utils/prisma': {prisma: {}},
});
const google = {id: 'google', googleSub: 'google-sub', department: null, graduationYear: null, preferencesConfirmedAt: null};
const profile = {...google, department: 'CSE', graduationYear: 2028, college: 'IEM'};

test('Google onboarding starts with the profile without choosing Verify later', () => {
  assert.equal(OnboardingService.statusFromUser(google).nextRequiredStep, 'profile');
  assert.equal(OnboardingService.statusFromUser(profile).nextRequiredStep, 'discoveryPreferences');
  assert.equal(OnboardingService.statusFromUser({...profile, preferencesConfirmedAt: new Date()}).nextRequiredStep, null);
  assert.equal(OnboardingService.statusFromUser({...profile, college: null}).nextRequiredStep, 'profile');
});

test('mobile ignores the legacy college gate for Google accounts and preserves the next required step', () => {
  for (const [user, expected] of [[google, 'profile'], [profile, 'discoveryPreferences'], [{...profile, preferencesConfirmedAt: '2026-10-07'}, null]]) {
    const state = mobile.default(undefined, mobile.setCredentials({user, token: 'test', nextRequiredStep: 'studentVerification'}));
    assert.equal(state.nextRequiredStep, expected);
    assert.equal(state.isAuthenticated, expected === null);
    assert.equal(mobile.resolveOnboardingStep(user, 'studentVerification'), expected);
  }
});

test('college email accounts still require their verification and expired memberships keep access', () => {
  const emailUser = {...profile, googleSub: null};
  assert.equal(OnboardingService.statusFromUser(emailUser).nextRequiredStep, 'studentVerification');
  assert.equal(mobile.resolveOnboardingStep(emailUser, 'studentVerification'), 'studentVerification');
  assert.equal(OnboardingService.statusFromUser(emailUser, false, true).nextRequiredStep, 'discoveryPreferences');
});
