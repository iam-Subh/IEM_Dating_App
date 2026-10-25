const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, modules = {}) {
  const exported = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/features/verification', file), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020}}).outputText,
    {exports: exported, require: name => modules[name]});
  return exported;
}
const model = load('mediaCorrectionModel.ts');
const items = [
  {url: 'main', kind: 'photo', main: true, status: 'no_face'},
  {url: 'scenery', kind: 'photo', main: false, status: 'no_face'},
  {url: 'other', kind: 'photo', main: false, status: 'mismatch'},
  {url: 'pending', kind: 'photo', main: false, status: 'unsure'},
  {url: 'video', kind: 'video', main: false, status: 'mismatch'},
];

test('one model includes all three failed media types and keeps allowed no-face photos', () => {
  const result = model.mediaCorrections(items, 'main_photo');
  assert.deepEqual(Array.from(result.corrections, item => item.name), ['Main photo', 'Photo 3', 'Profile video']);
  assert.equal(result.confirmed, 1);
  assert.equal(result.pending, 1);
  assert.match(result.corrections[0].reason, /find a clear face/);
  assert.match(result.corrections[1].hint, /remove it in photo options/);
  assert.doesNotMatch(result.corrections[0].hint, /remove/);
});

test('a missing main photo gets an Add action with no invented image', () => {
  const result = model.mediaCorrections([], 'main_photo');
  assert.equal(result.corrections.length, 1);
  assert.equal(result.corrections[0].url, '');
  assert.equal(result.corrections[0].action, 'Add main photo');
  assert.match(result.corrections[0].reason, /missing/);
});

test('one expanded card keeps all three types visible and actions use the selected item', () => {
  let active = 0;
  const react = {createElement: (type, props, ...children) => ({type, props: {...props, children}}), useState: () => [active, value => {active = value;} ]};
  const {MediaCorrectionPage} = load('MediaCorrectionPage.tsx', {
    react: {...react, default: react},
    'react-native': {Image: 'Image', ScrollView: 'ScrollView', StatusBar: 'StatusBar', Text: 'Text', View: 'View', StyleSheet: {create: value => value}, useWindowDimensions: () => ({height: 844})},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 24, bottom: 24})},
    '@expo/vector-icons': {Ionicons: 'Icon'}, 'react-native-svg': {},
    '../auth/onboarding/ConnectionDesign': {TapChoice: 'Button', connectionColors: {}},
    './mediaCorrectionModel': model,
  });
  const edits = [];
  let closed = 0;
  const render = () => MediaCorrectionPage({items, reason: 'main_photo', onEdit: item => edits.push(item), onClose: () => closed++});
  const nodes = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    nodes.push(node);
    for (const child of node.props?.children?.flat(Infinity) ?? []) visit(child);
  }
  visit(render());
  const button = label => nodes.find(node => node.props.accessibilityLabel === label);
  button('Edit main photo').props.onPress();
  assert.equal(edits[0].url, 'main');
  assert.ok(button('View correction: Photo 3'));
  button('View correction: Profile video').props.onPress();
  nodes.length = 0;
  visit(render());
  button('Edit video: Profile video').props.onPress();
  assert.equal(edits[1].url, 'video');
  button('Edit video').props.onPress();
  assert.equal(edits[2].url, 'video');
  button('View correction: Photo 3').props.onPress();
  nodes.length = 0;
  visit(render());
  button('Edit photo: Photo 3').props.onPress();
  assert.equal(edits[3].url, 'other');
  button('Close media correction').props.onPress();
  assert.equal(closed, 1);
  assert.equal(nodes.filter(node => node.type === 'Image').length, 2);
});
