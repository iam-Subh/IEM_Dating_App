const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const moduleBox = { exports: {} };
const source = fs.readFileSync(path.join(__dirname, '../src/services/chat-notification-preview.ts'), 'utf8');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: moduleBox, exports: moduleBox.exports, Intl });
const { notificationReplySnippet: snippet, truncateNotificationText: cut } = moduleBox.exports;

test('voice replies show a message label and duration instead of raw numeric content', () => {
  assert.equal(snippet({ type: 'voice', content: '5.64', metadata: { durationSeconds: 5.64 } }), 'Voice message (0:05)');
  assert.equal(snippet({ type: 'voice', content: '5.64' }), 'Voice message (0:05)');
  assert.equal(snippet({ type: 'voice' }), 'Voice message');
  assert.equal(snippet({ type: 'voice', metadata: { durationSeconds: NaN } }), 'Voice message');
});
test('media reply context identifies attachments and filenames', () => {
  assert.equal(snippet({ type: 'document', metadata: { document: { fileName: 'Notes.pdf' } } }), 'Notes.pdf');
  assert.equal(snippet({ type: 'media', mediaKeys: ['a.gif'] }), 'GIF');
  assert.equal(snippet({ type: 'media', mediaKeys: ['a.jpg', 'b.mp4'] }), '2 attachments');
  assert.equal(snippet({ type: 'text', content: 'Hi\nthere 😊' }), 'Hi there 😊');
});
test('notification truncation preserves combined emoji sequences', () => {
  assert.equal(cut('Hello 👨‍👩‍👧‍👦 family', 10), 'Hello …');
  assert.equal(cut('👍🏽👍🏽👍🏽', 9), '👍🏽👍🏽…');
});
