const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const flush = () => new Promise(resolve => setImmediate(resolve));

function reportForm() {
  const cells = [], deps = [], effects = [], cleanup = [], posts = [], sent = [];
  let cursor = 0, dirty = false, tree, dismissals = 0;
  const react = {
    createElement: (type, props, ...children) => ({type, props: {...props, children}}),
    useContext: () => ({top: 24, bottom: 12}),
    useState(initial) {const i = cursor++; if (!(i in cells)) cells[i] = initial; return [cells[i], update => {const next = typeof update === 'function' ? update(cells[i]) : update; if (!Object.is(next, cells[i])) {cells[i] = next; dirty = true;}}];},
    useRef(value) {const i = cursor++; return cells[i] ?? (cells[i] = {current: value});},
    useEffect(fn, values) {const i = cursor++; if (!deps[i] || !values || values.some((value, j) => !Object.is(value, deps[i][j]))) {deps[i] = values; effects.push(() => {cleanup[i]?.(); cleanup[i] = fn();});}},
  };
  class Value {constructor(value) {this.value = value;} setValue(value) {this.value = value;} interpolate() {return 0;}}
  const native = Object.fromEntries(['ActivityIndicator','Modal','Pressable','ScrollView','Switch','Text','TextInput','View'].map(name => [name,name]));
  Object.assign(native, {Animated: {Value, View: 'AnimatedView', timing: (value, config) => ({start(fn) {value.setValue(config.toValue); fn?.({finished: true});}})},
    Easing: {out: x => x, cubic: x => x}, Keyboard: {dismiss() {dismissals++;}},
    BackHandler: {addEventListener: () => ({remove() {}})}, StyleSheet: {create: x => x, absoluteFill: {}, hairlineWidth: 1}});
  const reason = {code: 'harassment', label: 'Harassment or threats', icon: 'hand-left-outline', details: ['Bullying', 'Threats']};
  const modules = {
    react, 'react-native': native,
    'react-native-keyboard-controller': {useReanimatedKeyboardAnimation: () => ({height: {value: 0}, progress: {value: 0}})},
    'react-native-reanimated': {default: {View: 'ReanimatedView'}, useAnimatedStyle: fn => fn()},
    '@expo/vector-icons': {Ionicons: 'Icon'}, 'react-native-safe-area-context': {},
    '../../services/api': {api: {post: async (...args) => posts.push(args)}},
    '../../navigation/navigationRef': {navigationRef: {isReady: () => false}},
    '../verification/ReminderParts': {reminderColors: {}}, '../legal/LegalScreen': {HELPLINES: []},
    './reportReasons': {REPORT_REASONS: [reason]}, '../feedback/engagement': {recordSetback() {}},
  };
  const exported = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/safety/ReportSheet.tsx'), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020},
  }).outputText, {exports: exported, require: name => modules[name]});
  function render() {
    let attempts = 0;
    do {if (++attempts > 20) throw Error('Render did not settle'); dirty = false; cursor = 0; tree = exported.ReportHost(); while (effects.length) effects.shift()();} while (dirty);
    return tree;
  }
  const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const text = node => !node ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);
  const find = (type, label) => nodes(tree).find(node => node.type === type && (!label || node.props?.accessibilityLabel === label || text(node) === label));
  render(); const result = exported.openReport({userId: 'demo-person', name: 'Demo person', sourceType: 'profile', canBlock: false, send: async code => {sent.push(code);}}); render();
  return {render, find, result, posts, sent, dismissals: () => dismissals,
    byId: id => nodes(tree).find(node => node.props?.testID === id),
    details() {find('Pressable', reason.label).props.onPress(); render();},
    async settle() {await flush(); render();}, dispose() {cleanup.forEach(fn => fn?.());}};
}

test('Back dismisses the keyboard and preserves the report draft without submitting it', () => {
  const form = reportForm();
  try {
    form.details();
    form.find('TextInput').props.onChangeText('A private draft'); form.render();
    const before = form.dismissals(); form.find('Pressable', 'Back to reasons').props.onPress(); form.render();
    assert.ok(form.dismissals() > before); form.details();
    assert.equal(form.find('TextInput').props.value, 'A private draft');
    assert.equal(form.posts.length, 0); assert.equal(form.sent.length, 0);
  } finally {form.dispose();}
});

test('the focused draft stays in view when the form viewport changes', () => {
  const form = reportForm();
  try {
    form.details();
    const scroll = form.byId('report-details-scroll'), input = form.find('TextInput'), offsets = [];
    scroll.props.ref.current = {scrollTo: offset => offsets.push(offset.y)};
    input.props.onLayout({nativeEvent: {layout: {y: 140}}});
    input.props.onFocus();
    scroll.props.onLayout();
    assert.deepEqual(offsets, [140, 140]);
    input.props.onBlur(); scroll.props.onLayout();
    assert.equal(offsets.length, 2);
    assert.equal(form.posts.length, 0);
  } finally {form.dispose();}
});

test('submitting the simulated report dismisses the keyboard and shows the result', async () => {
  const form = reportForm();
  try {
    form.details(); form.find('TextInput').props.onChangeText('Details'); form.render();
    const before = form.dismissals(); form.find('Pressable', 'Send report').props.onPress(); await form.settle();
    assert.ok(form.dismissals() > before); assert.deepEqual(form.sent, ['harassment']);
    assert.equal(form.find('TextInput'), undefined); assert.ok(form.find('Text', 'Thanks for telling us'));
    assert.equal(form.posts.length, 0);
  } finally {form.dispose();}
});
