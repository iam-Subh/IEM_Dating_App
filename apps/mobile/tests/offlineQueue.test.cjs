const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness() {
  const data = new Map();
  let auth = { user: { id: 'account-a' }, token: 'token-a' };
  let delayRead;
  const timers = [];
  const storage = {
    getItem: async (key) => { if (delayRead) await delayRead; return data.get(key) ?? null; },
    setItem: async (key, value) => { data.set(key, value); },
    removeItem: async (key) => { data.delete(key); },
  };
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../src/services/offlineQueue.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, console: { log() {}, error() {} },
    require: (name) => {
      if (name === '@react-native-async-storage/async-storage') return storage;
      if (name === '../store') return { store: { getState: () => ({ auth }) } };
      if (name === './queue/sendRetryPolicy') {
        const policy = { exports: {} };
        const source = fs.readFileSync(path.join(__dirname, '../src/services/queue/sendRetryPolicy.ts'), 'utf8');
        vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: policy.exports });
        return policy.exports;
      }
      throw new Error(`Unexpected import: ${name}`);
    },
    setTimeout: (callback) => { timers.push(callback); return callback; },
    clearTimeout: () => {},
  });
  return {
    queue: module.exports, data, timers,
    switchAccount: () => { auth = { user: { id: 'account-b' }, token: 'token-b' }; },
    delay: (promise) => { delayRead = promise; },
  };
}

const message = { tempId: 'one', matchId: 'match', content: 'Private text', mediaKeys: [], queuedAt: 1, status: 'pending' };

test('terminal sends stay stored as failed without blocking later sends', async () => {
  const h = harness();
  await h.queue.addToOfflineQueue(message);
  await h.queue.addToOfflineQueue({ ...message, tempId: 'two', queuedAt: 2 });
  await h.queue.retryOfflineMessages({ connected: true, emit: (_event, body, callback) => {
    callback(body.clientMessageId === 'one' ? { success: false, code: 'INVALID_MEDIA_TICKET' } : { success: true, message: { id: 'server-two' } });
  } }, 'match');
  const remaining = await h.queue.getOfflineQueue();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].status, 'failed');
  assert.equal(remaining[0].content, 'Private text');
});

test('a delayed queue write retains the original account key', async () => {
  const h = harness();
  let release;
  h.delay(new Promise((resolve) => { release = resolve; }));
  const pending = h.queue.addToOfflineQueue(message);
  await Promise.resolve();
  h.switchAccount();
  release();
  await pending;
  assert.equal(JSON.parse(h.data.get('@chat:offlineQueue:account-a'))[0].content, 'Private text');
  assert.equal(h.data.has('@chat:offlineQueue:account-b'), false);
});

test('a retry acknowledgement after account switch cannot update the new account', async () => {
  const h = harness();
  await h.queue.addToOfflineQueue(message);
  let acknowledge;
  let emitted;
  const sent = new Promise((resolve) => { emitted = resolve; });
  let confirmations = 0;
  const pending = h.queue.retryOfflineMessages({ connected: true, emit: (_event, _body, callback) => { acknowledge = callback; emitted(); } }, 'match', () => { confirmations++; });
  await sent;
  h.switchAccount();
  acknowledge({ success: true, message: { id: 'server' } });
  assert.equal((await pending).length, 0);
  assert.equal(confirmations, 0);
  assert.equal(h.data.has('@chat:offlineQueue:account-b'), false);
});

test('a late retry acknowledgement cannot confirm a timed-out attempt', async () => {
  const h = harness();
  await h.queue.addToOfflineQueue(message);
  await h.queue.addToOfflineQueue({ ...message, tempId: 'two', queuedAt: 2 });
  let acknowledge;
  let emitted;
  const sent = new Promise((resolve) => { emitted = resolve; });
  let confirmations = 0;
  const pending = h.queue.retryOfflineMessages({ connected: true, emit: (_event, _body, callback) => { acknowledge = callback; emitted(); } }, 'match', () => { confirmations++; });
  await sent;
  h.timers[0]();
  assert.equal((await pending).length, 0);
  acknowledge({ success: true, message: { id: 'server' } });
  assert.equal(confirmations, 0);
  assert.equal((await h.queue.getOfflineQueue()).length, 2);
  assert.equal(h.timers.length, 1);
});
