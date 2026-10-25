const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness({ granted = true, start = async () => ({ fileUri: 'file:///voice.wav' }) } = {}) {
  const slots = [];
  const effects = [];
  const calls = { permission: 0, prepare: 0, start: 0, stop: 0, discarded: [] };
  let cursor = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    forwardRef: fn => fn,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useMemo(fn, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: fn() };
      return slots[index].value;
    },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) effects.push(() => {
        slots[index]?.cleanup?.();
        slots[index] = { deps, cleanup: fn() };
      });
    },
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  };
  react.useCallback = (fn, deps) => react.useMemo(() => fn, deps);
  const recorder = {
    isRecording: false, isPaused: false, analysisData: undefined,
    prepareRecording: async () => { calls.prepare++; },
    startRecording: async () => { calls.start++; const result = await start(); recorder.isRecording = true; return result; },
    stopRecording: async () => { calls.stop++; recorder.isRecording = false; return { fileUri: 'file:///voice.wav' }; },
    pauseRecording: async () => {}, resumeRecording: async () => {},
  };
  const jsx = (type, props) => ({ type, props });
  const imports = {
    react: { ...react, __esModule: true, default: react },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', TextInput: 'Input', TouchableOpacity: 'Button', Pressable: 'Button', ActivityIndicator: 'Spinner', Platform: { OS: 'android' }, Alert: { alert() {} }, AppState: { addEventListener: () => ({ remove() {} }) }, StyleSheet: { create: value => value, absoluteFill: {} } },
    'react-native-reanimated': { __esModule: true, default: { View: 'Animated' }, useSharedValue: value => react.useRef({ value }).current, useAnimatedStyle: fn => fn(), withTiming: value => value, withRepeat: value => value, withSequence: value => value, cancelAnimation() {} },
    'expo-haptics': { impactAsync: async () => {}, ImpactFeedbackStyle: { Medium: 'medium' } },
    'expo-audio': { getRecordingPermissionsAsync: async () => ({ granted }), requestRecordingPermissionsAsync: async () => { calls.permission++; return { status: granted ? 'granted' : 'denied' }; } },
    '@siteed/audio-studio': { AudioStudioModule: { releasePreparedRecording: async () => {} }, useAudioRecorder: () => recorder },
    '../draftMedia': { discardDraftMedia: async uri => calls.discarded.push(uri) },
    '@expo/vector-icons': { Ionicons: 'Icon' },
    '../../../core/theme/colors': { colors: { primary: '#FF5A5F' } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    '@react-navigation/native': { useIsFocused: () => true },
  };
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../src/features/chat/components/VoiceRecordBar.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module, exports: module.exports, console, setInterval: () => 1, clearInterval() {}, require: name => {
      if (!(name in imports)) throw new Error(name);
      return imports[name];
    },
  });
  return {
    calls,
    render: () => {
      cursor = 0;
      const tree = module.exports.VoiceRecordBar({ text: '', setText() {}, onSend() {}, onPickImage() {}, onToggleEmoji() {}, showEmoji: false, isSending: false, onSendVoiceNote() {} }, null);
      while (effects.length) effects.shift()();
      return tree;
    },
    unmount: () => { for (const slot of slots) slot?.cleanup?.(); },
  };
}
function find(tree, label) {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.props?.accessibilityLabel === label) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) { const result = find(child, label); if (result) return result; }
  return null;
}
async function settle() { for (let index = 0; index < 12; index++) await Promise.resolve(); }

test('a permitted microphone prepares before the tap and does not capture audio while idle', async () => {
  let resolve;
  const h = harness({ start: () => new Promise(done => { resolve = done; }) });
  const tree = h.render();
  await settle();
  assert.equal(h.calls.prepare, 1);
  assert.equal(h.calls.start, 0);
  assert.equal(h.calls.permission, 0);
  const mic = find(tree, 'Record a voice message');
  const first = mic.props.onPress();
  assert.equal(h.calls.start, 1);
  await mic.props.onPress();
  assert.equal(h.calls.start, 1);
  resolve({ fileUri: 'file:///voice.wav' });
  await first;
  assert.equal(h.calls.permission, 0);
  h.unmount();
});

test('permission is requested only after a tap; denial starts no recording', async () => {
  const h = harness({ granted: false });
  const tree = h.render();
  await settle();
  assert.equal(h.calls.prepare, 0);
  assert.equal(h.calls.permission, 0);
  await find(tree, 'Record a voice message').props.onPress();
  assert.equal(h.calls.permission, 1);
  assert.equal(h.calls.start, 0);
  h.unmount();
});

test('a recording that finishes starting after the composer unmounts is stopped and discarded', async () => {
  let resolve;
  const h = harness({ start: () => new Promise(done => { resolve = done; }) });
  const tree = h.render();
  await settle();
  const pending = find(tree, 'Record a voice message').props.onPress();
  h.unmount();
  resolve({ fileUri: 'file:///voice.wav' });
  await pending;
  assert.equal(h.calls.stop, 1);
  assert.deepEqual(h.calls.discarded, ['file:///voice.wav']);
});
