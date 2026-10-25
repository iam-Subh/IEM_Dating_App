const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(native) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/chat/mediaSendNotice.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, Date, require: (name) => name === 'react-native' ? { Platform: { OS: 'android' } } : { ChatMedia: native } });
  return exports;
}

test('the notification says what is being sent', () => {
  const { mediaLabel } = load(null);
  assert.equal(mediaLabel(['photo']), 'photo');
  assert.equal(mediaLabel(['photo', 'photo', 'photo']), '3 photos');
  assert.equal(mediaLabel(['video']), 'video');
  assert.equal(mediaLabel(['photo', 'video']), '2 items');
});

test('one bar per message, then one outcome: sent, or could not send', () => {
  const calls = [];
  const native = {
    showTransferProgress: (...args) => calls.push(['progress', ...args]),
    finishTransfer: (...args) => calls.push(['finish', ...args]),
    cancelTransfer: (...args) => calls.push(['cancel', ...args]),
  };
  const { createMediaSendNotice } = load(native);
  const notice = createMediaSendNotice('temp-1', ['photo', 'photo']);
  notice.start();
  assert.deepEqual(calls.at(-1), ['progress', 'temp-1', 'Sending 2 photos', 0]);
  notice.done();
  notice.failed();
  assert.deepEqual(calls.at(-1), ['finish', 'temp-1', '2 photos sent', null, true], 'only the first outcome counts');
  // A large file has the uploader's own bar: only the outcome comes from here.
  calls.length = 0;
  const large = createMediaSendNotice('temp-2', ['video'], true);
  large.start();
  large.update(0, 50);
  assert.equal(calls.length, 0);
  large.failed();
  assert.deepEqual(calls.at(-1), ['finish', 'temp-2', "Couldn't send video", 'Open the chat to try again.', false]);
});
