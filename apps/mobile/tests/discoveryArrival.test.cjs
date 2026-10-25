const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load() {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/discovery/discoveryArrival.ts'), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  }).outputText, {exports});
  return exports;
}
test('the arrival starts only after an explicit request and does not replay after finishing', () => {
  const a = load();
  assert.equal(a.getDiscoveryArrival().active, false);
  a.updateDiscoveryArrival('ready', () => {});
  assert.equal(a.getDiscoveryArrival().active, false);
  a.startDiscoveryArrival();
  assert.equal(a.getDiscoveryArrival().status, 'loading');
  a.updateDiscoveryArrival('ready', () => {});
  assert.equal(a.getDiscoveryArrival().active, true);
  a.finishDiscoveryArrival();
  a.updateDiscoveryArrival('error', () => {});
  assert.equal(a.getDiscoveryArrival().active, false);
});
test('retry runs the real loader and publishes loading before invoking it', () => {
  const a = load();
  let calls = 0;
  a.startDiscoveryArrival();
  a.updateDiscoveryArrival('error', () => {calls++; assert.equal(a.getDiscoveryArrival().status, 'loading');});
  a.retryDiscoveryArrival();
  assert.equal(calls, 1);
  a.finishDiscoveryArrival();
  a.retryDiscoveryArrival();
  assert.equal(calls, 1);
});
test('repeated loading updates keep a stable snapshot and subscriptions stop after removal', () => {
  const a = load();
  let calls = 0;
  const stop = a.subscribeDiscoveryArrival(() => calls++);
  a.startDiscoveryArrival();
  const before = a.getDiscoveryArrival();
  a.updateDiscoveryArrival('loading', () => {});
  assert.equal(a.getDiscoveryArrival(), before);
  assert.equal(calls, 1);
  stop();
  a.finishDiscoveryArrival();
  assert.equal(calls, 1);
});

test('transition replay ignores the live deck status and does not call its retry loader', () => {
  const a = load();
  let calls = 0;
  a.startDiscoveryArrival(true);
  a.updateDiscoveryArrival('error', () => calls++);
  assert.equal(a.getDiscoveryArrival().status, 'ready');
  a.retryDiscoveryArrival();
  assert.equal(calls, 0);
  a.finishDiscoveryArrival();
  a.startDiscoveryArrival();
  assert.equal(a.getDiscoveryArrival().status, 'loading');
});

test('the transition uses only the first three recommendation photos and clears them on finish', () => {
  const a = load();
  const profiles = Array.from({length: 5}, (_, i) => ({id: String(i), name: 'Name ' + i, age: 22, campus: 'Campus', primaryPhoto: 'https://example.test/' + i, privateField: 'not needed'}));
  a.startDiscoveryArrival();
  a.updateDiscoveryArrival('ready', () => {}, profiles);
  assert.equal(a.getDiscoveryArrival().profiles.length, 3);
  assert.equal(a.getDiscoveryArrival().profiles[0].primaryPhoto, profiles[0].primaryPhoto);
  assert.equal(a.getDiscoveryArrival().profiles[0].privateField, undefined);
  const snapshot = a.getDiscoveryArrival();
  a.updateDiscoveryArrival('ready', () => {}, profiles);
  assert.equal(a.getDiscoveryArrival(), snapshot);
  a.finishDiscoveryArrival();
  assert.equal(a.getDiscoveryArrival().profiles, undefined);
});

test('the card reveal accepts a valid layout and rejects invalid measurements', () => {
  const a = load();
  a.startDiscoveryArrival();
  a.setDiscoveryArrivalFrame({x: 10, y: 140, width: 360, height: 420});
  const snapshot = a.getDiscoveryArrival();
  assert.equal(snapshot.frame.width, 360);
  a.setDiscoveryArrivalFrame({x: 10, y: NaN, width: 360, height: 420});
  assert.equal(a.getDiscoveryArrival(), snapshot);
  a.setDiscoveryArrivalFrame({x: 10, y: 140, width: 0, height: 420});
  assert.equal(a.getDiscoveryArrival(), snapshot);
});

test('the preview uses the same first media frame as the Discovery card', () => {
  const a = load();
  a.startDiscoveryArrival();
  const base = {id: '1', name: 'Name', age: 22, campus: 'Campus', primaryPhoto: 'main.jpg'};
  a.updateDiscoveryArrival('ready', () => {}, [{...base, video: 'intro.mp4', videoPoster: 'poster.jpg', photos: ['photo.jpg']}]);
  assert.equal(a.getDiscoveryArrival().profiles[0].photoUri, 'poster.jpg');
  a.updateDiscoveryArrival('ready', () => {}, [{...base, photos: ['photo.jpg']}]);
  assert.equal(a.getDiscoveryArrival().profiles[0].photoUri, 'photo.jpg');
  a.updateDiscoveryArrival('ready', () => {}, [{...base, video: 'intro.mp4'}]);
  assert.equal(a.getDiscoveryArrival().profiles[0].photoUri, 'main.jpg');
});
