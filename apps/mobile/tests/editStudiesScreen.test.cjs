const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, modules = {}) {
  const exported = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React},
  }).outputText, {exports: exported, require: name => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected import: ${name}`);
    return modules[name];
  }});
  return exported;
}

function editor(params, user = {}, success = true, platform = 'web') {
  const cells = [], writes = [], updates = [], destinations = [];
  let cursor = 0, closes = 0;
  const react = {
    createElement: (type, props, ...children) => ({type, props: {...props, children}}),
    useRef(current) {const index = cursor++; cells[index] ??= {current}; return cells[index];},
    useLayoutEffect(callback, deps) {
      const index = cursor++;
      if (!cells[index] || deps.some((value, i) => value !== cells[index].deps[i])) {
        cells[index] = {deps}; callback();
      }
    },
    useState(initial) {
      const index = cursor++;
      cells[index] ??= {value: initial};
      return [cells[index].value, value => {cells[index].value = typeof value === 'function' ? value(cells[index].value) : value;}];
    },
  };
  const modules = {
    react: {...react, default: react},
    'react-native': {Keyboard: {dismiss() {}}, KeyboardAvoidingView: 'KeyboardView', Modal: 'Modal', Platform: {OS: platform}, Pressable: 'Pressable',
      ScrollView: 'Scroll', StyleSheet: {create: styles => styles}, Text: 'Text', TextInput: 'Input', View: 'View', useWindowDimensions: () => ({width: 400, height: 800})},
    '@expo/vector-icons': {Ionicons: 'Icon'},
    '@react-navigation/native': {useNavigation: () => ({goBack: () => closes++, navigate: (name, params) => destinations.push({name, params})}), useRoute: () => ({key: 'studies-editor', params})},
    'react-redux': {useDispatch: () => action => updates.push(action), useSelector: fn => fn({auth: {user}})},
    '../../../components/EditScreenHeader': {EditScreenHeader: 'Header'},
    '../../../components/EditSaveFooter': {EditSaveFooter: 'Footer'},
    '../../../components/ProfileEditDesign': {EditTapChoice: 'Choice', editColors: {}},
    '../../../components/ProfileEditForms': {FormTitle: 'Heading', formStyles: {}},
    '../../../core/profile/profileOptions': {DEGREE_OPTIONS: ['B.Tech', 'MBA']},
    '../../../services/api': {api: {put: async (url, data) => {writes.push({url, data}); return {data: {success, data, message: success ? '' : 'Save failed'}};}}},
    '../../../store/authSlice': {updateUser: data => ({type: 'updateUser', data})},
    './studiesModel': load('../src/screens/main/edit/studiesModel.ts'),
    './ProfileDegreeOptionsSheet': {DegreeOptionList: 'DegreeOptions'},
  };
  const {EditStudiesScreen} = load('../src/screens/main/edit/EditStudiesScreen.tsx', modules);
  const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
  function render() {
    cursor = 0;
    const tree = nodes(EditStudiesScreen());
    return {footer: tree.find(node => node.type === 'Footer').props,
      field: label => tree.find(node => node.type === 'Input' && node.props.accessibilityLabel === label).props,
      degreeButton: tree.find(node => node.type === 'Choice' && String(node.props.accessibilityLabel).startsWith('Degree type')).props,
      degreeOptions: tree.filter(node => node.type === 'DegreeOptions').flatMap(node => node.props.degrees.map(value => ({
        accessibilityLabel: value, accessibilityState: {checked: node.props.selected === value}, onPress: () => node.props.onSelect(value),
      }))),
      sheetOpen: tree.find(node => node.type === 'Modal')?.props.visible ?? false,
      alerts: tree.filter(node => node.type === 'Text' && node.props.accessibilityRole === 'alert')};
  }
  const change = (label, value) => render().field(label).onChangeText(value);
  return {render, change, writes, updates, destinations,
    receiveDegree: value => {params = {...params, studyDegreeSelection: {value}}; render();}, closes: () => closes};
}

const pickDegree = (s, label) => {
  s.render().degreeButton.onPress();
  const option = s.render().degreeOptions.find(item => item.accessibilityLabel === label);
  assert.ok(option, `degree option ${label}`);
  option.onPress();
};

test('Android opens the native degree sheet and saves its returned selection', async () => {
  const s = editor({currentDegree: 'B.Tech', currentYearOfStudy: 3, currentGraduationYear: 2027}, {}, true, 'android');
  s.render().degreeButton.onPress();
  assert.equal(s.render().sheetOpen, false);
  assert.equal(s.destinations[0].name, 'ProfileDegreeOptions');
  assert.equal(s.destinations[0].params.returnKey, 'studies-editor');
  assert.equal(s.destinations[0].params.selected, 'B.Tech');
  s.receiveDegree('MBA');
  assert.equal(s.render().degreeButton.accessibilityLabel, 'Degree type: MBA');
  await s.render().footer.onSave();
  assert.equal(s.writes[0].data.degree, 'MBA');
});

test('Studies saves the degree from the list and both years in one profile update', async () => {
  const s = editor({currentDegree: 'B.Tech', currentYearOfStudy: 3, currentGraduationYear: 2027});
  assert.equal(s.render().footer.hasUnsavedChanges, false);
  pickDegree(s, 'MBA');
  assert.equal(s.render().sheetOpen, false, 'the sheet closes on a choice');
  s.change('Year of study', '5');
  s.change('Graduation year', '2037');
  await s.render().footer.onSave();
  assert.equal(s.writes.length, 1);
  assert.equal(s.writes[0].url, '/profile');
  assert.equal(s.writes[0].data.degree, 'MBA');
  assert.equal(s.writes[0].data.yearOfStudy, 5);
  assert.equal(s.writes[0].data.graduationYear, 2037);
  assert.equal(s.updates.length, 1);
  assert.equal(s.closes(), 1);
});

test('A degree saved before the list existed stays choosable', () => {
  const s = editor({currentDegree: 'Bachelor of Architecture', currentYearOfStudy: 3, currentGraduationYear: 2027});
  s.render().degreeButton.onPress();
  const labels = s.render().degreeOptions.map(item => item.accessibilityLabel);
  assert.deepEqual(labels, ['Bachelor of Architecture', 'B.Tech', 'MBA']);
  assert.equal(s.render().degreeOptions[0].accessibilityState.checked, true);
});

test('Invalid year input shows a field error and sends no profile update', async () => {
  const s = editor({currentDegree: 'B.Tech', currentYearOfStudy: 3, currentGraduationYear: 2027});
  s.change('Graduation year', '202');
  await s.render().footer.onSave();
  assert.equal(s.writes.length, 0);
  assert.equal(s.closes(), 0);
  assert.ok(s.render().alerts.length > 0);
});

test('A cleared graduation year shows an error; an empty year of study is allowed', async () => {
  const s = editor({currentDegree: 'MBA', currentYearOfStudy: null, currentGraduationYear: 2027}, {yearOfStudy: 3});
  assert.equal(s.render().field('Year of study').value, '');
  s.change('Graduation year', '');
  await s.render().footer.onSave();
  assert.equal(s.writes.length, 0);
  assert.equal(s.closes(), 0);
  assert.equal(s.render().alerts.length, 1);
  s.change('Graduation year', '2028');
  await s.render().footer.onSave();
  assert.equal(s.writes.length, 1);
  assert.equal('yearOfStudy' in s.writes[0].data, false);
});

test('A rejected save keeps the study entries and the editor open', async () => {
  const s = editor({currentDegree: 'B.Tech', currentYearOfStudy: 3, currentGraduationYear: 2027}, {}, false);
  pickDegree(s, 'MBA');
  await s.render().footer.onSave();
  assert.equal(s.closes(), 0);
  assert.equal(s.updates.length, 0);
  assert.equal(s.render().degreeButton.accessibilityLabel, 'Degree type: MBA');
  assert.equal(s.render().footer.error, 'Save failed');
});
