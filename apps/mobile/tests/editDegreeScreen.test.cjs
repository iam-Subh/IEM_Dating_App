const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, requireModule = require) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText, { exports, require: requireModule });
  return exports;
}

function editor(currentDegree, response = { data: { success: true, data: { degree: 'M.Tech' } } }) {
  const cells = [];
  const writes = [];
  const dispatches = [];
  const alerts = [];
  let cursor = 0;
  let closes = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++;
      if (!cells[index]) cells[index] = { value: initial };
      return [cells[index].value, next => { cells[index].value = next; }];
    },
    useRef(current) {
      const index = cursor++;
      if (!cells[index]) cells[index] = { current };
      return cells[index];
    },
  };
  const modules = {
    react: { __esModule: true, ...react, default: react },
    'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', TextInput: 'Input',
      StyleSheet: { create: styles => styles }, Alert: { alert: (...args) => alerts.push(args) } },
    '@react-navigation/native': { useRoute: () => ({ params: { currentDegree } }), useNavigation: () => ({ goBack: () => closes++ }) },
    'react-redux': { useDispatch: () => action => dispatches.push(action) },
    '../../../components/EditScreenHeader': { EditScreenHeader: 'Header' },
    '../../../components/ProfileEditDesign': {createEditStyles: styles => styles, EditHeading: 'Heading', EditTapChoice: 'Pressable'},
    '../../../components/ProfileEditForms': {FormTitle: 'Heading', StudyField: 'StudyField', formStyles: {}, f: {}},
    '../../../components/CampusFieldIcon': { CampusFieldIcon: 'Icon' },
    '../../../core/profile/campusIcons': load('../src/core/profile/campusIcons.ts'),
    '../../../core/profile/profileOptions': load('../src/core/profile/profileOptions.ts'),
    '../../../services/api': { api: { put: async (...args) => { writes.push(args); return response; } } },
    '../../../store/authSlice': { updateUser: payload => ({ type: 'updateUser', payload }) },
  };
  const { EditDegreeScreen } = load('../src/screens/main/edit/EditDegreeScreen.tsx', name => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected import: ${name}`);
    return modules[name];
  });
  function nodes(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return [node, ...nodes(node.props?.children)];
  }
  function render() {
    cursor = 0;
    const tree = nodes(EditDegreeScreen());
    return { header: tree.find(node => node.type === 'Header').props,
      input: tree.find(node => node.type === 'Input').props,
      choose: value => {
        const field = tree.find(node => node.type === 'StudyField').props;
        assert.ok(field.options.some(option => option.id === value));
        field.onSelect(value);
      } };
  }
  return { render, writes, dispatches, alerts, closes: () => closes };
}

test('changing degree saves only the degree and ignores a duplicate Save tap', async () => {
  const harness = editor('Undergraduate (B.Tech)');
  let screen = harness.render();
  assert.equal(screen.input.value, 'Undergraduate (B.Tech)');
  assert.equal(screen.header.hasUnsavedChanges, false);
  screen.choose('M.Tech');
  screen = harness.render();
  assert.equal(screen.header.hasUnsavedChanges, true);
  await Promise.all([screen.header.onSave(), screen.header.onSave()]);
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.writes[0][0], '/profile');
  assert.equal(JSON.stringify(harness.writes[0][1]), JSON.stringify({ degree: 'M.Tech' }));
  assert.equal(harness.dispatches[0].payload.degree, 'M.Tech');
  assert.equal(harness.closes(), 1);
});

test('a failed save keeps the selected degree and the editor open', async () => {
  const harness = editor('B.Tech', { data: { success: false, message: 'Try again later.' } });
  harness.render().choose('M.Tech');
  await harness.render().header.onSave();
  assert.equal(harness.closes(), 0);
  assert.equal(harness.dispatches.length, 0);
  assert.equal(harness.alerts[0][1], 'Try again later.');
  assert.equal(harness.render().input.value, 'M.Tech');
});

test('blank degrees cannot be saved and an unchanged degree does not write to the API', async () => {
  const blank = editor(undefined);
  blank.render().input.onChangeText('   ');
  assert.equal(blank.render().header.saveDisabled, true);
  await blank.render().header.onSave();
  assert.equal(blank.writes.length, 0);
  const saved = editor('M.Tech');
  await saved.render().header.onSave();
  assert.equal(saved.writes.length, 0);
  assert.equal(saved.closes(), 1);
});
