const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, requireModule = () => { throw new Error('Unexpected import'); }) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText, { exports, require: requireModule });
  return exports;
}
const selection = load('../src/screens/main/edit/heightPickerSelection.ts');

function screen(currentHeight, reply) {
  const writes = [];
  const scrolls = [];
  const alerts = [];
  const dispatched = [];
  let closes = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: value => [value, () => {}],
    useRef: current => ({ current }),
    useCallback: fn => fn,
    memo: component => component,
  };
  const modules = {
    react: { __esModule: true, ...react, default: react },
    'react-native': { View: 'View', Text: 'Text', StyleSheet: { create: styles => styles }, Alert: { alert: (...args) => alerts.push(args) } },
    'react-native-reanimated': {
      __esModule: true,
      default: { FlatList: 'FlatList' },
      useSharedValue: value => ({ value }),
      useAnimatedReaction: () => {},
      useAnimatedScrollHandler: handlers => handlers.onScroll,
      runOnJS: fn => fn,
    },
    'expo-linear-gradient': { LinearGradient: 'Gradient' },
    '@react-navigation/native': {
      useRoute: () => ({ params: { currentHeight } }),
      useNavigation: () => ({ goBack: () => closes++ }),
    },
    'react-redux': { useDispatch: () => action => dispatched.push(action) },
    '../../../components/EditScreenHeader': { EditScreenHeader: 'Header' },
    '../../../components/ProfileEditDesign': {createEditStyles: styles => styles, EditHeading: 'Heading'},
    '../../../components/ProfileEditForms': {FormTitle: 'Heading'},
    '../../../services/api': { api: { put: async (...args) => {
      writes.push(args);
      return typeof reply === 'function' ? reply(...args) : reply ?? { data: { success: true, data: { id: 'account', height: args[1].height } } };
    } } },
    '../../../store/authSlice': { updateUser: value => value },
    './heightPickerSelection': selection,
  };
  const { EditHeightScreen } = load('../src/screens/main/edit/EditHeightScreen.tsx', name => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected import: ${name}`);
    return modules[name];
  });
  function nodes(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return [node, ...nodes(node.props?.children)];
  }
  const tree = nodes(EditHeightScreen());
  const list = tree.find(node => node.type === 'FlatList').props;
  list.ref.current = { scrollToOffset: offset => scrolls.push(offset) };
  return { tree, list, header: tree.find(node => node.type === 'Header').props, writes, scrolls, alerts, dispatched, closes: () => closes };
}

test('the initial height is centered with a small initial batch, including both range limits', () => {
  for (let height = selection.MIN_HEIGHT; height <= selection.MAX_HEIGHT; height++) {
    const { tree, list } = screen(height);
    const offset = list.contentOffset.y;
    assert.equal(list.data[list.initialScrollIndex + 2], height);
    assert.equal(list.getItemLayout(list.data, list.initialScrollIndex).offset, offset);
    assert.ok(list.initialNumToRender >= 5 && list.initialNumToRender <= 10);
    assert.ok(list.windowSize < list.data.length / 5);
    assert.equal(selection.MIN_HEIGHT + selection.heightSelectionIndex(offset), height);
    const highlighted = tree.filter(node => node.props.highlighted);
    assert.equal(highlighted.length, 1);
    assert.equal(highlighted[0].props.height, height);
    assert.equal(list.data[0], null);
    assert.equal(list.data.at(-1), null);
  }
});

test('Save uses the current scroll position during momentum and snaps to the same height', async () => {
  const { list, header, writes, scrolls, dispatched, closes, alerts } = screen(165);
  list.onScroll({ contentOffset: { y: 105.51 * selection.HEIGHT_ROW_SIZE } });
  await header.onSave();
  assert.equal(writes[0][0], '/profile');
  assert.equal(writes[0][1].height, 197);
  assert.equal(scrolls[0].offset, (197 - selection.MIN_HEIGHT) * selection.HEIGHT_ROW_SIZE);
  assert.equal(scrolls[0].animated, false);
  assert.equal(dispatched[0].height, 197);
  assert.equal(closes(), 1);
  assert.equal(alerts.length, 0);
});

test('an account without a height can save the default selection', async () => {
  const editor = screen(undefined);
  assert.equal(editor.header.hasUnsavedChanges, true);
  await editor.header.onSave();
  assert.equal(editor.writes[0][1].height, 165);
  assert.equal(editor.dispatched[0].height, 165);
  assert.equal(editor.closes(), 1);
});

test('an unsuccessful or unconfirmed save leaves the editor open and shows an error', async () => {
  for (const reply of [
    { data: { success: false, message: 'Try again later.' } },
    { data: { success: true, data: {} } },
    { data: { success: true, data: { height: 170 } } },
  ]) {
    const editor = screen(165, reply);
    await editor.header.onSave();
    assert.equal(editor.closes(), 0);
    assert.equal(editor.dispatched.length, 0);
    assert.equal(editor.alerts[0][0], 'Could not save height');
  }
});

test('a network failure shows an error and permits another save attempt', async () => {
  let attempts = 0;
  const editor = screen(165, (_url, body) => {
    if (attempts++ === 0) throw new Error('Connection lost');
    return { data: { success: true, data: { height: body.height } } };
  });
  await editor.header.onSave();
  assert.equal(editor.alerts[0][1], 'Connection lost');
  assert.equal(editor.closes(), 0);
  await editor.header.onSave();
  assert.equal(editor.closes(), 1);
});

test('two Save taps send one height update', async () => {
  const editor = screen(165);
  await Promise.all([editor.header.onSave(), editor.header.onSave()]);
  assert.equal(editor.writes.length, 1);
  assert.equal(editor.closes(), 1);
});
