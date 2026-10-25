const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative) {
  const filename = path.resolve(__dirname, relative);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, console, require: name => name.startsWith('.') ? load(path.relative(__dirname, path.resolve(path.dirname(filename), name)) + '.ts') : require(name) });
  return module.exports;
}
const { conversationPreview: preview } = load('../src/features/chat/conversationPreview.ts');
const slice = load('../src/store/chatSlice.ts');
const message = (changes = {}) => ({ id: 'm1', content: '', senderId: 'me', sentAt: '2026-10-22T09:00:00Z', matchId: 'chat', readAt: null, isRead: false, type: 'text', ...changes });
const show = (changes, options = {}) => preview({ lastMessage: message(changes), currentUserId: 'me', ...options });

test('text, emoji sequences and line breaks keep their content', () => {
  assert.equal(show({ content: '👨‍👩‍👧‍👦 👍🏽 🇮🇳' }).text, '👨‍👩‍👧‍👦 👍🏽 🇮🇳');
  assert.equal(show({ content: 'Hello\nthere 😊' }).text, 'Hello there 😊');
  assert.equal(show({ content: 'Hi' }).prefix, 'You: ');
  assert.equal(show({ senderId: 'peer', content: 'Hi' }).prefix, '');
});
test('photos, videos, albums, GIFs and captions have type labels', () => {
  for (const [keys, text, icon] of [
    [['a.jpg'], 'Photo', 'image-outline'], [['a.mp4'], 'Video', 'videocam-outline'],
    [['a.jpg', 'b.jpg'], '2 photos', 'images-outline'], [['a.mp4', 'b.mp4'], '2 videos', 'videocam-outline'],
    [['a.jpg', 'b.mp4'], '2 attachments', 'images-outline'], [['a.gif'], 'GIF', 'image-outline'],
  ]) {
    const result = show({ type: 'media', mediaKeys: keys });
    assert.equal(result.text, text); assert.equal(result.icon, icon);
    assert.equal(show({ type: 'media', mediaKeys: keys, content: 'College fest ❤️' }).text, 'College fest ❤️');
  }
});
test('voice, documents, replies, links and unknown attachments have safe previews', () => {
  assert.equal(show({ type: 'voice', metadata: { durationSeconds: 65 } }).text, '1:05');
  assert.equal(show({ type: 'voice' }).text, 'Voice message');
  assert.equal(show({ type: 'voice', playedAt: 'now' }).played, true);
  assert.equal(show({ type: 'document', metadata: { document: { fileName: 'Work.pdf' } } }).text, 'Work.pdf');
  assert.equal(show({ type: 'document', metadata: { document: { fileName: 'music.mp3', mimeType: 'audio/mpeg' } } }).icon, 'musical-notes-outline');
  assert.equal(show({ content: 'Yes', replyToId: 'old' }).icon, 'arrow-undo-outline');
  assert.equal(show({ content: 'https://example.com' }).icon, 'link-outline');
  assert.equal(show({ type: 'unsupported', content: 'private metadata' }).text, 'Attachment');
});
test('Story reply and reaction identify both directions', () => {
  assert.equal(show({ type: 'story_reply', content: 'Nice!' }).text, 'You replied to their story: Nice!');
  assert.equal(show({ type: 'story_reply', senderId: 'peer', content: 'Nice!' }).text, 'Replied to your story: Nice!');
  assert.equal(show({ type: 'story_reply', content: '❤️', metadata: { storyReplyKind: 'reaction' } }).text, 'You reacted ❤️ to their story');
  assert.equal(show({ type: 'story_reply', senderId: 'peer', content: '❤️', metadata: { storyReplyKind: 'reaction' } }).text, 'Reacted ❤️ to your story');
});
test('status follows confirmed receipts; recipient never sees outgoing status', () => {
  for (const [changes, expected] of [[{}, 'sent'], [{ localStatus: 'queued' }, 'pending'], [{ deliveredAt: 'now' }, 'delivered'], [{ readAt: 'now' }, 'read'], [{ localStatus: 'failed' }, 'failed']]) {
    assert.equal(show(changes).status, expected);
    assert.equal(show({ ...changes, senderId: 'peer' }).status, null);
  }
  assert.equal(show({ isRead: true }).status, 'sent'); // No fabricated timestamp.
});
test('draft, activity and reaction precedence preserves the latest message', () => {
  const draft = { text: 'Draft 😊', media: [], updatedAt: 1 };
  assert.equal(show({ content: 'Old' }, { draft }).prefix, 'Draft: ');
  assert.equal(show({}, { draft, activity: 'recording' }).text, 'Recording voice message…');
  assert.equal(show({}, { activity: 'typing' }).status, null);
  const reaction = { messageId: 'm1', userId: 'peer', emoji: '❤️', at: '2026-10-22T09:00:01Z', messageSenderId: 'me', content: 'Hi' };
  assert.equal(show({ content: 'Hi' }, { reaction }).text, 'Reacted ❤️ to your message');
  assert.equal(show({ content: 'New', sentAt: '2026-10-22T09:00:02Z' }, { reaction }).text, 'New');
});
test('pending uploads, failures, empty and expired chats have explicit fallbacks', () => {
  assert.equal(show({ type: 'media', localStatus: 'sending', metadata: { localMediaUpload: { items: [{ status: 'uploading' }] } } }).text, 'Uploading attachment…');
  assert.equal(show({ type: 'media', localStatus: 'sending', metadata: { localMediaUpload: { items: [{ status: 'processing' }] } } }).text, 'Processing attachment…');
  assert.equal(show({ type: 'story_reply', localStatus: 'failed' }).text, 'Couldn’t send message');
  assert.equal(preview({ lastMessage: null, currentUserId: 'me' }).text, 'Say hello! 👋');
  assert.equal(show({ expiresAt: '2026-10-22T09:00:01Z' }, { now: Date.parse('2026-10-22T09:00:02Z') }).text, 'Say hello! 👋');
});
test('thumbnail keys point only to static approved derivatives', () => {
  const key = 'chat-media-approved/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222';
  assert.equal(show({ type: 'media', mediaKey: key + '.gif' }).thumbnailKey, key + '.thumbnail.jpg');
  assert.equal(show({ type: 'media', mediaKey: key + '.mp4' }).thumbnailKey, key + '.thumbnail.jpg');
  assert.equal(show({ type: 'document', mediaKey: key + '.jpeg' }).thumbnailKey, undefined);
  assert.equal(show({ type: 'media', mediaKey: 'https://example.com/private.mp4' }).thumbnailKey, undefined);
});

function initial(last = message()) {
  return slice.default(undefined, slice.setConversations([{ matchId: 'chat', user: { id: 'peer', name: 'Rupsa', avatar: null }, lastMessage: last, unreadCount: 0, createdAt: last.sentAt }]));
}
test('realtime receipts update previews without loading the chat history', () => {
  let state = initial(message({ messageSeq: 10 }));
  state = slice.default(state, slice.markMessagesDeliveredByPeer({ matchId: 'chat', throughMessageSeq: 9, deliveredAt: '2026-10-22T09:00:01Z' }));
  assert.equal(state.conversations[0].lastMessage.deliveredAt, undefined);
  state = slice.default(state, slice.markMessagesDeliveredByPeer({ matchId: 'chat', throughMessageSeq: 10, deliveredAt: '2026-10-22T09:00:01Z' }));
  assert.equal(state.conversations[0].lastMessage.deliveredAt, '2026-10-22T09:00:01Z');
  state = slice.default(state, slice.markMessagesReadByPeer({ matchId: 'chat', messageIds: ['m1'], readAt: '2026-10-22T09:00:02Z' }));
  assert.equal(state.conversations[0].lastMessage.readAt, '2026-10-22T09:00:02Z');
  state = slice.default(state, slice.markVoicePlayed({ matchId: 'chat', messageId: 'm1', playedAt: '2026-10-22T09:00:03Z' }));
  assert.equal(state.conversations[0].lastMessage.playedAt, '2026-10-22T09:00:03Z');
});
test('optimistic send, confirmation, edits and deletion retain media details', () => {
  let state = initial();
  state = slice.default(state, slice.addMessage(message({ id: 'temp-1', type: 'media', mediaKeys: ['local-a.mp4'], sentAt: '2026-10-22T09:01:00Z', localStatus: 'sending' })));
  assert.equal(state.conversations[0].lastMessage.type, 'media');
  state = slice.default(state, slice.replaceOptimisticMessage({ tempId: 'temp-1', realMessage: message({ id: 'real', type: 'media', mediaKeys: ['a.mp4'], sentAt: '2026-10-22T09:01:00Z' }) }));
  assert.equal(state.conversations[0].lastMessage.mediaKeys[0], 'a.mp4');
  state = slice.default(state, slice.applyMessageEdit({ matchId: 'chat', messageId: 'real', content: 'New caption', revision: 2, editedAt: '2026-10-22T09:02:00Z' }));
  assert.equal(state.conversations[0].lastMessage.content, 'New caption');
  state = slice.default(state, slice.addMessage(message({ id: 'newer', content: 'Hi', sentAt: '2026-10-22T09:03:00Z' })));
  state = slice.default(state, slice.removeMessage({ matchId: 'chat', messageId: 'newer' }));
  assert.equal(state.conversations[0].lastMessage.mediaKeys[0], 'a.mp4');
});
test('refresh preserves unsent failures but replaces a confirmed client message', () => {
  const pending = message({ id: 'temp-1', localStatus: 'failed' });
  let state = initial(pending);
  const row = { ...state.conversations[0], lastMessage: null };
  state = slice.default(state, slice.setConversations([row]));
  assert.equal(state.conversations[0].lastMessage.id, 'temp-1');
  state = slice.default(state, slice.setConversations([{ ...row, lastMessage: message({ id: 'real', clientMessageId: 'temp-1' }) }]));
  assert.equal(state.conversations[0].lastMessage.id, 'real');
});
