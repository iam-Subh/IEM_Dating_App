const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function editor(birthday) {
  const cells = [], imported = [];
  let params = {currentBirthday: birthday}, cursor = 0, changed = false;
  const react = {
    createElement: (type, props, ...children) => ({type, props: {...props, children}}),
    useMemo: callback => callback(),
    useRef(current) {const index = cursor++; cells[index] ??= {current}; return cells[index];},
    useState(initial) {
      const index = cursor++;
      cells[index] ??= {value: initial};
      return [cells[index].value, update => {
        const value = typeof update === 'function' ? update(cells[index].value) : update;
        if (value !== cells[index].value) {cells[index].value = value; changed = true;}
      }];
    },
  };
  const modules = {
    react: {...react, default: react},
    'react-native': {View: 'View', Text: 'Text', ScrollView: 'Scroll', Alert: {}},
    '@react-navigation/native': {useNavigation: () => ({}), useRoute: () => ({params})},
    'react-redux': {useDispatch: () => () => {}},
    'expo-linear-gradient': {LinearGradient: 'Gradient'},
    '../../../components/EditSaveFooter': {EditSaveFooter: 'Footer'},
    '../../../features/auth/onboarding/BirthdayDateWheel': {DateWheel: 'Wheel', ROW: 48, MONTHS: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']},
    '../../../components/ProfileEditForms': {FormTitle: 'Heading', formStyles: {}, f: {}},
    '../../../components/EditScreenHeader': {EditScreenHeader: 'Header'},
    '../../../services/api': {api: {}},
    '../../../store/authSlice': {},
  };
  const exported = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/screens/main/edit/EditBirthdayScreen.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React}}).outputText, {
    exports: exported, require: name => {
      imported.push(name);
      assert.ok(Object.hasOwn(modules, name), `Unexpected module loaded while opening Birthday: ${name}`);
      return modules[name];
    },
  });
  const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
  const render = () => {
    let tree;
    do {changed = false; cursor = 0; tree = nodes(exported.EditBirthdayScreen());} while (changed);
    return {wheels: tree.filter(node => node.type === 'Wheel').map(node => node.props), header: tree.find(node => node.type === 'Header').props};
  };
  return {render, imported, openWith: value => {params = {currentBirthday: value}; return render();}};
}

test('opening Birthday does not initialize ID-upload modules', () => {
  const s = editor('2000-04-08T00:00:00.000Z');
  const view = s.render();
  assert.equal(view.wheels.map(wheel => wheel.value).join('/'), '08/04/2000');
  assert.equal(view.header.hasUnsavedChanges, false);
  assert.ok(view.wheels.every(wheel => wheel.virtualized === false), 'The page ScrollView must not contain virtual date lists');
  assert.equal(s.imported.some(name => /expo-(image|file)/.test(name)), false);
});

test('a preloaded Birthday editor uses the saved date supplied when it opens', () => {
  const s = editor('2000-04-08T00:00:00.000Z');
  s.render();
  const view = s.openWith('2002-07-14T00:00:00.000Z');
  assert.equal(view.wheels.map(wheel => wheel.value).join('/'), '14/07/2002');
  assert.equal(view.header.hasUnsavedChanges, false);
});
