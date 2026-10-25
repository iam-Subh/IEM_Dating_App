const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { AxiosError, CanceledError } = require('axios');

const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/chat/conversationLoadError.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported });
const { conversationLoadError } = exported;

test('an Axios network failure shows a connection retry message', () => {
  const result = conversationLoadError(new AxiosError('Network Error', AxiosError.ERR_NETWORK));
  assert.equal(result.title, 'Cannot connect');
  assert.match(result.message, /connection.*try again/i);
});

test('a timeout has its own message instead of showing an empty chat list', () => {
  for (const code of [AxiosError.ECONNABORTED, AxiosError.ETIMEDOUT]) {
    assert.equal(conversationLoadError(new AxiosError('timeout', code)).title, 'Connection timed out');
  }
});

test('canceling an old request does not show a connection error', () => {
  assert.equal(conversationLoadError(new CanceledError()), null);
});

test('server errors do not claim that the connection is offline or expose response data', () => {
  const error = new AxiosError('Internal failure', AxiosError.ERR_BAD_RESPONSE, undefined, undefined, {
    status: 500, data: { internal: 'private diagnostic' },
  });
  const result = conversationLoadError(error);
  assert.equal(result.title, 'Cannot load chats');
  assert.doesNotMatch(JSON.stringify(result), /private diagnostic|offline|Internal failure/);
});
