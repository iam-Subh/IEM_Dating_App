const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exported = {};
const source = fs.readFileSync(path.join(__dirname, '../src/features/verification/faceCheckFailureContent.ts'), 'utf8');
vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText, {exports: exported});
const content = exported.faceCheckFailureContent;

test('an incomplete upload gives connection guidance without blaming a face movement', () => {
  for (const reason of ['upload', 'no_snapshots']) {
    const result = content({reason});
    assert.match(result.explanation, /did not finish uploading/);
    assert.ok(result.tips.some(tip => tip.icon === 'wifi-outline'));
    assert.ok(result.tips.every(tip => !tip.text.includes('light')));
  }
});

test('a service outage gives waiting guidance instead of diagnosing the connection', () => {
  const result = content({reason: 'submit', errorCode: 'FACE_SERVICE_UNAVAILABLE'});
  assert.match(result.explanation, /temporarily unavailable/);
  assert.ok(result.tips.some(tip => tip.icon === 'time-outline'));
  assert.ok(result.tips.every(tip => tip.icon !== 'wifi-outline'));
});

test('local and server movement failures name the reported movement', () => {
  assert.match(content({reason: 'liveness', failedStep: 'blink'}).explanation, /eyes were closed/);
  assert.match(content({reason: 'liveness:smile'}).explanation, /smile/);
  assert.match(content({reason: 'liveness:same_side'}).explanation, /opposite directions/);
  assert.match(content({reason: 'liveness:blink,left'}).explanation, /one or more/);
});

test('face detection failures describe what could not be detected', () => {
  assert.match(content({reason: 'no_face'}).explanation, /one clear face/);
  assert.match(content({reason: 'not_one_person'}).explanation, /same face throughout/);
});

test('camera errors offer camera settings; upload errors do not', () => {
  assert.equal(content({reason: 'camera'}).settings, true);
  assert.equal(content({reason: 'capture'}).settings, true);
  assert.equal(content({reason: 'upload'}).settings, false);
});

test('expired checks and exhausted attempts show the correct next action', () => {
  assert.match(content({reason: 'submit', errorCode: 'FACE_CHALLENGE_EXPIRED'}).explanation, /expired/);
  assert.match(content({reason: 'connection', errorCode: 'FACE_ATTEMPTS_LIMIT'}).title, /tomorrow/);
});

test('an unknown failure does not invent a cause', () => {
  assert.match(content({reason: null}).explanation, /exact cause is unavailable/);
  assert.match(content({reason: 'error', message: "Your selfie didn't send."}).explanation, /specific failure reason was not reported/);
});
