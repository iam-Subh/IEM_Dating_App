const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { buildSync } = require('esbuild');
const source = buildSync({ entryPoints: [path.join(__dirname, '../src/features/chat/messageMarks.ts')], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text;
const moduleBox = { exports: {} };
vm.runInNewContext(source, { module: moduleBox, exports: moduleBox.exports });
const { visibleMarkedMessages, filterMarkedMessages, markedMessagePreview } = moduleBox.exports;
const base = { id: 'a', matchId: 'm', senderId: 'me', content: 'Meet at the library 👋', sentAt: '2026-10-23T10:00:00Z', readAt: null, type: 'text', markedAt: '2026-10-23T11:00:00Z' };

test('expired saved messages disappear at their expiry time', () => {
  const expiresAt = '2026-10-23T12:00:00Z';
  assert.equal(visibleMarkedMessages([base, { ...base, id: 'b', expiresAt }], Date.parse(expiresAt)).length, 1);
});
test('saved message search matches text, sender and document names', () => {
  const document = { ...base, id: 'd', senderId: 'peer', content: '', type: 'document', metadata: { document: { fileName: 'Campus schedule.pdf' } } };
  assert.equal(filterMarkedMessages([base, document], 'LIBRARY', 'me', 'Riya')[0].id, 'a');
  assert.equal(filterMarkedMessages([base, document], 'riya', 'me', 'Riya')[0].id, 'd');
  assert.equal(filterMarkedMessages([base, document], 'schedule.pdf', 'me', 'Riya')[0].id, 'd');
  assert.equal(filterMarkedMessages([base, document], 'missing', 'me', 'Riya').length, 0);
});
test('saved voice and media previews show their type instead of raw storage content', () => {
  const voice = markedMessagePreview({ ...base, type: 'voice', content: '5.64', metadata: { durationSeconds: 5.64 } });
  assert.equal(voice.icon, 'mic');
  assert.match(voice.text, /0:05/);
  assert.equal(markedMessagePreview({ ...base, type: 'media', content: '', mediaKeys: ['one.mp4', 'two.jpeg'] }).text, '2 attachments');
});
