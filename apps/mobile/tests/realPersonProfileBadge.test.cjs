const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/verification/RealPerson.tsx'), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true},
}).outputText;

function screen(initial) {
  let status = initial, removed = false, reloads = 0;
  const destinations = [];
  const react = {createElement: (type, props, ...children) => ({type, props: {...props, children}})};
  const modules = {
    react: {...react, default: react},
    'react-native': {Pressable: 'Button', StyleSheet: {create: value => value}},
    'react-native-svg': {__esModule: true, default: 'Svg', Circle: 'Circle', Path: 'Path'},
    '@expo/vector-icons': {},
    '@react-navigation/native': {useNavigation: () => ({navigate: name => destinations.push(name)})},
    '../../services/api': {api: {delete: async url => {assert.equal(url, '/verification/face'); removed = true;}}},
    './useVerificationStatus': {
      useVerificationStatus: () => status,
      refreshVerificationStatus: async () => {assert.equal(removed, true); status = {...status, realPersonVerified: false};},
    },
    './VerifyNudge': {}, './VerificationPreviewContext': {},
  };
  const exported = {};
  vm.runInNewContext(source, {exports: exported, require: name => modules[name]});
  return {badge: () => exported.RealPersonProfileBadge(), destinations,
    remove: () => exported.useRealPersonActions(() => {reloads++;}).remove(), reloads: () => reloads};
}

test('the grey badge opens the missing step of the blue badge, the college email first', () => {
  const cases = [
    [{verified: false, realPersonVerified: false}, 'Get your blue badge: verify your college email', 'VerifyCollege'],
    [{verified: false, realPersonVerified: true}, 'Get your blue badge: verify your college email', 'VerifyCollege'],
    [{verified: true, realPersonVerified: false}, 'Get your blue badge: complete your selfie check', 'RealPersonCheck'],
  ];
  for (const [status, label, destination] of cases) {
    const s = screen(status);
    const badge = s.badge();
    assert.equal(badge.props.accessibilityLabel, label);
    badge.props.onPress();
    assert.deepEqual(s.destinations, [destination]);
  }
});

test('no grey badge once both steps are done, or while the status is unknown', () => {
  assert.equal(screen({verified: true, realPersonVerified: true}).badge(), null);
  assert.equal(screen(null).badge(), null);
});

test('removing the real-person check refreshes shared status and restores the same shortcut', async () => {
  const s = screen({verified: true, realPersonVerified: true});
  assert.equal(s.badge(), null);
  await s.remove();
  assert.equal(s.reloads(), 1);
  const badge = s.badge();
  assert.ok(badge);
  badge.props.onPress();
  assert.deepEqual(s.destinations, ['RealPersonCheck']);
});
