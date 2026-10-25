const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
function load(name, development) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/development', name), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText, {exports, __DEV__: development});
  return exports;
}
test('preview requires development and cannot activate in a production build', () => {
  for (const dev of [true, false]) {
    const runtime = load('onboardingPreviewRuntime.ts', dev);
    assert.equal(runtime.isOnboardingPreview(), false);
    runtime.setOnboardingPreview(true);
    assert.equal(runtime.isOnboardingPreview(), dev);
    runtime.setOnboardingPreview(false);
    assert.equal(runtime.isOnboardingPreview(), false);
  }
});
test('preview reads sample data and blocks account, verification, and upload writes', () => {
  const runtime = load('onboardingPreviewRuntime.ts', true);
  assert.equal(runtime.onboardingPreviewResponse('/profile', 'get').id, 'design-preview');
  assert.equal(runtime.onboardingPreviewResponse('/verification/institutions', 'get').length, 2);
  for (const [url, method] of [['/auth/send-otp', 'post'], ['/auth/login', 'post'], ['/verification/face/submit', 'post'], ['/profile', 'put'], ['/verification/face', 'delete']]) {
    assert.throws(() => runtime.onboardingPreviewResponse(url, method), /tap Next/);
  }
});
test('every tour page has a registered route and includes all correction and result states', () => {
  const {onboardingPreviewPages: pages} = load('onboardingPreviewPages.ts', true);
  const navigator = fs.readFileSync(path.join(__dirname, '../src/navigation/AuthNavigator.tsx'), 'utf8');
  const registered = new Set([...navigator.matchAll(/name="([^"]+)"/g)].map(match => match[1]));
  ['VerifyCollege', 'VerifyRules', 'PreviewCameraAccess'].forEach(name => registered.add(name));
  for (const page of pages) assert.ok(registered.has(page.route), page.route);
  assert.equal(pages[0].route, 'Welcome');
  for (const phase of ['needs_fix', 'verified', 'pending_review', 'failed', 'ready', 'sending']) assert.ok(pages.some(page => page.params?.phase === phase), phase);
  assert.ok(pages.some(page => page.route === 'PasswordRecovery' && page.params?.previewReset));
  assert.equal(pages.length, 38);
  assert.equal(pages.some(page => ['StudentVerification', 'VerifyCollege', 'VerifyRules'].includes(page.route)), false);
});
