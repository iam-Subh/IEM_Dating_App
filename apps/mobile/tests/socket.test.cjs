const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness() {
  let auth = { user: { id: 'a' }, token: 'old-token' };
  const subscribers = new Set();
  const instances = [];
  const appState = new Set();
  const module = { exports: {} };
  const store = { getState: () => ({ auth }), subscribe: (fn) => { subscribers.add(fn); return () => subscribers.delete(fn); } };
  const source = fs.readFileSync(path.join(__dirname, '../src/services/socket.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, process: { env: {} }, console, URL,
    require: (name) => {
      if (name === '../store') return { store };
      if (name === '../store/authSlice') return { updateUser: (payload) => ({ type: 'updateUser', payload }) };
      if (name === './presenceHeartbeat') return { startPresenceHeartbeat() {}, stopPresenceHeartbeat() {} };
      if (name === 'react-native') return { Platform: { OS: 'android' }, AppState: { addEventListener: (_event, fn) => { appState.add(fn); return { remove: () => appState.delete(fn) }; } } };
      if (name === 'socket.io-client') return { io: (_url, options) => {
        const socket = { options, connected: false, connects: 0, disconnects: 0, listeners: new Map(),
          on(event, fn) { this.listeners.set(event, fn); return this; },
          connect() { this.connects++; return this; },
          disconnect() { this.disconnects++; return this; },
        };
        instances.push(socket); return socket;
      } };
      throw new Error(name);
    },
  });
  return { service: module.exports, instances, appState, update(next) { auth = next; [...subscribers].forEach((fn) => fn()); } };
}

test('initialization preserves a reconnecting socket and its listeners', () => {
  const h = harness(); h.service.initSocket();
  const original = h.service.getSocket();
  original.on('new_message', () => {});
  h.service.initSocket();
  assert.equal(h.instances.length, 1);
  assert.equal(h.service.getSocket(), original);
  assert.ok(original.listeners.has('new_message'));
});

test('token refresh reconnects the same socket with current credentials', () => {
  const h = harness(); h.service.initSocket();
  const original = h.service.getSocket();
  h.update({ user: { id: 'a' }, token: 'new-token' });
  assert.equal(h.service.getSocket(), original);
  assert.equal(original.disconnects, 1);
  assert.equal(original.connects, 1);
  original.options.auth((value) => assert.equal(value.token, 'new-token'));
});

test('logout and account switch disconnect the previous socket', () => {
  for (const next of [{ user: null, token: null }, { user: { id: 'b' }, token: 'b-token' }]) {
    const h = harness(); h.service.initSocket();
    const original = h.service.getSocket();
    h.update(next);
    assert.equal(h.service.getSocket(), null);
    assert.equal(original.disconnects, 1);
  }
});

test('back on screen, a dropped socket connects at once; screens hear about a new socket', () => {
  const h = harness();
  const seen = [];
  h.service.onSocketChange((socket) => seen.push(socket));
  h.service.initSocket();
  const socket = h.service.getSocket();
  assert.equal(socket.options.reconnectionAttempts, Infinity, 'it never gives up');
  assert.deepEqual(seen, [socket]);
  [...h.appState].forEach((fn) => fn('active'));
  assert.equal(socket.connects, 1, 'reconnects when the app returns');
  socket.connected = true;
  [...h.appState].forEach((fn) => fn('active'));
  assert.equal(socket.connects, 1, 'a live connection is left alone');
  h.update({ user: null, token: null });
  assert.equal(seen.at(-1), null, 'sign-out is announced');
  assert.equal(h.appState.size, 0, 'no listener is left behind');
});
