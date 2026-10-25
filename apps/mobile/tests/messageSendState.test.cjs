const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const moduleBox = { exports: {} };
const source = fs.readFileSync(path.join(__dirname, '../src/features/chat/messageSendState.ts'), 'utf8');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: moduleBox.exports });
const { messageSendFailure, mediaRetryIndexes, mediaTicketsExpired } = moduleBox.exports;

test('every supported outgoing content format has a failure action', () => {
  for (const [type, content] of [['text', 'Hi'], ['text', '❤️😂'], ['text', '**Hello**'], ['text', 'https://example.com'], ['media', ''], ['media', 'Caption'], ['document', ''], ['voice', '12'], ['story_reply', '❤️']]) {
    const failed = messageSendFailure({ senderId: 'me', type, content, localStatus: 'failed', localError: 'Offline' }, 'me');
    assert.equal(failed.label, 'Not sent');
    assert.equal(failed.detail, 'Offline');
  }
});

test('received messages, service messages and successful sends have no send retry', () => {
  assert.equal(messageSendFailure({ senderId: 'them', type: 'media', localStatus: 'failed' }, 'me'), null);
  assert.equal(messageSendFailure({ senderId: 'me', type: 'service', localStatus: 'failed' }, 'me'), null);
  for (const localStatus of [undefined, 'sending', 'queued']) assert.equal(messageSendFailure({ senderId: 'me', localStatus }, 'me'), null);
  assert.equal(messageSendFailure({ senderId: 'me', localStatus: 'queued', localError: 'Server unavailable' }, 'me').label, 'Waiting to send');
});

test('album retries preserve successful uploads and expose every failed item', () => {
  const keys = ['uploaded-photo', null, 'uploaded-video', null, null, null];
  assert.deepEqual(Array.from(mediaRetryIndexes(keys)), [1, 3, 4, 5]);
  assert.deepEqual(Array.from(mediaRetryIndexes(keys, 4)), [4]);
  assert.deepEqual(Array.from(mediaRetryIndexes(keys, 0)), []);
  assert.deepEqual(Array.from(mediaRetryIndexes(['photo', 'video', 'document', 'voice'])), []);
  for (const invalid of [-1, 12, 0.5]) assert.deepEqual(Array.from(mediaRetryIndexes(keys, invalid)), []);
  assert.equal(keys[0], 'uploaded-photo');
});

test('lost acknowledgements keep upload tickets; explicit expiry permits new uploads', () => {
  assert.equal(mediaTicketsExpired(new Error('Request timed out')), false);
  assert.equal(mediaTicketsExpired({ response: { status: 503 } }), false);
  assert.equal(mediaTicketsExpired({ response: { data: { code: 'IDEMPOTENCY_MISMATCH' } } }), false);
  assert.equal(mediaTicketsExpired({ response: { data: { error: { code: 'INVALID_MEDIA_TICKET' } } } }), true);
});
