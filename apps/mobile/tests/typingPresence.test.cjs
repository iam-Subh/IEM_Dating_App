const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/chat/typingPresence.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported, setTimeout, clearTimeout });
const { createTypingPresence, shouldSendTyping, TYPING_REFRESH_MS, INCOMING_TYPING_TIMEOUT_MS } = exported;

function fakeClock() {
  let now = 0, next = 1;
  const timers = new Map();
  return {
    setTimeout: (fn, ms) => { const id = next++; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: id => timers.delete(id),
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    },
  };
}

test('a long message keeps "typing…" on the other phone', () => {
  const clock = fakeClock();
  const shown = [];
  const presence = createTypingPresence(value => shown.push(value), INCOMING_TYPING_TIMEOUT_MS, clock);
  // The sender types for 15 s, a keystroke every 500 ms.
  let typing = false, lastSent = 0;
  for (let at = 0; at <= 15_000; at += 500) {
    if (shouldSendTyping(typing, lastSent, at)) { presence.start(); typing = true; lastSent = at; }
    clock.advance(500);
  }
  assert.deepEqual([...shown], [true], 'shown once and never hidden while typing goes on');
  clock.advance(INCOMING_TYPING_TIMEOUT_MS);
  assert.deepEqual([...shown], [true, false], 'hidden once the signals stop');
});

test('typing is said on the first keystroke, then at most every refresh interval', () => {
  assert.equal(shouldSendTyping(false, 0, 10), true);
  assert.equal(shouldSendTyping(true, 1000, 1000 + TYPING_REFRESH_MS - 1), false);
  assert.equal(shouldSendTyping(true, 1000, 1000 + TYPING_REFRESH_MS), true);
  assert.ok(TYPING_REFRESH_MS < INCOMING_TYPING_TIMEOUT_MS);
});
