const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exportsForTest = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/discovery/swipeUndo.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsForTest });
const { createSwipeUndo, undoSecondsRemaining } = exportsForTest;

test('Undo and its first countdown value are available before the swipe receipt', () => {
  const pending = createSwipeUndo({ id: 'demo' }, 59000);
  assert.equal(pending.card.id, 'demo');
  assert.equal(undoSecondsRemaining(pending.until, 1000), 58);
  assert.equal(undoSecondsRemaining(pending.until, 1001), 58);
  assert.equal(undoSecondsRemaining(pending.until, 2000), 57);
});

test('an immediate Undo tap waits for the swipe save before sending a rewind', async () => {
  const pending = createSwipeUndo({ id: 'profile-a' }, 59000);
  const requests = [];
  pending.requested = true;
  const undo = (async () => {
    if (await pending.saved) requests.push(pending.card.id);
  })();
  await Promise.resolve();
  assert.deepEqual(requests, []);
  pending.complete(60000, 2000);
  await undo;
  assert.deepEqual(requests, ['profile-a']);
  assert.equal(pending.until, 60000);
});

test('a match, failed save, or cancelled animation cannot produce a rewind request', async () => {
  for (const reason of ['match', 'failure', 'cancelled']) {
    const pending = createSwipeUndo({ id: reason }, 59000);
    let requests = 0;
    const undo = (async () => { if (await pending.saved) requests += 1; })();
    pending.complete(null, 2000);
    // A later completion cannot revive a cancelled action.
    pending.complete(60000, 2001);
    await undo;
    assert.equal(requests, 0);
  }
});

test('out-of-order receipts retain each swipe target and deadline', async () => {
  const first = createSwipeUndo({ id: 'first' }, 59000);
  const second = createSwipeUndo({ id: 'second' }, 60000);
  second.complete(62000, 3000);
  first.complete(61000, 4000);
  assert.equal(await second.saved, true);
  assert.equal(await first.saved, true);
  assert.equal(second.card.id, 'second');
  assert.equal(second.until, 62000);
  assert.equal(first.until, 61000);
});

test('expired server deadlines cannot enable Undo or show a negative countdown', async () => {
  const pending = createSwipeUndo({ id: 'expired' }, 59000);
  pending.complete(60000, 60001);
  assert.equal(await pending.saved, false);
  assert.equal(undoSecondsRemaining(pending.until, 60001), 0);
});
