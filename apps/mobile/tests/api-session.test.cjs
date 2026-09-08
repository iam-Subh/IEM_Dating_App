const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness() {
  let auth = { user: { id: 'a' }, token: 'token-a' };
  let subscriber;
  let request, success, failure;
  let refresh;
  let stored = 'refresh-a';
  const actions = [];
  const retries = [];
  const api = Object.assign((config) => { retries.push(request(config)); return Promise.resolve('retried'); }, {
    post: () => refresh(),
    interceptors: {
      request: { use: (fn) => { request = fn; } },
      response: { use: (ok, bad) => { success = ok; failure = bad; } },
    },
  });
  const store = { getState: () => ({ auth }), subscribe: (fn) => { subscriber = fn; }, dispatch: (action) => { actions.push(action); } };
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/api.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, process: { env: {} }, __DEV__: true, console,
    require: (name) => {
      if (name === 'axios') return { create: () => api };
      if (name === '../store') return { store };
      if (name === 'react-native') return { Platform: { OS: 'android' } };
      if (name === '../store/authSlice') return { setAccessToken: (token) => ({ token }) };
      if (name === './credentialStore') return { credentialStore: {
        getRefreshToken: async () => stored,
        rotateRefreshToken: async (expected, value, valid) => { assert.ok(valid()); assert.equal(expected, stored); stored = value; },
      } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return {
    request: (config) => request(config), success: (response) => success(response), failure: (error) => failure(error), actions, retries,
    refresh: (fn) => { refresh = fn; }, stored: () => stored,
    rotateAccessToken() { auth = { ...auth, token: 'rotated-token-a' }; subscriber(); },
    logout() { auth = { user: null, token: null }; stored = null; subscriber(); },
    switchAccount() { auth = { user: { id: 'b' }, token: 'token-b' }; stored = 'refresh-b'; subscriber(); },
  };
}

test('old-account HTTP responses and retries are rejected', () => {
  const h = harness();
  const config = h.request({ url: '/chat/search', headers: {} });
  h.switchAccount();
  assert.throws(() => h.success({ config, data: 'private account A data' }), /Session changed/);
  assert.throws(() => h.request(config), /Session changed/);
});

test('a late refresh cannot replace credentials after an account switch', async () => {
  const h = harness();
  let finish, started;
  const ready = new Promise((resolve) => { started = resolve; });
  h.refresh(() => { started(); return new Promise((resolve) => { finish = resolve; }); });
  const error = { response: { status: 401 }, config: h.request({ url: '/chat/search', headers: {} }) };
  const pending = h.failure(error);
  await ready;
  h.switchAccount();
  finish({ data: { data: { accessToken: 'late-access', refreshToken: 'late-refresh' } } });
  await assert.rejects(pending);
  assert.equal(h.stored(), 'refresh-b');
  assert.equal(h.actions.length, 0);
});

test('a network failure during refresh does not log out or erase credentials', async () => {
  const h = harness();
  h.refresh(async () => { throw new Error('Network timeout'); });
  await assert.rejects(h.failure({ response: { status: 401 }, config: h.request({ url: '/chat/search', headers: {} }) }));
  assert.equal(h.stored(), 'refresh-a');
  assert.equal(h.actions.length, 0);
});

test('a delayed 401 uses the current access token without rotating credentials again', async () => {
  const h = harness();
  const config = h.request({ url: '/chat/search', headers: {} });
  h.rotateAccessToken();
  h.refresh(() => { assert.fail('The delayed response must not start a second refresh'); });
  assert.equal(await h.failure({ response: { status: 401 }, config }), 'retried');
  assert.equal(h.retries[0].headers.Authorization, 'Bearer rotated-token-a');
  assert.equal(h.stored(), 'refresh-a');
});

test('logout rejects pending responses and removes supplied bearer credentials from new requests', () => {
  const h = harness();
  const config = h.request({ url: '/chat/search', headers: {} });
  h.logout();
  assert.throws(() => h.success({ config }), /Session changed/);
  const next = h.request({ url: '/auth/login', headers: { Authorization: 'Bearer token-a' } });
  assert.equal(next.headers.Authorization, undefined);
});
