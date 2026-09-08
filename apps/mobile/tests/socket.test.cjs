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
  const module = { exports: {} };
  const store = { getState: () => ({ auth }), subscribe: (fn) => { subscribers.add(fn); return () => subscribers.delete(fn); } };
  const source = fs.readFileSync(path.join(__dirname, '../src/services/socket.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, process: { env: {} }, console, URL,
    require: (name) => {
      if (name === '../store') return { store };
      if (name === 'react-native') return { Platform: { OS: 'android' } };
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
  return { service: module.exports, instances, update(next) { auth = next; [...subscribers].forEach((fn) => fn()); } };
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
