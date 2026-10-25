const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness() {
  const cells = [];
  let cursor = 0, effects = [], dirty = false;
  const react = {
    createElement: (type, props, ...children) => ({type, props: {...props, children}}),
    useRef(value) {const i = cursor++; return cells[i] ??= {current: value};},
    useState(initial) {
      const i = cursor++;
      cells[i] ??= {value: typeof initial === 'function' ? initial() : initial};
      return [cells[i].value, update => {
        const value = typeof update === 'function' ? update(cells[i].value) : update;
        if (!Object.is(value, cells[i].value)) {cells[i].value = value; dirty = true;}
      }];
    },
    useCallback: callback => callback,
    forwardRef: render => props => render(props, null),
    useImperativeHandle() {},
    useLayoutEffect(callback, deps) {return react.useEffect(callback, deps);},
    useEffect(callback, deps) {
      const i = cursor++;
      if (!cells[i] || deps.some((value, j) => value !== cells[i].deps[j])) {
        cells[i] = {deps}; effects.push(callback);
      }
    },
  };
  return {react, load(file, modules, extra = {}) {
    const exported = {};
    const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true},
    }).outputText;
    vm.runInNewContext(source, {exports: exported, __DEV__: true, setInterval: () => 1, clearInterval() {},
      require: name => name === 'react' ? react : modules[name], ...extra});
    return exported;
  }, render(component, props) {
    let tree;
    for (let i = 0; i < 12; i++) {
      cursor = 0; effects = []; dirty = false;
      tree = component(props);
      effects.forEach(effect => effect());
      if (!dirty) return tree;
    }
    throw new Error('Render did not settle');
  }};
}
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes)
  // The Rose sheet rides in the open profile's `overlay` (RoseSheet inline).
  : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children), ...nodes(tree.props?.overlay)] : [];
const find = (tree, type) => nodes(tree).find(node => node.type === type)?.props;
// RoseSheetHost keeps its target itself and is opened through its ref. The
// stand-in records who each host is open for and reports it as the sheet would.
const targets = new Map();
function sheetOf(tree) {
  const hosts = nodes(tree).filter(node => node.type === 'Host').map(node => node.props);
  for (const props of hosts) {
    const key = props.inline ? 'profile' : 'list';
    if (props.ref && !props.ref.current) props.ref.current = {
      open: target => targets.set(key, target), close: () => targets.set(key, null), back: () => false,
    };
  }
  const view = props => {
    const target = targets.get(props.inline ? 'profile' : 'list') ?? null;
    return {...props, visible: !!target, name: target?.name ?? '', photoUri: target ? props.photoOf?.(target) : undefined,
      onSend: comment => props.onSend(target, comment)};
  };
  const open = hosts.find(props => targets.get(props.inline ? 'profile' : 'list'));
  return open ? view(open) : hosts[0] && view(hosts[0]);
}
const card = {id: 'person-1', name: 'Aanya', primaryPhoto: 'portrait.jpg', photos: ['portrait.jpg'], impressionId: 'impression-1'};

function standouts(sendResult = {}, trial = false) {
  targets.clear();
  const h = harness(), calls = [], alerts = [], destinations = [];
  const modules = {
    'react-native': {View: 'View', Text: 'Text', Pressable: 'Button', FlatList: 'List', RefreshControl: 'Refresh', StyleSheet: {create: value => value}, Alert: {alert: (...args) => alerts.push(args)}},
    'react-redux': {useSelector: select => select({auth: {user: {}}})},
    '@react-navigation/native': {useFocusEffect() {}, useNavigation: () => ({navigate: (...args) => destinations.push(args), goBack() {}})},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 0, bottom: 0})},
    '@expo/vector-icons': {Ionicons: 'Icon'},
    '../../core/theme/colors': {colors: {}},
    '../../services/api': {api: {get: async () => ({data: {data: {cards: [card]}}}), post: async () => ({})}},
    '../../features/verification/useVerificationStatus': {useVerificationStatus: () => ({limited: false})},
    '../../features/verification/VerifyNudge': {UnverifiedNudge: 'Nudge'},
    '../../features/discovery/components/ConnectionProfileCard': {ConnectionProfileCard: 'Card'},
    '../../features/discovery/components/StandoutsIcon': {StandoutsIcon: 'StandoutsIcon'},
    '../../features/discovery/components/profile-detail/ProfileDetailModal': {ProfileDetailModal: 'Profile'},
    '../../features/discovery/components/RoseSheet': {RoseSheetHost: 'Host'},
    '../../features/discovery/useRoses': {useRoses: () => ({balance: {roses: 5}, refresh() {}, send: async (...args) => {
      calls.push(args); if (trial) args[2].onTrialRoseSpent();
      return typeof sendResult === 'function' ? sendResult() : sendResult;
    }})},
    '../../features/discovery/demo/likesDemo': {demoStandouts: () => [card]},
    '@react-native-async-storage/async-storage': {getItem: async () => '1', setItem: async () => {}},
  };
  const {StandoutsScreen} = h.load('screens/main/StandoutsScreen.tsx', modules);
  const render = () => h.render(StandoutsScreen);
  const load = async () => {await find(render(), 'List').refreshControl.props.onRefresh();};
  const open = (expanded = false) => {
    const list = find(render(), 'List');
    let cell = list.renderItem({item: list.data[0]});
    sheetOf(render());
    if (expanded) {
      find(cell, 'Card').onOpen(card);
      sheetOf(render());
      find(render(), 'Profile').onRose();
    } else nodes(cell).find(node => node.props?.accessibilityLabel === 'Send Aanya a Rose').props.onPress();
  };
  return {render, load, open, calls, alerts, destinations};
}

test('Standouts information opens from the header without spending a Rose', () => {
  const s = standouts();
  const button = nodes(s.render()).find(node => node.props?.accessibilityLabel === 'About Standouts');
  assert.ok(button);
  button.props.onPress();
  assert.equal(s.destinations.length, 1);
  assert.equal(s.destinations[0][0], 'StandoutsInfo');
  assert.equal(s.calls.length, 0);
  assert.equal(s.alerts.length, 0);
});

for (const expanded of [false, true]) test(`a successful ${expanded ? 'expanded-profile' : 'card'} send waits for confirmation before closing`, async () => {
  const s = standouts({matchCreated: true}, true);
  await s.load(); s.open(expanded);
  // From an open profile the sheet is drawn inside its window, not as a second Modal.
  assert.equal(sheetOf(s.render()).inline, expanded);
  await sheetOf(s.render()).onSend('Hello');
  const composer = sheetOf(s.render());
  assert.equal(composer.visible, true);
  assert.equal(composer.confirmation.name, 'Aanya');
  assert.equal(composer.confirmation.matched, true);
  assert.equal(composer.photoUri, 'portrait.jpg');
  assert.equal(!!find(s.render(), 'Profile'), expanded);
  assert.equal(find(s.render(), 'List').data[0].roseSent, true);
  assert.equal(s.alerts.length, 0);
  composer.onConfirmationComplete();
  const closed = sheetOf(s.render());
  assert.equal(closed.visible, false);
  assert.equal(find(s.render(), 'Profile'), undefined);
  closed.onDismiss(); closed.onDismiss();
  assert.equal(s.alerts.length, 1);
  assert.equal(s.destinations.length, 0);
  s.alerts[0][2][0].onPress(); s.alerts[0][3].onDismiss();
  assert.equal(s.destinations.length, 1);
});

test('a refused send preserves the composer and produces no confirmation', async () => {
  const s = standouts(null);
  await s.load(); s.open(true);
  await sheetOf(s.render()).onSend('Keep this message');
  assert.equal(sheetOf(s.render()).visible, true);
  assert.equal(sheetOf(s.render()).confirmation, null);
  assert.ok(find(s.render(), 'Profile'));
  assert.equal(find(s.render(), 'List').data[0].roseSent, undefined);
  assert.equal(s.calls[0][1], 'Keep this message');
});

test('duplicate sends while a request is pending spend only one Rose', async () => {
  let resolve;
  const s = standouts(() => new Promise(done => {resolve = done;}));
  await s.load(); s.open();
  const composer = sheetOf(s.render());
  const first = composer.onSend(null);
  await Promise.resolve(); await Promise.resolve();
  await composer.onSend(null);
  assert.equal(s.calls.length, 1);
  resolve({}); await first;
});

test('demo sends use the same confirmation and reduce only the demo balance', async () => {
  const s = standouts();
  nodes(s.render()).find(node => node.props?.accessibilityLabel === 'Show demo').props.onPress();
  await s.load(); s.open();
  await sheetOf(s.render()).onSend(null);
  assert.equal(s.calls.length, 0);
  assert.equal(sheetOf(s.render()).confirmation.name, 'Aanya');
  assert.equal(sheetOf(s.render()).balance, 4);
});

test('the composer slides away before mounting the shared Rose animation', () => {
  const h = harness(), motions = [];
  const gesture = new Proxy({}, {get: () => () => gesture});
  const {RoseSheet} = h.load('features/discovery/components/RoseSheet.tsx', {
    'react-native': {View: 'View', Text: 'Text', Modal: 'Modal', Pressable: 'Button', Platform: {OS: 'ios'}, Keyboard: {dismiss() {}}, StyleSheet: {create: value => value}},
    'react-native-gesture-handler': {Gesture: {Pan: () => gesture}, GestureDetector: 'Gesture', GestureHandlerRootView: 'Root'},
    'react-native-keyboard-controller': {KeyboardAvoidingView: 'KeyboardView'},
    'react-native-reanimated': {default: {View: 'AnimatedView'}, useSharedValue: value => h.react.useRef({value}).current,
      useAnimatedStyle: callback => callback(), withSpring: value => value, withTiming: (value, options, complete) => {motions.push(complete); return value;}, runOnJS: callback => callback},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({bottom: 0})},
    '@expo/vector-icons': {Ionicons: 'Icon'},
    './profile-detail/RoseSentCelebration': {RoseSentCelebration: 'Celebration'},
  });
  const props = {visible: true, name: 'Aanya', balance: 5, onCancel() {}, onSend: async () => {}};
  h.render(RoseSheet, props);
  const sent = {...props, confirmation: {name: 'Aanya', matched: false}, photoUri: 'portrait.jpg'};
  assert.equal(find(h.render(RoseSheet, sent), 'Celebration'), undefined);
  motions.at(-1)(true);
  assert.equal(find(h.render(RoseSheet, sent), 'Celebration').photoUri, 'portrait.jpg');
});

test('a trial Rose can defer its verification reminder until confirmation finishes', async () => {
  const h = harness(), timers = [];
  let reminders = 0;
  const {useRoses} = h.load('features/discovery/useRoses.ts', {
    'react-native': {Alert: {alert() {}}, AppState: {addEventListener: () => ({remove() {}})}},
    '../../navigation/navigationRef': {navigationRef: {isReady: () => true, navigate() {throw new Error('Reminder interrupted confirmation');}}},
    '../verification/verifyGate': {verifyReasonOf: () => null},
    '../../services/api': {api: {
      get: async () => ({data: {data: {roses: 1, trial: true}}}),
      post: async () => ({data: {data: {matchCreated: false}}}),
    }},
  }, {setTimeout: callback => timers.push(callback)});
  h.render(useRoses);
  await new Promise(resolve => setImmediate(resolve));
  await h.render(useRoses).send('person-1', null, {onTrialRoseSpent: () => reminders++});
  assert.equal(reminders, 1);
  assert.equal(timers.length, 0);
  assert.equal(h.render(useRoses).balance.roses, 0);
});
