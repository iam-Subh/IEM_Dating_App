const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(name, context = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../src/features/chat', name), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports, ...context });
  return module.exports;
}
const { createComposerDraft } = load('composerDraft.ts');

test('rapid sends read the newest text without waiting for a parent render or an earlier request', () => {
  const draft = createComposerDraft();
  const sent = [];
  const pressSend = () => {
    const content = draft.getSnapshot().trim();
    if (!content) return;
    draft.set('');
    sent.push(content);
  };
  for (const content of ['one', 'two', 'two', '❤️']) {
    draft.set(content);
    pressSend();
    pressSend();
  }
  assert.deepEqual(sent, ['one', 'two', 'two', '❤️']);
  assert.equal(draft.getSnapshot(), '');
});

test('typing updates the input immediately but batches chat-screen updates', () => {
  const draft = createComposerDraft();
  const timers = new Map();
  const updates = [];
  let id = 0, cleanup;
  const { useComposerDraftText } = load('useComposerDraftText.ts', {
    require: name => {
      assert.equal(name, 'react');
      return {
        useState: initial => [initial(), value => updates.push(value)],
        useEffect: effect => { cleanup = effect(); },
      };
    },
    setTimeout: callback => { timers.set(++id, callback); return id; },
    clearTimeout: key => timers.delete(key),
  });
  useComposerDraftText(draft);
  updates.length = 0;
  for (const text of ['h', 'he', 'hel', 'hell', 'hello']) draft.set(text);
  assert.equal(draft.getSnapshot(), 'hello');
  assert.equal(updates.length, 0);
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.deepEqual(updates, ['hello']);
  cleanup();
  draft.set('after unmount');
  assert.equal(timers.size, 0);
});

test('native attachment results are delivered once; cancellation releases the request', () => {
  const requests = load('attachmentPickerRequests.ts');
  const selected = [{ id: 'photo' }];
  const results = [];
  const first = requests.createAttachmentPickerRequest(selected, value => results.push(value));
  assert.equal(requests.attachmentPickerSelection(first), selected);
  requests.finishAttachmentPickerRequest(first, selected);
  requests.finishAttachmentPickerRequest(first, null);
  assert.deepEqual(results, [selected]);
  const cancelled = requests.createAttachmentPickerRequest([], value => results.push(value));
  requests.cancelAttachmentPickerRequest(cancelled);
  requests.finishAttachmentPickerRequest(cancelled, selected);
  assert.deepEqual(results, [selected]);
  const dismissed = requests.createAttachmentPickerRequest([], value => results.push(value));
  requests.finishAttachmentPickerRequest(dismissed, null);
  assert.equal(results[1], null);
});
