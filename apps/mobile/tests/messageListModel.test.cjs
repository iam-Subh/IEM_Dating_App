const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/chat/messageListModel.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exported });
const { buildChatRows, chatScrollDistances, visibleMessageIds, unreadThroughSeen } = exported;
const message = (id, day = 20, extra = {}) => ({ id, content: id, sentAt: `2026-09-${day}T12:00:00Z`, ...extra });
const keys = rows => Array.from(rows, row => row._kind ? `date:${new Date(row.date).getUTCDate()}` : row.id);

test('date labels sit above the correct day in inverted order', () => {
  assert.deepEqual(keys(buildChatRows([message('new'), message('same'), message('old', 19)])),
    ['new', 'same', 'date:20', 'old', 'date:19']);
});
test('older pages leave existing message indices unchanged', () => {
  const initial = [message('a'), message('b')];
  const before = buildChatRows(initial);
  const after = buildChatRows([...initial, message('c'), message('d', 19)]);
  for (const id of ['a', 'b']) {
    assert.equal(after.findIndex(row => row.id === id), before.findIndex(row => row.id === id));
  }
  assert.deepEqual(keys(after), ['a', 'b', 'c', 'date:20', 'd', 'date:19']);
});
test('empty messages do not leave measured holes or orphan date labels', () => {
  const rows = buildChatRows([message('empty', 20, { content: '' }), message('photo', 19, { content: '', mediaKey: 'photo.jpg' }), message('service', 18, { content: '', type: 'service' })]);
  assert.deepEqual(keys(rows), ['photo', 'date:19', 'service', 'date:18']);
  assert.equal(buildChatRows([]).length, 0);
});
test('pagination and newest-button distances follow inverted scroll coordinates', () => {
  // Offset zero is the newest message; the offset grows going back in history.
  assert.equal(chatScrollDistances(0, 4000, 800).fromBottom, 0);
  assert.equal(chatScrollDistances(0, 4000, 800).fromTop, 3200);
  assert.equal(chatScrollDistances(3100, 4000, 800).fromTop, 100);
  assert.equal(chatScrollDistances(3300, 4000, 800).fromTop, 0);
  // Overscrolling past the newest message is still the newest message.
  assert.equal(chatScrollDistances(-20, 200, 800).fromBottom, 0);
});

test('read receipts get the ids of the visible messages, not of their rows', () => {
  const rows = [
    { item: { kind: 'message', key: 'row-a', message: { id: 'a' } } },
    { item: { kind: 'date', key: 'date-1', date: '2026-10-22' } },
    { item: { kind: 'service', key: 'row-s', message: { id: 's' } } },
    { item: { kind: 'message', key: 'row-b', message: { id: 'b' } } },
  ];
  assert.deepEqual([...visibleMessageIds(rows)], ['a', 'b']);
});

test('seeing a message reads it and every earlier unread one of theirs, like Telegram', () => {
  const at = (seq, extra = {}) => ({ id: `m${seq}`, senderId: 'peer', messageSeq: seq, sentAt: `2026-10-22T10:0${seq}:00Z`, readAt: null, ...extra });
  const messages = [at(1), at(2, { readAt: '2026-10-22T10:30:00Z' }), at(3, { senderId: 'me' }), at(4), at(5, { type: 'service' }), at(6), at(7)];
  // The first message (under the header) and the tall video at 4 were never counted as seen.
  assert.deepEqual([...unreadThroughSeen(messages, ['m6'], 'me')], ['m1', 'm4', 'm6']);
  // Newer than anything seen stays unread.
  assert.equal(unreadThroughSeen(messages, ['m6'], 'me').includes('m7'), false);
  // Seeing only your own messages reads nothing of theirs.
  assert.deepEqual([...unreadThroughSeen(messages, ['m3'], 'me')], []);
});
