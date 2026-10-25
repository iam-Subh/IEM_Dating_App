const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function screen() {
  const cells = [];
  let cursor = 0;
  const puts = [];
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = initial; return [cells[i], (next) => { cells[i] = typeof next === 'function' ? next(cells[i]) : next; }]; },
  };
  const modules = {
    react: { ...react, default: react },
    'react-native': { ActivityIndicator: 'Spinner', Alert: { alert() {} }, Pressable: 'Button', StyleSheet: { create: (v) => v }, Text: 'Text', TextInput: 'Input', View: 'View' },
    '@expo/vector-icons': { Ionicons: 'Icon' },
    '@react-navigation/native': { useNavigation: () => ({ goBack() {} }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    'react-native-keyboard-controller': { KeyboardAwareScrollView: 'Scroll' },
    '../../core/settings/SettingsLayout': { SettingsPage: 'Page', settingsPalette: {} },
    '../../services/api': { api: { put: async (...args) => { puts.push(args); return { data: { data: { revoked: 0 } } }; } } },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/screens/main/ChangePasswordScreen.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: (name) => modules[name] });
  const nodes = (n) => Array.isArray(n) ? n.flatMap(nodes) : n && typeof n === 'object' ? [n, ...nodes(n.props?.children)] : [];
  const render = () => {
    cursor = 0;
    const all = nodes(exports.ChangePasswordScreen());
    // Field is a function component: expand it.
    const expanded = all.flatMap((n) => typeof n.type === 'function' ? [n, ...nodes(n.type(n.props))] : [n]);
    return expanded;
  };
  const field = (label) => render().find((n) => n.type === 'Input' && n.props.accessibilityLabel === label);
  const button = () => render().filter((n) => n.type === 'Button').find((n) => n.props.accessibilityRole === 'button');
  const texts = () => render().filter((n) => n.type === 'Text').map((n) => [].concat(n.props.children).join(''));
  return { field, button, texts, puts };
}

test("new passwords that don't match are shown as such and never sent", async () => {
  const s = screen();
  s.field('Current password').props.onChangeText('oldpass123');
  s.field('New password').props.onChangeText('newpass123');
  s.field('Confirm new password').props.onChangeText('newpass124');
  assert.ok(s.texts().includes("The new passwords don't match."), 'the mismatch is shown under the confirm field');
  assert.equal(s.button().props.disabled, true);
  await s.button().props.onPress();
  assert.equal(s.puts.length, 0, 'nothing is sent');
});

test('matching new passwords are sent once, with the current one', async () => {
  const s = screen();
  s.field('Current password').props.onChangeText('oldpass123');
  s.field('New password').props.onChangeText('newpass123');
  s.field('Confirm new password').props.onChangeText('newpass123');
  assert.ok(s.texts().includes('✓ Passwords match'));
  assert.equal(s.button().props.disabled, false);
  await s.button().props.onPress();
  assert.equal(JSON.stringify(s.puts[0].slice(0, 2)), JSON.stringify(['/auth/account/password', { currentPassword: 'oldpass123', newPassword: 'newpass123' }]));
  assert.equal(s.puts[0][2].timeout, 15000, 'a hung request cannot spin forever');
});
