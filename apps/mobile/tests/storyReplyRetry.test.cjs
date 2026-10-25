const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness(onSend) {
  const hooks = [];
  let cursor = 0, blurred = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
  };
  const jsx = (type, props) => ({ type, props });
  const imports = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Text: 'Text', TextInput: 'Input', View: 'View', Pressable: 'Button', Image: 'Image', StyleSheet: { create: value => value } },
    'react-native-reanimated': { __esModule: true, default: { View: 'Animated' }, useAnimatedStyle: read => read(), useSharedValue: value => ({ value }), withSequence: value => value, withSpring: value => value, withTiming: value => value },
    'react-native-keyboard-controller': { KeyboardStickyView: 'KeyboardStickyView' },
    '@expo/vector-icons': { Ionicons: 'Icon' },
  };
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../src/features/stories/components/StoryFooter.tsx'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(compiled, { module, exports: module.exports, require: name => {
    if (!(name in imports)) throw new Error(name);
    return imports[name];
  } });
  return {
    render: () => {
      cursor = 0;
      return module.exports.StoryFooter({ liked: false, bottomInset: 0, inputRef: { current: { blur: () => blurred++ } }, onToggleLike() {}, onSend, onReact() {}, onFocusChange() {} });
    },
    blurCount: () => blurred,
  };
}
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) {
    const result = find(child, predicate);
    if (result) return result;
  }
  return null;
}

test('a failed Story reply retains the draft, blocks duplicate taps, and clears only after success', async () => {
  let resolve, sends = 0;
  const pending = new Promise(done => { resolve = done; });
  const h = harness(async () => { sends++; return sends === 1 ? pending : true; });
  find(h.render(), node => node.type === 'Input').props.onChangeText('Hello ❤️');
  const send = find(h.render(), node => node.props?.accessibilityLabel === 'Send reply');
  const first = send.props.onPress();
  await send.props.onPress();
  assert.equal(sends, 1);
  assert.equal(find(h.render(), node => node.type === 'Input').props.value, 'Hello ❤️');
  resolve(false);
  await first;
  assert.equal(find(h.render(), node => node.type === 'Input').props.value, 'Hello ❤️');
  assert.equal(h.blurCount(), 0);
  await find(h.render(), node => node.props?.accessibilityLabel === 'Retry reply').props.onPress();
  assert.equal(sends, 2);
  assert.equal(find(h.render(), node => node.type === 'Input').props.value, '');
  assert.equal(h.blurCount(), 1);
});
