const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
  '../src/screens/main/profile/loadProfileForSession.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported });
const { loadProfileForSession } = exported;
function harness(fetchProfile) {
  let session = { user: { id: 'a' }, token: 'token-a' };
  const controller = new AbortController();
  const applied = [];
  return { controller, applied, session: value => { session = value; },
    load: () => loadProfileForSession({ accountId: 'a', signal: controller.signal,
      getSession: () => session, fetchProfile, applyProfile: profile => applied.push(profile) }) };
}
const response = (id = 'a') => ({ data: { success: true, data: { id, isVerified: true } } });

test('a saved account does not request Profile until a token is ready', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return response(); });
  h.session({ user: { id: 'a' }, token: null });
  await h.load();
  assert.equal(calls, 0);
  h.session({ user: { id: 'a' }, token: 'restored-token' });
  await h.load();
  assert.equal(calls, 1);
  assert.equal(h.applied[0].isVerified, true);
});

test('a session cancellation retries the current account once and restores Profile', async () => {
  let calls = 0;
  const h = harness(async () => {
    if (++calls === 1) throw new Error('Session changed');
    return response();
  });
  await h.load();
  assert.equal(calls, 2);
  assert.equal(h.applied.length, 1);
});

test('repeated session cancellation cannot create a retry loop', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; throw new Error('Session changed'); });
  await h.load();
  assert.equal(calls, 2);
  assert.equal(h.applied.length, 0);
});

test('an account switch cancels the request without retrying under the other account', async () => {
  let finish, calls = 0;
  const h = harness(() => { calls++; return new Promise((_, reject) => { finish = reject; }); });
  const pending = h.load();
  h.session({ user: { id: 'b' }, token: 'token-b' });
  finish(new Error('Session changed'));
  await pending;
  assert.equal(calls, 1);
  assert.equal(h.applied.length, 0);
});

test('a late response cannot update Profile after logout', async () => {
  let finish;
  const h = harness(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.load();
  h.session({ user: null, token: null });
  finish(response());
  await pending;
  assert.equal(h.applied.length, 0);
});

test('unmounting or starting a newer request prevents the obsolete response from applying', async () => {
  let finish;
  const h = harness(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.load();
  h.controller.abort();
  finish(response());
  await pending;
  assert.equal(h.applied.length, 0);
});

test('another profile ID cannot replace the current account', async () => {
  const h = harness(async () => response('b'));
  await h.load();
  assert.equal(h.applied.length, 0);
});

test('a real network failure remains visible to the caller and is not retried', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; throw new Error('Network Error'); });
  await assert.rejects(h.load(), /Network Error/);
  assert.equal(calls, 1);
});
