const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function screen(platform = 'android', onStart = async () => {}) {
  const state = [];
  let cursor = 0;
  let starts = 0;
  let backs = 0;
  const react = {
    createElement: (type, props, ...children) => ({type, props: {...props, children}}),
    Fragment: 'Fragment',
    useState(value) {const index = cursor++; if (!(index in state)) state[index] = value; return [state[index], next => {state[index] = typeof next === 'function' ? next(state[index]) : next;}];},
    useRef(value) {const index = cursor++; return state[index] ??= {current: value};},
  };
  const modules = {
    react: {...react, default: react},
    'react-native': {ActivityIndicator: 'Spinner', Image: 'Image', Modal: 'Modal', Platform: {OS: platform}, ScrollView: 'ScrollView', StatusBar: 'StatusBar', Text: 'Text', View: 'View', StyleSheet: {create: value => value, absoluteFill: {}}, useWindowDimensions: () => ({height: 844, fontScale: 1})},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 24, bottom: 24})},
    '@expo/vector-icons': {Ionicons: 'Icon'},
    '../auth/onboarding/ConnectionDesign': {TapChoice: 'Button', connectionColors: {}, connectionStyles: {}},
    './FaceTurnIllustration': {FaceTurnIllustration: 'FaceTurnIllustration'},
  };
  const exported = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/features/verification/FaceCheckIntroduction.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020}}).outputText,
    {exports: exported, require: name => {
      if (name.endsWith('.png')) return 'illustration';
      if (!modules[name]) throw new Error(name);
      return modules[name];
    }});
  let tree;
  const render = () => {
    cursor = 0;
    tree = exported.FaceCheckIntroduction({onboarding: true, onBack() {backs++;}, async onStart() {starts++; await onStart();}});
  };
  const find = (predicate, node = tree) => {
    if (!node || typeof node !== 'object') return;
    if (predicate(node)) return node;
    if (node.type === 'Modal' && !node.props.visible) return;
    for (const child of node.props?.children?.flat(Infinity) || []) {const result = find(predicate, child); if (result) return result;}
  };
  render();
  return {
    render,
    tap(label) {const button = find(node => node.props?.accessibilityLabel === label); assert.ok(button, label); button.props.onPress(); render();},
    modal: () => find(node => node.type === 'Modal').props,
    count: () => ({starts, backs}),
  };
}

test('starting first opens privacy details and closing them does not start the camera', () => {
  const page = screen();
  page.tap('Start face check');
  assert.equal(page.modal().visible, true);
  assert.equal(page.count().starts, 0);
  page.tap('Close privacy details');
  assert.equal(page.modal().visible, false);
  assert.equal(page.count().starts, 0);
});

test('reading privacy details or going back does not start a face check', () => {
  const page = screen();
  page.tap('How we use your selfie. Read privacy details');
  assert.equal(page.count().starts, 0);
  page.tap('Close privacy details');
  page.tap('Back');
  assert.deepEqual(page.count(), {starts: 0, backs: 1});
});

test('agreement starts only once while a camera permission request is pending', async () => {
  let finish;
  const pending = new Promise(resolve => {finish = resolve;});
  const page = screen('android', () => pending);
  page.tap('Start face check');
  page.tap('I agree. Start face check');
  assert.equal(page.modal().visible, false);
  assert.equal(page.count().starts, 1);
  // A queued duplicate press must also be rejected by the guard.
  page.tap('Start face check');
  page.tap('I agree. Start face check');
  assert.equal(page.count().starts, 1);
  finish();
  await pending;
});

test('iOS waits for the privacy modal to close before requesting camera access', () => {
  const page = screen('ios');
  page.tap('Start face check');
  page.tap('I agree. Start face check');
  assert.equal(page.count().starts, 0);
  page.modal().onDismiss();
  assert.equal(page.count().starts, 1);
  page.modal().onDismiss();
  assert.equal(page.count().starts, 1);
});
