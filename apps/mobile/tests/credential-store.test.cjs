const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(storage, secure) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/credentialStore.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    if (name === 'expo-secure-store') return secure;
    if (name === 'react-native') return { Platform: { OS: 'android' } };
    if (name === '@react-native-async-storage/async-storage') return storage;
    throw new Error(name);
  } });
  return module.exports.credentialStore;
}

test('failed token deletion cannot restore a logged-out session after restart', async () => {
  const data = new Map();
  let token = 'old-token';
  let attempts = 0;
  const storage = {
    getItem: async key => data.get(key) ?? null,
    setItem: async (key, value) => { data.set(key, value); },
    removeItem: async key => { data.delete(key); },
  };
  const secure = {
    getItemAsync: async () => token,
    setItemAsync: async (_key, value) => { token = value; },
    deleteItemAsync: async () => { attempts++; throw new Error('Device storage failed'); },
  };
  const credentials = load(storage, secure);
  await assert.rejects(credentials.clear());
  assert.equal(attempts, 3);
  assert.equal(await credentials.getRefreshToken(), null);
  const restarted = load(storage, secure);
  assert.equal(await restarted.getRefreshToken(), null);
  await restarted.setRefreshToken('new-account-token');
  assert.equal(await restarted.getRefreshToken(), 'new-account-token');
});

test('a transient deletion failure is retried before a later login writes credentials', async () => {
  let token = 'old';
  let attempts = 0;
  const credentials = load({ getItem: async () => null, setItem: async () => {}, removeItem: async () => {} }, {
    getItemAsync: async () => token,
    setItemAsync: async (_key, value) => { token = value; },
    deleteItemAsync: async () => { if (++attempts === 1) throw new Error('Temporary'); token = null; },
  });
  const clearing = credentials.clear();
  const login = credentials.setRefreshToken('new');
  await Promise.all([clearing, login]);
  assert.equal(attempts, 2);
  assert.equal(await credentials.getRefreshToken(), 'new');
});
