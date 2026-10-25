const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');

function harness({ reaction = null, cleared = 0 } = {}) {
  let selected;
  const at = new Date('2026-10-22T09:00:00Z');
  const last = { id: 'message', content: 'College fest', senderId: 'me', sentAt: at, readAt: new Date(+at + 2000), photoUrl: null, mediaKeys: ['a.jpeg', 'b.mp4'], type: 'media', metadata: { mediaInfo: [null, { durationMs: 1000 }] }, messageSeq: 2, replyToId: 'old', editedAt: null, expiresAt: null, revision: 1 };
  const peer = { id: 'peer', name: 'Rupsa', avatarUrl: null, showOnlineStatus: false, photos: [] };
  const prisma = {
    match: { findMany: async options => { selected = options.include.messages.select; return [{ id: 'chat', user1Id: 'me', user1: { ...peer, id: 'me' }, user2: peer, messages: [last], chatSessions: [], createdAt: at }]; } },
    chatParticipant: { findMany: async () => [{ matchId: 'chat', clearedThroughSeq: cleared }] },
    user: { findUnique: async () => ({ showOnlineStatus: false }) },
    messageReceipt: { findMany: async () => [{ messageId: 'message', deliveredAt: new Date(+at + 1000), playedAt: null }] },
    $queryRaw: async strings => strings.join('').includes('message_reactions') ? reaction ? [reaction] : [] : [{ match_id: 'chat', n: 3 }],
  };
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../src/services/chat.service.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, console, Intl, require: name => name === '../utils/prisma' ? { prisma } : name === './presence.service' ? { onlineAmong: async () => new Set() } : name === 'crypto' ? require('node:crypto') : {} });
  return { service: module.exports.ChatService, select: () => selected };
}
test('conversation response supplies media, receipt and reply data after refresh', async () => {
  const h = harness();
  const rows = await h.service.getConversations('me');
  const last = rows[0].lastMessage;
  assert.equal(last.readAt.toISOString(), '2026-10-22T09:00:02.000Z');
  assert.equal(last.deliveredAt.toISOString(), '2026-10-22T09:00:01.000Z');
  assert.deepEqual(last.mediaKeys, ['a.jpeg', 'b.mp4']);
  assert.equal(last.replyToId, 'old');
  assert.equal(last.messageSeq, 2);
  assert.equal(rows[0].unreadCount, 3);
  for (const field of ['mediaKeys', 'readAt', 'replyToId', 'expiresAt', 'editedAt', 'revision', 'messageSeq']) assert.equal(h.select()[field], true);
});
test('new reaction replaces the preview but an older reaction does not', async () => {
  const reaction = { matchId: 'chat', messageId: 'message', userId: 'peer', emoji: '❤️', at: new Date('2026-10-22T09:01:00Z'), messageSenderId: 'me', content: 'College fest', type: 'media' };
  assert.equal((await harness({ reaction }).service.getConversations('me'))[0].reactionPreview.emoji, '❤️');
  reaction.at = new Date('2026-10-22T08:59:00Z');
  assert.equal((await harness({ reaction }).service.getConversations('me'))[0].reactionPreview, null);
});
test('cleared history does not return the old message or reaction', async () => {
  const reaction = { matchId: 'chat', at: new Date('2026-10-22T09:01:00Z') };
  const row = (await harness({ cleared: 2, reaction }).service.getConversations('me'))[0];
  assert.equal(row.lastMessage, null);
  assert.equal(row.reactionPreview, null);
});
