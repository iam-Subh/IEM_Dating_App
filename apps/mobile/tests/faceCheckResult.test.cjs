const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function result(status, rows, onboarding = true) {
  const react = {createElement: (type, props, ...children) => ({type, props: {...props, children}})};
  const modules = {
    react: {...react, default: react},
    'react-native': {Image: 'Image', ScrollView: 'ScrollView', StatusBar: 'StatusBar', Text: 'Text', View: 'View',
      StyleSheet: {create: value => value}, useWindowDimensions: () => ({height: 844, fontScale: 1})},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 24, bottom: 24})},
    '@expo/vector-icons': {Ionicons: 'Icon'}, 'react-native-svg': {},
    '../auth/onboarding/ConnectionDesign': {TapChoice: 'Button', connectionColors: {}},
  };
  const exported = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/features/verification/FaceCheckResult.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020}}).outputText,
    {exports: exported, require: name => modules[name]});
  let continued = 0;
  const tree = exported.FaceCheckResult({status, rows, onboarding, onContinue() {continued++;}});
  const nodes = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    nodes.push(node);
    for (const child of node.props?.children?.flat(Infinity) ?? []) visit(child);
  }
  visit(tree);
  const text = nodes.filter(node => node.type === 'Text').map(node => node.props.children.flat(Infinity).join('')).join(' ');
  return {nodes, text, continued: () => continued};
}

const rows = [
  {url: 'photo', kind: 'photo', name: 'Main photo', text: 'Matches you', ok: true},
  {url: 'video', kind: 'video', name: 'Your video', text: 'Matches you', ok: true},
];

test('verified result shows actual media results and returns through Continue', () => {
  const page = result('verified', rows);
  assert.match(page.text, /Verified\.\nReally you\./);
  assert.match(page.text, /2\/2 complete/);
  assert.match(page.text, /College email verification is a separate check/);
  assert.equal(page.nodes.filter(node => node.type === 'Image').length, 1);
  page.nodes.find(node => node.props.accessibilityLabel === 'Continue').props.onPress();
  assert.equal(page.continued(), 1);
});

test('pending result keeps pending media distinct from confirmed media', () => {
  const page = result('pending_review', [{...rows[0], ok: null, text: 'Being checked by our team'}, rows[1]]);
  assert.match(page.text, /REVIEW IN PROGRESS/);
  assert.match(page.text, /Being checked by our team/);
  assert.match(page.text, /1\/2 complete/);
  assert.doesNotMatch(page.text, /Verified\.\nReally you\./);
  assert.ok(page.nodes.some(node => node.type === 'Icon' && node.props.name === 'time-outline'));
  page.nodes.find(node => node.props.accessibilityLabel === 'Close face check result').props.onPress();
  assert.equal(page.continued(), 1);
});

test('an empty result does not invent media matches and app entry uses Done', () => {
  const page = result('pending_review', [], false);
  assert.doesNotMatch(page.text, /\d\/\d complete|Your profile media|Matches you/);
  assert.match(page.text, /You can continue using the app/);
  assert.ok(page.nodes.some(node => node.props.accessibilityLabel === 'Done'));
});
