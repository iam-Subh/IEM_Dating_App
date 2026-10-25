const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const {StackRouter, StackActions} = require('@react-navigation/routers');
const exported = {};
const source = fs.readFileSync(path.join(__dirname, '../src/features/auth/onboarding/onboardingNavigation.ts'), 'utf8');
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText, {exports: exported, require: name => {
  if (name === '@react-navigation/native') return {StackActions};
  throw new Error(name);
}});

function openReview(routeNames, routes) {
  const router = StackRouter({initialRouteName: routes[0].name});
  const options = {routeNames, routeParamList: {}, routeGetIdList: {}};
  const initial = router.getRehydratedState({stale: true, routes, index: routes.length - 1}, options);
  let result;
  exported.openOnboardingReview({getState: () => initial, dispatch(action) {
    assert.equal(action.target, initial.key);
    result = router.getStateForAction(initial, action, options);
    assert.ok(result, 'The registered navigator must handle the action');
  }});
  return {initial, result};
}

test('a root-level face check opens the review inside Auth', () => {
  const {result} = openReview(['Auth', 'PhotoUpload', 'RealPersonCheck'], [
    {name: 'Auth'}, {name: 'RealPersonCheck'},
  ]);
  assert.deepEqual(result.routes.map(route => route.name), ['Auth']);
  assert.equal(result.routes[0].params.screen, 'OnboardingReview');
});

test('a root-level face check without an existing Auth route creates one', () => {
  const {result} = openReview(['Auth', 'PhotoUpload', 'RealPersonCheck'], [{name: 'RealPersonCheck'}]);
  assert.equal(result.routes[0].name, 'Auth');
  assert.equal(result.routes[0].params.screen, 'OnboardingReview');
});

test('an onboarding face check opens the registered review screen directly', () => {
  const {result} = openReview(['PhotoUpload', 'RealPersonCheck', 'OnboardingReview'], [
    {name: 'PhotoUpload'}, {name: 'RealPersonCheck'},
  ]);
  assert.deepEqual(result.routes.map(route => route.name), ['PhotoUpload', 'OnboardingReview']);
});

test('returning from a face check reuses the existing review instead of adding a duplicate', () => {
  const {initial, result} = openReview(['PhotoUpload', 'RealPersonCheck', 'OnboardingReview'], [
    {name: 'PhotoUpload'}, {name: 'OnboardingReview'}, {name: 'RealPersonCheck'},
  ]);
  assert.deepEqual(result.routes.map(route => route.name), ['PhotoUpload', 'OnboardingReview']);
  assert.equal(result.routes[1].key, initial.routes[1].key);
});
