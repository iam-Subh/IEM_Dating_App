const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function sheet(field) {
  const gestures = [], frames = [], navigation = [], stateChanges = [], touchValues = [];
  const react = {
    useRef: current => ({current}), useEffect() {},
    useState: initial => [initial, value => stateChanges.push(value)],
    createElement(type, props, ...children) {
      return typeof type === 'function' ? type({...props, children}) : {type, props: {...props, children}};
    },
  };
  const modules = {
    react: {...react, default: react},
    'react-native': {Keyboard: {dismiss() {}}, View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: {create: value => value}},
    'react-native-keyboard-controller': {},
    'react-native-reanimated': {default: {View: 'AnimatedView'}, runOnJS: callback => callback,
      useSharedValue: value => {const shared = {value}; touchValues.push(shared); return shared;},
      useAnimatedStyle: callback => callback(), withTiming: value => value},
    'react-native-gesture-handler': {ScrollView: 'GestureScrollView', GestureDetector: 'GestureDetector', Gesture: {Tap() {
      const callbacks = {}; gestures.push(callbacks);
      const builder = new Proxy({}, {get: (_target, name) => value => {callbacks[name] = value; return builder;}});
      return builder;
    }}},
    '@expo/vector-icons': {}, 'react-native-svg': {},
    '@react-navigation/native': {useNavigation: () => ({popTo: (...args) => navigation.push(args)}), useRoute: () => ({params: {field, value: '', returnTo: 'AcademicSelection'}})},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({bottom: 0})},
    '../../../core/profile/profileOptions': {DEGREE_OPTIONS: ['B.Tech', 'BBA'], ACADEMIC_COURSES: [{title: 'Engineering', courses: ['CSE', 'CSBS']}]},
    './useOnboarding': {},
  };
  const exported = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/features/auth/onboarding/AcademicIntroduction.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React}}).outputText,
    {exports: exported, require: name => modules[name], requestAnimationFrame: callback => {frames.push(callback); return frames.length;}});
  const tree = exported.AcademicOptionsSheet();
  return {tree, gestures, frames, navigation, stateChanges, touchValues};
}

for (const field of ['degree', 'department']) {
  test(`${field} sheet ignores cancelled scroll gestures and still accepts a tap`, () => {
    const s = sheet(field), tap = s.gestures[0];
    assert.equal(s.tree.type, 'GestureScrollView');
    assert.equal(tap.maxDistance, 8);
    tap.onBegin();
    assert.equal(s.touchValues[0].value, 1);
    assert.equal(s.stateChanges.length, 0);
    tap.onEnd({}, false);
    tap.onFinalize();
    assert.equal(s.touchValues[0].value, 0);
    assert.equal(s.stateChanges.length, 0);
    assert.equal(s.frames.length, 0);
    assert.equal(s.navigation.length, 0);
    tap.onEnd({}, true);
    assert.equal(s.frames.length, 1);
    s.frames[0]();
    assert.equal(s.navigation[0][0], 'AcademicSelection');
    assert.equal(s.navigation[0][1].academicSelection.field, field);
    assert.equal(s.navigation[0][1].academicSelection.value, field === 'degree' ? 'B.Tech' : 'CSE');
  });
}
