const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, modules, extra = {}) {
  const exported = {};
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React,
  }}).outputText, {exports: exported, require: name => modules[name], ...extra});
  return exported;
}

function sheet(params, degree = false) {
  const actions = [], frames = [];
  let closes = 0;
  const react = {
    useEffect() {}, useRef: current => ({current}), useState: value => [value, () => {}],
    createElement: (type, props, ...children) => ({type, props: {...props, children}}),
  };
  const modules = {
    react: {...react, default: react},
    'react-native': {View: 'View', Text: 'Text', ScrollView: 'ScrollView', StyleSheet: {create: value => value}},
    '@expo/vector-icons': {Ionicons: 'Icon'},
    '../../../components/ProfileEditDesign': {EditTapChoice: 'Choice', editColors: {}},
    '@react-navigation/native': {
      useRoute: () => ({params}),
      useNavigation: () => ({dispatch: action => actions.push(action), goBack: () => closes++}),
      CommonActions: {setParams: values => ({type: 'SET_PARAMS', payload: {params: values}})},
    },
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({bottom: 0})},
    '../../../core/profile/profileOptions': load('../src/core/profile/profileOptions.ts', {}),
    '../../../components/ProfileEditForms': {TopicOptionList: 'Options'},
    '../../../features/auth/onboarding/ConnectionDesign': {ConnectionSheetHeader: 'Header'},
  };
  const exports = load(degree ? '../src/screens/main/edit/ProfileDegreeOptionsSheet.tsx' : '../src/screens/main/edit/ProfileTopicOptionsSheet.tsx', modules, {
    requestAnimationFrame: callback => {frames.push(callback); return frames.length;},
  });
  const tree = degree ? exports.ProfileDegreeOptionsSheet() : exports.ProfileTopicOptionsSheet();
  const walk = node => Array.isArray(node) ? node.flatMap(walk)
    : node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : [];
  return {options: walk(tree).find(node => node.type === (degree ? exports.DegreeOptionList : 'Options'))?.props,
    scroll: walk(tree).find(node => node.type === 'ScrollView')?.props, actions, frames, closes: () => closes};
}

test('the native degree sheet returns one selection to Studies and hides its scrollbar', () => {
  const s = sheet({selected: 'B.Tech', degrees: ['B.Tech', 'MBA'], returnKey: 'studies-editor'}, true);
  assert.equal(s.options.selected, 'B.Tech');
  assert.equal(s.scroll.showsVerticalScrollIndicator, false);
  s.options.onSelect('MBA');
  s.options.onSelect('B.Tech');
  assert.equal(s.actions.length, 1);
  assert.equal(s.actions[0].source, 'studies-editor');
  assert.equal(s.actions[0].payload.params.studyDegreeSelection.value, 'MBA');
  s.frames[0]();
  assert.equal(s.closes(), 1);
});

for (const [kind, id, selected] of [['personality', 'communication', 'phone_caller'], ['lifestyle', 'exercise', 'often']]) {
  test(`${kind} sheet returns the answer to the correct editor before closing`, () => {
    const s = sheet({kind, id, selected: '', returnKey: 'profile-editor'});
    s.options.onSelect(selected);
    s.options.onSelect(selected);
    assert.equal(s.actions.length, 1);
    assert.equal(s.actions[0].source, 'profile-editor');
    const answer = s.actions[0].payload.params.profileTopicAnswer;
    assert.equal(answer.kind, kind);
    assert.equal(answer.id, id);
    assert.equal(answer.value, selected);
    assert.equal(s.closes(), 0);
    s.frames[0]();
    assert.equal(s.closes(), 1);
  });
}

test('Clear answer returns an empty value to the editor', () => {
  const s = sheet({kind: 'lifestyle', id: 'exercise', selected: 'often', returnKey: 'lifestyle-editor'});
  s.options.onSelect('');
  assert.equal(s.actions[0].payload.params.profileTopicAnswer.value, '');
  assert.equal(s.actions[0].source, 'lifestyle-editor');
});

test('Education has no option panel in the Personality editor', () => {
  const s = sheet({kind: 'personality', id: 'education', selected: 'bachelor', returnKey: 'personality-editor'});
  assert.equal(s.options, undefined);
  assert.equal(s.actions.length, 0);
});
