const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness(failStorage = false, networkFailures = 0) {
  let auth = { token: 'token-a', user: { id: 'a' } };
  let finish;
  const calls = [];
  const store = { getState: () => ({ auth }), dispatch: (action) => {
    calls.push(action);
    if (action === 'logout') auth = { token: null, user: null };
  } };
  const modules = {
    axios: { post: (_url, _data, config) => { calls.push(config.headers.Authorization); if (networkFailures-- > 0) return Promise.reject(new Error('Offline')); return new Promise(resolve => { finish = resolve; }); } },
    './api': { api: { defaults: { baseURL: 'http://localhost/api/v1' } } },
    '../store': { store },
    '../store/authSlice': { logout: () => 'logout' },
    '../store/chatSlice': { resetChatState: () => 'resetChat' },
    '../store/discoverSlice': { resetDiscoverState: () => 'resetDiscover' },
    './socket': { disconnectSocket: () => calls.push('disconnect') },
    './offlineQueue': { clearOfflineQueue: () => { calls.push(`queue:${auth.user.id}`); return failStorage ? Promise.reject(new Error('storage')) : Promise.resolve(); } },
    './credentialStore': { credentialStore: { clear: () => { calls.push('credentials'); return Promise.resolve(); } } },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/sessionLogout.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    assert.ok(modules[name], name); return modules[name];
  } });
  return { ...module.exports, calls, auth: () => auth, finish: () => finish(),
    switchAccount: () => { auth = { token: 'token-b', user: { id: 'b' } }; } };
}

test('logout closes access before the server replies and cannot clear a later account', async () => {
  const h = harness();
  const pending = h.logoutSession();
  assert.equal(h.auth().token, null);
  assert.deepEqual(h.calls, ['Bearer token-a', 'queue:a', 'credentials', 'disconnect', 'resetChat', 'resetDiscover', 'logout']);
  h.switchAccount();
  h.finish();
  const result = await pending;
  assert.equal(result.serverRevoked, true);
  assert.equal(h.auth().token, 'token-b');
  assert.equal(h.calls.length, 7);
});

test('a queue storage failure does not prevent credential cleanup or local logout', async () => {
  const h = harness(true);
  const result = await h.clearLocalSession();
  assert.equal(result, false);
  assert.equal(h.auth().token, null);
  assert.ok(h.calls.includes('credentials'));
  assert.ok(h.calls.includes('resetChat'));
});

test('server retries remain scoped to the original token after another login', async () => {
  const h = harness(false, 2);
  const pending = h.logoutSession();
  h.switchAccount();
  await new Promise(resolve => setImmediate(resolve));
  h.finish();
  assert.equal((await pending).serverRevoked, true);
  assert.equal(h.calls.filter(call => call === 'Bearer token-a').length, 3);
  assert.equal(h.auth().token, 'token-b');
});

test('persistent network failure stops after three attempts and reports incomplete revocation', async () => {
  const h = harness(false, 10);
  assert.equal((await h.logoutSession()).serverRevoked, false);
  assert.equal(h.calls.filter(call => call === 'Bearer token-a').length, 3);
  assert.equal(h.auth().token, null);
});
