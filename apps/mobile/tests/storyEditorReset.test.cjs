const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function editor(initial) {
  const cells = [];
  let cursor = 0;
  const react = {
    useState(value) {
      const index = cursor++;
      if (!cells[index]) cells[index] = { value: typeof value === 'function' ? value() : value };
      return [cells[index].value, next => { cells[index].value = typeof next === 'function' ? next(cells[index].value) : next; }];
    },
    useRef(value) {
      const index = cursor++;
      if (!cells[index]) cells[index] = { current: value };
      return cells[index];
    },
    useCallback: callback => callback,
    useMemo: callback => callback(),
  };
  const exported = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname,
    '../src/features/stories/create/composition/useStoryEditor.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { exports: exported, require: () => react });
  return () => { cursor = 0; return exported.useStoryEditor(initial); };
}

test('Reset restores the complete photo story, keeps adjacent stories, and can be undone', () => {
  const initial = { id: 'photo', media: { kind: 'photo', uri: 'file:///original.jpg' }, layers: [], drawing: [],
    music: null, filterId: 'normal', photoDurationMs: 5000, mediaTransform: { x: 540, y: 960, scale: 1, rotation: 0 } };
  const adjacent = { id: 'other', media: { uri: 'file:///other.jpg' } };
  const render = editor([initial, adjacent]);
  let state = render();
  assert.equal(state.canReset, false);
  state.updateCurrent({ media: { kind: 'photo', uri: 'file:///effect.jpg', effect: 'crown' },
    layers: [{ id: 'text' }], drawing: [{ id: 'stroke' }], music: { trackId: 'song' },
    filterId: 'warm', photoDurationMs: 12000, mediaTransform: { x: 800, y: 700, scale: 2, rotation: 35 } });
  state = render();
  const edited = state.current;
  assert.equal(state.canReset, true);
  state.resetCurrent();
  state = render();
  assert.strictEqual(state.current, initial);
  assert.strictEqual(state.items[1], adjacent);
  assert.equal(state.canReset, false);
  assert.equal(state.canUndo, true);
  state.resetCurrent();
  state = render();
  state.undo();
  assert.strictEqual(render().current, edited, 'a repeated reset must not add an empty undo step');
});

test('Reset restores video source, trim and sound only for the selected story', () => {
  const first = { id: 'first', media: { kind: 'photo' }, layers: [] };
  const video = { id: 'video', media: { kind: 'video', uri: 'file:///video.mp4' },
    trim: { startMs: 0, endMs: 16000 }, muted: false, music: null, layers: [] };
  const render = editor([first, video]);
  let state = render();
  state.setIndex(1);
  state = render();
  state.updateCurrent({ media: { kind: 'video', uri: 'file:///loop.mp4' },
    trim: { startMs: 4000, endMs: 9000 }, muted: true, layers: [{ id: 'captions' }] });
  state = render();
  state.resetCurrent();
  state = render();
  assert.strictEqual(state.items[0], first);
  assert.strictEqual(state.current, video);
  assert.equal(state.index, 1);
});

test('Reset on a story without edits leaves undo empty', () => {
  const initial = { id: 'photo', layers: [] };
  const render = editor([initial]);
  render().resetCurrent();
  const state = render();
  assert.strictEqual(state.current, initial);
  assert.equal(state.canUndo, false);
  assert.equal(state.canReset, false);
});
