const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const moduleExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/discovery/matchMessage.ts'), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS},
}).outputText, {exports: moduleExports});
const {createMatchMessageSender} = moduleExports;

test('rapid taps share one message request', async () => {
  const calls = [];
  let complete;
  const send = createMatchMessageSender((...args) => { calls.push(args); return new Promise(resolve => { complete = resolve; }); });
  const first = send('  Hello  ');
  assert.equal(send('Hello'), first);
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'Hello');
  complete();
  await first;
});

test('a timeout and retry reuse the message ID', async () => {
  const ids = [];
  const send = createMatchMessageSender(async (_, id) => { ids.push(id); if (ids.length === 1) throw new Error('timeout'); });
  await assert.rejects(send('Hello'));
  await send('Hello');
  assert.equal(ids[0], ids[1]);
});

test('edited content uses a new message ID after failure', async () => {
  const ids = [];
  const send = createMatchMessageSender(async (_, id) => { ids.push(id); throw new Error('offline'); });
  await assert.rejects(send('Hello'));
  await assert.rejects(send('Hi there'));
  assert.notEqual(ids[0], ids[1]);
});

test('invalid message length never calls the API', async () => {
  let calls = 0;
  const send = createMatchMessageSender(async () => { calls++; });
  await assert.rejects(send('   '));
  await assert.rejects(send('x'.repeat(2001)));
  assert.equal(calls, 0);
});
