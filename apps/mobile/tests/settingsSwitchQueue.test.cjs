const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadModule(file, imports = {}) {
  const exported = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { exports: exported, require: (name) => imports[name] ?? {} });
  return exported;
}

const { createSettingsSwitchQueue } = loadModule('../src/core/settings/settingsSwitchQueue.ts');
const initial = { searchDiscoverable: true, notifyLikes: true, showOnlineStatus: true };
const turn = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function switches() {
  const calls = [], errors = [], frames = [];
  let view = { ...initial };
  const queue = createSettingsSwitchQueue(initial, {
    save: (field, value) => { const result = deferred(); calls.push({ field, value, ...result }); return result.promise; },
    onChange: (values) => { view = { ...values }; frames.push(view); },
    onConfirm: () => {},
    onError: (field) => errors.push(field),
  });
  return { queue, calls, errors, frames, view: () => view };
}

test('rapid off/on taps keep the newest choice while older saves and source updates finish', async () => {
  const state = switches();
  state.queue.change('notifyLikes', false);
  const done = state.queue.change('notifyLikes', true);
  assert.equal(state.view().notifyLikes, true);
  await turn();
  assert.equal(state.calls.length, 1, 'requests must run in order');
  state.queue.sync({ ...initial, notifyLikes: false });
  state.calls[0].resolve(false);
  await turn();
  assert.equal(state.view().notifyLikes, true);
  assert.equal(state.calls.length, 2);
  state.calls[1].resolve(true);
  await done;
  assert.deepEqual(state.frames.map((frame) => frame.notifyLikes), [false, true]);
});

test('a failed latest save restores the last confirmed choice and the queue continues', async () => {
  const state = switches();
  state.queue.change('notifyLikes', false);
  const failed = state.queue.change('notifyLikes', true);
  await turn();
  state.calls[0].resolve(false);
  await turn();
  state.calls[1].reject(new Error('offline'));
  await failed;
  assert.equal(state.view().notifyLikes, false);
  assert.deepEqual(state.errors, ['notifyLikes']);
  const next = state.queue.change('showOnlineStatus', false);
  await turn();
  state.calls[2].resolve(false);
  await next;
  assert.equal(state.view().showOnlineStatus, false);
});

test('failure in one switch cannot reset another pending switch', async () => {
  const state = switches();
  state.queue.change('notifyLikes', false);
  const done = state.queue.change('searchDiscoverable', false);
  state.queue.sync({ ...initial });
  await turn();
  state.calls[0].reject(new Error('offline'));
  await turn();
  assert.equal(state.view().notifyLikes, true);
  assert.equal(state.view().searchDiscoverable, false);
  state.calls[1].resolve(false);
  await done;
  state.queue.sync({ ...initial, searchDiscoverable: false, showOnlineStatus: false });
  assert.equal(state.view().showOnlineStatus, false, 'idle switches accept new source values');
});

function storySettings() {
  let current = { archive: true, resharing: true, replies: 'matches', counts: { followers: 7 } };
  const calls = [];
  const client = {
    getQueryData: () => current,
    setQueryData: (_key, update) => { current = typeof update === 'function' ? update(current) : update; },
    cancelQueries: () => Promise.resolve(),
  };
  const module = loadModule('../src/features/stories/settings/storySettings.ts', {
    react: { useRef: (value) => ({ current: value }) },
    '@tanstack/react-query': { useQueryClient: () => client },
    '../../../services/api': { api: { put: (_url, change) => {
      const result = deferred(); calls.push({ change: { ...change }, ...result }); return result.promise;
    } } },
  });
  return { save: module.useUpdateStorySettings(), calls, view: () => current };
}

test('story switch responses cannot replace newer choices, other switches, or list counts', async () => {
  const state = storySettings();
  const first = state.save({ archive: false });
  const second = state.save({ archive: true });
  const third = state.save({ resharing: false });
  assert.equal(state.view().archive, true);
  assert.equal(state.view().resharing, false);
  await turn();
  state.calls[0].resolve({ data: { data: { archive: false, resharing: true, counts: { followers: 1 } } } });
  await first;
  await turn();
  assert.equal(state.view().archive, true);
  assert.equal(state.view().resharing, false);
  assert.equal(state.view().counts.followers, 7);
  state.calls[1].resolve({ data: { data: { archive: true, resharing: true } } });
  await second;
  await turn();
  state.calls[2].resolve({ data: { data: { archive: true, resharing: false } } });
  await third;
});

test('story save failure rolls back only the affected field and later saves continue', async () => {
  const state = storySettings();
  const failed = assert.rejects(state.save({ archive: false }), /offline/);
  const next = state.save({ resharing: false });
  await turn();
  state.calls[0].reject(new Error('offline'));
  await failed;
  await turn();
  assert.equal(state.view().archive, true);
  assert.equal(state.view().resharing, false);
  state.calls[1].resolve({ data: { data: { archive: true, resharing: false } } });
  await next;
});

test('story off/on failure restores the last successful save instead of the pre-tap value', async () => {
  const state = storySettings();
  const first = state.save({ archive: false });
  const failed = assert.rejects(state.save({ archive: true }), /offline/);
  await turn();
  state.calls[0].resolve({ data: { data: { archive: false } } });
  await first;
  await turn();
  state.calls[1].reject(new Error('offline'));
  await failed;
  assert.equal(state.view().archive, false);
});
