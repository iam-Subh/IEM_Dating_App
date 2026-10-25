const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/chat/messageEditing.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exported });
const { canEditMessage, canSaveMessageEdit, MESSAGE_EDIT_WINDOW_MS } = exported;
const now = Date.parse('2026-10-23T12:00:00Z');
const message = { senderId: 'me', content: 'See you 👋', type: 'text', sentAt: new Date(now - 60_000).toISOString() };

test('only the sender can edit a sent message within the edit window', () => {
  assert.equal(canEditMessage(message, 'me', now), true);
  assert.equal(canEditMessage(message, 'peer', now), false);
  assert.equal(canEditMessage(message, undefined, now), false);
  assert.equal(canEditMessage({ ...message, sentAt: new Date(now - MESSAGE_EDIT_WINDOW_MS).toISOString() }, 'me', now), true);
  assert.equal(canEditMessage({ ...message, sentAt: new Date(now - MESSAGE_EDIT_WINDOW_MS - 1).toISOString() }, 'me', now), false);
});

test('voice, service, deleted, pending and invalid messages cannot enter edit mode', () => {
  for (const extra of [{ type: 'voice' }, { type: 'service' }, { isDeleted: true }, { localStatus: 'sending' }, { localStatus: 'failed' }, { sentAt: 'invalid' }, { content: '  ' }]) {
    assert.equal(canEditMessage({ ...message, ...extra }, 'me', now), false);
  }
  assert.equal(canEditMessage({ ...message, type: 'media' }, 'me', now), true); // Caption editing.
});

test('save rejects unchanged, blank and oversized edits but accepts multiline text and emoji', () => {
  assert.equal(canSaveMessageEdit(message.content, ` ${message.content} `), false);
  assert.equal(canSaveMessageEdit(message.content, '\n '), false);
  assert.equal(canSaveMessageEdit(message.content, 'a'.repeat(2001)), false);
  assert.equal(canSaveMessageEdit(message.content, 'a'.repeat(2000)), true);
  assert.equal(canSaveMessageEdit(message.content, 'See you tomorrow\n👨‍👩‍👧‍👦'), true);
});
