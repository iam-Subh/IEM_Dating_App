const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

function wheel({options = Array.from({length: 32}, (_, i) => ({value: String(i), label: String(i)})), value = '0', virtualized = true} = {}) {
  const changed = [], previews = [], moving = [], scrolls = [], timers = new Map();
  let timerId = 0;
  const react = {
    createElement: (type, props, ...children) => ({type, props: props || {}, children}),
    useRef: value => ({current: value === null ? {scrollToOffset: args => scrolls.push(args), scrollTo: args => scrolls.push(args)} : value}),
    useEffect: () => {},
    useMemo: fn => fn(),
    useState: value => [value, () => {}],
  };
  const native = {
    View: 'View', Text: 'Text', Pressable: 'Pressable', Platform: {OS: 'android'},
    StyleSheet: {create: value => value},
    InteractionManager: {runAfterInteractions: () => ({cancel() {}})},
    Animated: {
      FlatList: 'FlatList', ScrollView: 'ScrollView', Text: 'AnimatedText',
      Value: class {interpolate() {return 1;}},
      event: (_, config) => config.listener,
    },
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/features/auth/onboarding/BirthdayDateWheel.tsx'), 'utf8');
  const compiled = ts.transpileModule(source + '\nexport {DateWheel};', {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true},
  }).outputText;
  const module = {exports: {}};
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require: id => id === 'react' ? react : id === 'react-native' ? native : {},
    setTimeout: fn => {timers.set(++timerId, fn); return timerId;},
    clearTimeout: id => timers.delete(id),
  });
  const tree = module.exports.DateWheel({label: 'Day', options, value, virtualized, disabled: false, onChange: value => changed.push(value), onPreview: value => previews.push(value), onMoving: value => moving.push(value)});
  const find = node => ['FlatList', 'ScrollView'].includes(node?.type) ? node : (node?.children || []).flat(Infinity).map(find).find(Boolean);
  const scroller = find(tree);
  return {type: scroller.type, events: scroller.props, children: (scroller.children || []).flat(Infinity), changed, previews, moving, scrolls, flush: () => {const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn());}};
}
const at = y => ({nativeEvent: {contentOffset: {y}}});

test('a wheel inside a scrolling form uses a nested plain scroller and commits the final value', () => {
  const w = wheel({virtualized: false, value: '4'});
  assert.equal(w.type, 'ScrollView');
  assert.equal(w.events.nestedScrollEnabled, true);
  assert.equal(w.events.contentOffset.y, 4 * 48);
  w.events.onScrollBeginDrag();
  w.events.onScroll(at(288));
  assert.deepEqual(w.previews, ['6']);
  w.events.onScrollEndDrag(at(288));
  w.flush();
  assert.deepEqual(w.changed, ['6']);
});

test('a plain year wheel opens with only the rows near the saved value, at the same offsets', () => {
  const options = Array.from({length: 107}, (_, i) => ({value: String(2026 - i), label: String(2026 - i)}));
  const w = wheel({options, value: '2000', virtualized: false});
  const [before, ...rest] = w.children.filter(Boolean);
  const after = rest.pop();
  assert.equal(rest.length, 11);
  assert.equal(before.props.style.height, 23 * 48);
  assert.equal(rest[5].children[0].children[0], '2000');
  assert.equal(before.props.style.height + rest.length * 48 + after.props.style.height, (107 + 4) * 48);
});

test('the year wheel opens at the saved value with a bounded initial render', () => {
  const options = Array.from({length: 107}, (_, i) => ({value: String(2026 - i), label: String(2026 - i)}));
  const w = wheel({options, value: '2000'});
  assert.equal(w.events.initialNumToRender, 9);
  assert.equal(w.events.data[w.events.initialScrollIndex + 2].value, '2000');
  const offset = w.events.getItemLayout(w.events.data, w.events.initialScrollIndex).offset;
  assert.equal(offset, 26 * 48);
  assert.equal(w.events.contentOffset.y, offset);
  assert.equal(w.events.data[0], null);
  assert.equal(w.events.data.at(-1), null);
});

test('fast flick commits the final row without forcing a scroll or updating the date during motion', () => {
  const w = wheel();
  w.events.onScrollBeginDrag();
  w.events.onScroll(at(96));
  w.events.onScrollEndDrag(at(96));
  w.events.onMomentumScrollBegin();
  w.events.onScroll(at(240));
  w.flush();
  assert.deepEqual(w.changed, []);
  w.events.onMomentumScrollEnd(at(384));
  assert.deepEqual(w.changed, ['8']);
  assert.deepEqual(w.scrolls, []);
  assert.deepEqual(w.moving, [true, false]);
});

test('slow drag without a momentum event commits the latest snapped offset', () => {
  const w = wheel();
  w.events.onScrollBeginDrag();
  w.events.onScrollEndDrag(at(61));
  w.events.onScroll(at(96));
  w.flush();
  assert.deepEqual(w.changed, ['2']);
  assert.deepEqual(w.scrolls, []);
});

test('a second drag cancels the pending selection from the first drag', () => {
  const w = wheel();
  w.events.onScrollBeginDrag();
  w.events.onScrollEndDrag(at(48));
  w.events.onScrollBeginDrag();
  w.flush();
  assert.deepEqual(w.changed, []);
  w.events.onScrollEndDrag(at(192));
  w.flush();
  assert.deepEqual(w.changed, ['4']);
});


test('age preview follows the centre row during a flick without committing or forcing motion', () => {
  const w = wheel();
  w.events.onScrollBeginDrag();
  w.events.onScroll(at(48));
  w.events.onScroll(at(51));
  w.events.onScroll(at(96));
  assert.deepEqual(w.previews, ['1', '2']);
  assert.deepEqual(w.changed, []);
  assert.deepEqual(w.scrolls, []);
});
