const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/chat/openChatAtMessage.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exported });
const { openChatAtMessage } = exported;

function navigatorWith(routes) {
  const calls = [];
  return {
    calls,
    getState: () => ({ routes }),
    popTo: (name, params, options) => calls.push({ action: 'popTo', name, params, options }),
    navigate: (name, params) => calls.push({ action: 'navigate', name, params }),
  };
}

test('returns to the chat already open instead of stacking a second one', () => {
  const navigation = navigatorWith([
    { name: 'Main' },
    { name: 'ChatScreen', params: { matchId: 'match-1' } },
    { name: 'ChatProfile', params: { matchId: 'match-1' } },
    { name: 'SharedMedia', params: { matchId: 'match-1' } },
  ]);
  openChatAtMessage(navigation, { matchId: 'match-1', focusMessageId: 'msg-9', userName: 'Ana' });
  assert.equal(navigation.calls.length, 1);
  const [call] = navigation.calls;
  assert.equal(call.action, 'popTo');
  assert.equal(call.params.focusMessageId, 'msg-9');
  assert.equal(call.options.merge, true);
});

test('opens a chat that is not in the stack', () => {
  const navigation = navigatorWith([{ name: 'Main' }, { name: 'MessageSearch' }]);
  openChatAtMessage(navigation, { matchId: 'match-2', focusMessageId: 'msg-3', userName: 'Bo' });
  assert.equal(navigation.calls[0].action, 'navigate');
  assert.equal(navigation.calls[0].params.userName, 'Bo');
  assert.equal(navigation.calls[0].params.matchId, 'match-2');
});

test('a chat open on a different conversation is not reused', () => {
  const navigation = navigatorWith([{ name: 'ChatScreen', params: { matchId: 'other' } }]);
  openChatAtMessage(navigation, { matchId: 'match-3', focusMessageId: 'msg-1' });
  assert.equal(navigation.calls[0].action, 'navigate');
});

test('jumping to the same message twice still carries a fresh nonce', () => {
  const routes = [{ name: 'ChatScreen', params: { matchId: 'm' } }, { name: 'SharedMedia' }];
  const navigation = navigatorWith(routes);
  openChatAtMessage(navigation, { matchId: 'm', focusMessageId: 'msg-1' });
  const first = navigation.calls[0].params.focusNonce;
  assert.equal(typeof first, 'number');
  assert.ok(first > 0);
});
