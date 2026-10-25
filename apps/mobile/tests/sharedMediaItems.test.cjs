const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/chat/sharedMediaItems.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exported });
const { fileNameOf, firstUrl, formatVoiceDuration, hostOf, itemsFor } = exported;

const page = (messages) => [{ messages }];

test('every photo of an album gets its own grid cell', () => {
  const items = itemsFor('media', page([
    { id: 'album', content: '', sentAt: '2026-01-01T00:00:00Z', mediaKeys: ['a.jpg', 'b.jpg', 'c.jpg'] },
    { id: 'single', content: '', sentAt: '2026-01-01T00:00:00Z', mediaKey: 'd.jpg' },
  ]));
  assert.deepEqual(Array.from(items, (item) => item.mediaKey), ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']);
  assert.deepEqual(Array.from(items, (item) => item.id), ['album:0', 'album:1', 'album:2', 'single:0']);
});

test('a voice note is not a photo and not a link', () => {
  const voice = { id: 'v', type: 'voice', content: '4.5', sentAt: '2026-01-01T00:00:00Z', mediaKeys: ['chat/voice-1.m4a'] };
  assert.equal(itemsFor('media', page([voice])).length, 0);
  assert.equal(itemsFor('link', page([voice])).length, 0);
  // Even mislabelled: what the server stored as text, with an audio attachment.
  const mislabelled = { id: 'v2', type: 'text', content: 'https://cdn.example.com/voice-2.m4a', sentAt: '2026-01-01T00:00:00Z', mediaKeys: ['audio/v2.m4a'] };
  assert.equal(itemsFor('link', page([mislabelled])).length, 0);
});

test('links keep the URL the person wrote', () => {
  const items = itemsFor('link', page([
    { id: 'l1', type: 'text', content: 'read this https://example.com/a?b=1 now', sentAt: '2026-01-01T00:00:00Z' },
    { id: 'l2', type: 'text', content: 'no link here', sentAt: '2026-01-01T00:00:00Z' },
    { id: 'l3', type: 'text', content: 'www.example.org', sentAt: '2026-01-01T00:00:00Z' },
  ]));
  assert.deepEqual(Array.from(items, (item) => item.url), ['https://example.com/a?b=1', 'https://www.example.org']);
  assert.equal(hostOf('https://example.com/a?b=1'), 'example.com');
});

test('a trailing sentence mark is not part of the link', () => {
  assert.equal(firstUrl('see https://example.com/page.'), 'https://example.com/page');
});

test('a file with no metadata is named after its key, not "Document"', () => {
  assert.equal(fileNameOf({ id: 'f', content: '', sentAt: '', metadata: { document: { fileName: 'Notes.pdf' } } }), 'Notes.pdf');
  assert.equal(fileNameOf({ id: 'f', content: '', sentAt: '', mediaKeys: ['chat/docs/Lab%20report.pdf'] }), 'Lab report.pdf');
});

test('pages merge without repeating a message', () => {
  const message = { id: 'same', content: '', sentAt: '2026-01-01T00:00:00Z', mediaKey: 'x.jpg' };
  const items = itemsFor('media', [{ messages: [message] }, { messages: [message] }]);
  assert.equal(items.length, 1);
});

test('voice length reads as minutes and seconds', () => {
  assert.equal(formatVoiceDuration('75.4'), '1:15');
  assert.equal(formatVoiceDuration(''), null);
});
