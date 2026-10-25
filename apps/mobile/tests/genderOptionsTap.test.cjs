const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function render(screen, dark = false) {
  const gestures = [], touchValues = [], stateChanges = [], frames = [], navigation = [];
  const react = {
    useRef: current => ({current}), useEffect() {}, useLayoutEffect() {},
    useState: initial => [initial, value => stateChanges.push(value)],
    createElement(type, props, ...children) {
      return typeof type === 'function' ? type({...props, children}) : {type, props: {...props, children}};
    },
  };
  const modules = {
    react: {...react, default: react},
    'react-native': {View: 'View', Text: 'Text', Pressable: 'Pressable', StatusBar: 'StatusBar', Platform: {OS: 'android'},
      StyleSheet: {create: value => value}, useWindowDimensions: () => ({height: 800})},
    'react-native-reanimated': {default: {View: 'AnimatedView'}, runOnJS: callback => callback,
      useSharedValue: value => {const shared = {value}; touchValues.push(shared); return shared;},
      useAnimatedStyle: callback => callback(), withTiming: value => value},
    'react-native-gesture-handler': {ScrollView: 'GestureScrollView', GestureDetector: 'GestureDetector', Gesture: {Tap() {
      const callbacks = {}; gestures.push(callbacks);
      const builder = new Proxy({}, {get: (_target, name) => value => {callbacks[name] = value; return builder;}});
      return builder;
    }}},
    '@expo/vector-icons': {}, 'react-native-svg': {default: 'Svg', Path: 'Path'},
    '@react-navigation/native': {useNavigation: () => ({popTo: (...args) => navigation.push(args),
      dispatch: action => navigation.push(action), goBack: () => navigation.push('back')}),
      CommonActions: {setParams: params => ({type: 'SET_PARAMS', payload: {params}})},
      useRoute: () => ({params: {gender: 'Man', detail: '', returnKey: 'edit-gender'}})},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 0, bottom: 0})},
    '../../../core/profile/profileOptions': {GENDER_OPTIONS: [{id: 'Man', label: 'Man'}, {id: 'Woman', label: 'Woman'}],
      GENDER_DETAILS: {Man: [{label: 'Cis man', description: 'Description'}]}},
    './useOnboarding': {useOnboarding: () => ({data: {gender: 'Man'}, route: {params: {}}, navigation: {}})},
    './ConnectionDesign': {},
  };
  const shared = {};
  const sharedSource = fs.readFileSync(path.join(__dirname, '../src/features/auth/onboarding/GenderForm.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(sharedSource, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React}}).outputText,
    {exports: shared, require: name => modules[name]});
  modules['./GenderForm'] = shared;
  const exported = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/features/auth/onboarding/GenderIntroduction.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React}}).outputText,
    {exports: exported, require: name => modules[name], requestAnimationFrame: callback => {frames.push(callback); return frames.length;}});
  const tree = exported[screen]({dark});
  return {tree, gestures, touchValues, stateChanges, frames, navigation};
}

test('Edit Gender returns a chosen label to its parent before dismissing the sheet', () => {
  const s = render('GenderLabelsSheet', true);
  s.gestures[1].onEnd({}, true);
  assert.equal(s.navigation.length, 0);
  s.frames[0]();
  assert.equal(s.navigation[0].type, 'SET_PARAMS');
  assert.equal(s.navigation[0].source, 'edit-gender');
  assert.equal(s.navigation[0].payload.params.genderLabelSelection.gender, 'Man');
  assert.equal(s.navigation[0].payload.params.genderLabelSelection.detail, 'Cis man');
  assert.equal(s.navigation[1], 'back');
});

for (const screen of ['GenderIntroduction', 'GenderLabelsSheet']) {
  test(`${screen} gives touch feedback without selecting during a drag`, () => {
    const s = render(screen), tap = s.gestures[1];
    assert.equal(tap.enabled, true);
    assert.equal(tap.maxDistance, 8);
    if (screen === 'GenderLabelsSheet') assert.equal(s.tree.type, 'GestureScrollView');
    tap.onBegin();
    assert.equal(s.touchValues[1].value, 1);
    assert.equal(s.stateChanges.length, 0);
    tap.onEnd({}, false);
    tap.onFinalize();
    assert.equal(s.touchValues[1].value, 0);
    assert.equal(s.stateChanges.length, 0);
    assert.equal(s.frames.length, 0);
    assert.equal(s.navigation.length, 0);
    tap.onEnd({}, true);
    if (screen === 'GenderIntroduction') {
      assert.equal(s.stateChanges[0], 'Woman');
    } else {
      assert.equal(s.stateChanges[0], 'Cis man');
      assert.equal(s.frames.length, 1);
      s.frames[0]();
      assert.equal(s.navigation[0][0], 'GenderSelection');
      assert.equal(s.navigation[0][1].genderLabelSelection.detail, 'Cis man');
    }
  });
}
