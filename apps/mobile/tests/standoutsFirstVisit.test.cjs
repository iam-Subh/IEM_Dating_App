const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const flush = () => new Promise(resolve => setImmediate(resolve));

function screen(welcomeShown = false, props = {}) {
  const cells = [], dependencies = [], effects = [], cleanup = [], requests = [], destinations = [];
  const timers = new Map(), writes = [];
  let timerId = 0, now = 0, welcomeWrites = 0;
  let cursor = 0, dirty = false, focused = true, backHandler, tree;
  const input = {...props};
  if (input.demoOnly) input.onDemoIntroSeen = seen => {input.demoIntroSeen = seen; dirty = true;};
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const intro = {welcomeShown, pointerShown: true};
  const react = {
    createElement: (type, props, ...children) => ({type, props: {...props, children}}),
    useState(initial) {const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial; return [cells[i], update => {const value = typeof update === 'function' ? update(cells[i]) : update; if (!Object.is(value, cells[i])) {cells[i] = value; dirty = true;}}];},
    useRef(value) {const i = cursor++; return cells[i] ?? (cells[i] = {current: value});},
    useCallback(fn, deps) {const i = cursor++; if (!same(dependencies[i], deps)) {cells[i] = fn; dependencies[i] = deps;} return cells[i];},
    useEffect(fn, deps) {const i = cursor++; if (!same(dependencies[i], deps)) {dependencies[i] = deps; effects.push(() => {cleanup[i]?.(); cleanup[i] = fn();});}},
  };
  const native = {View: 'View', Text: 'Text', Pressable: 'Button', FlatList: 'List', RefreshControl: 'Refresh', StyleSheet: {create: x => x},
    BackHandler: {addEventListener(_, fn) {backHandler = fn; return {remove() {if (backHandler === fn) backHandler = undefined;}};}}};
  const modules = {
    react, 'react-native': native,
    '@react-navigation/native': {useNavigation: () => ({navigate: (...args) => destinations.push(args)}), useIsFocused: () => focused,
      useFocusEffect: fn => react.useEffect(() => focused ? fn() : undefined, [fn, focused])},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 24, bottom: 12})},
    'react-redux': {useSelector: fn => fn({auth: {user: {id: 'me'}}})},
    '../../core/theme/colors': {colors: {}},
    '../../services/api': {api: {get: (url, options) => new Promise((resolve, reject) => requests.push({url, options, resolve: data => resolve({data: {data}}), reject})), post: (...args) => {writes.push(args); return Promise.resolve({});}}},
    '../../features/verification/useVerificationStatus': {useVerificationStatus: () => ({limited: false})},
    '../../features/discovery/useRoses': {useRoses: () => ({balance: {roses: 5, grant: 5}, refresh() {}})},
    '../../features/discovery/standoutsIntro': {introReady: () => true, useStandoutsIntro: () => intro, markStandoutsOpened() {},
      markWelcomeShown() {welcomeWrites++; intro.welcomeShown = true; dirty = true;}},
    '../../features/discovery/demo/likesDemo': {demoStandouts: () => [{id: 'demo-person', name: 'Demo person', photos: []}]},
    '@react-native-async-storage/async-storage': {getItem: async () => '1', setItem: async () => {}},
  };
  const exported = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/screens/main/StandoutsScreen.tsx'), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020},
  }).outputText, {exports: exported, require: id => modules[id] ?? new Proxy({}, {get: (_, name) => String(name)}),
    __DEV__: false, AbortController, setInterval: () => 0, clearInterval() {},
    setTimeout(fn, delay) {const id = ++timerId; timers.set(id, {fn, at: now + delay}); return id;},
    clearTimeout(id) {timers.delete(id);}});
  function render() {
    let loops = 0;
    do {if (++loops > 30) throw Error('Render did not settle'); dirty = false; cursor = 0; tree = exported.StandoutsScreen(input); while (effects.length) effects.shift()();} while (dirty);
    return tree;
  }
  function find(type, label) {
    const visit = node => !node || typeof node !== 'object' ? undefined : Array.isArray(node) ? node.map(visit).find(Boolean)
      : node.type === type && (!label || node.props?.accessibilityLabel === label) ? node.props : visit([node.props?.children, node.props?.ListEmptyComponent]);
    return visit(tree);
  }
  return {render, find, requests, destinations, intro, writes, welcomeWrites: () => welcomeWrites, timerCount: () => timers.size,
    advance(ms) {now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) {timers.delete(id); timer.fn();}},
    back: () => backHandler?.(), focus(value) {focused = value; render();},
    async settle() {await flush(); render();}, dispose() {cleanup.forEach(fn => fn?.());}};
}
const learning = {cards: [], state: 'learning', learning: {done: 4, needed: 15}, refreshesInSeconds: 3600};

for (const action of ['Done', 'Back']) test(`first visit shows Learn more before any request; ${action} opens progress`, async () => {
  const view = screen();
  try {
    view.render(); assert.ok(view.find('StandoutsInfoContent')); assert.equal(view.requests.length, 0);
    if (action === 'Done') view.find('StandoutsInfoContent').onClose(); else assert.equal(view.back(), true);
    view.render(); assert.equal(view.intro.welcomeShown, true); assert.equal(view.requests.length, 1);
    view.requests[0].resolve(learning); await view.settle();
    assert.equal(view.find('StandoutsInfoContent'), undefined);
    assert.equal(view.find('LearningPage').progress.done, 4);
    assert.equal(view.find('StandoutsLoading').loading, false);
  } finally {view.dispose();}
});

test('returning after the 15th swipe loads real profiles without repeating Learn more', async () => {
  const view = screen(true);
  try {
    view.render(); view.requests[0].resolve(learning); await view.settle();
    view.focus(false); view.focus(true);
    assert.equal(view.requests.length, 2);
    assert.equal(view.find('StandoutsLoading').loading, true);
    const cards = [{id: 'real-profile', name: 'Person', photos: []}];
    view.requests[1].resolve({cards, state: 'ok', refreshesInSeconds: 3600}); await view.settle();
    assert.equal(view.find('StandoutsInfoContent'), undefined);
    assert.equal(view.find('LearningPage'), undefined);
    assert.equal(view.find('StandoutsLoading').loading, false);
    assert.equal(view.find('List').data[0].id, 'real-profile');
    view.focus(false); view.focus(true);
    assert.equal(view.requests.length, 2, 'the fresh result remains cached');
  } finally {view.dispose();}
});

test('a request failure stops the icon loader and permits Retry', async () => {
  const view = screen(true);
  try {
    view.render(); view.requests[0].reject(new Error('offline')); await view.settle();
    assert.equal(view.find('StandoutsLoading').loading, false);
    const retry = view.find('List').ListEmptyComponent.props.children.at(-1);
    retry.props.onPress(); view.render();
    assert.equal(view.requests.length, 2);
    assert.equal(view.find('StandoutsLoading').loading, true);
  } finally {view.dispose();}
});

test('Demo loads the icon animation and sample profiles without requests or intro writes', async () => {
  const view = screen(false, {demoOnly: true, demoProgress: {needed: 15, done: 15}, demoIntroSeen: true});
  try {
    view.render(); assert.equal(view.find('StandoutsLoading').loading, true);
    assert.equal(view.requests.length, 0);
    view.advance(2399); await view.settle();
    assert.equal(view.find('StandoutsLoading').loading, true);
    view.advance(1); await view.settle();
    assert.equal(view.find('StandoutsLoading').loading, false);
    assert.equal(view.find('List').data[0].id, 'demo-person');
    view.find('List').onViewableItemsChanged({viewableItems: [{item: {id: 'demo-person', impressionId: 'must-not-send'}}]});
    assert.equal(view.writes.length, 0);
    assert.equal(view.welcomeWrites(), 0);
    assert.equal(view.intro.welcomeShown, false);
    view.find('Button', 'Replay Standouts animation').onPress(); view.render();
    assert.equal(view.find('StandoutsLoading').loading, true);
    view.advance(2400); await view.settle();
    assert.equal(view.find('List').data[0].id, 'demo-person');
    assert.equal(view.requests.length, 0);
  } finally {view.dispose();}
});

test('the Demo first-visit screen returns to demo swipe progress without saving real welcome state', async () => {
  let closed = 0;
  const view = screen(false, {demoOnly: true, demoProgress: {needed: 15, done: 4}, onExplore: () => closed++});
  try {
    view.render(); view.find('StandoutsInfoContent').onClose(); view.render(); await view.settle();
    assert.equal(view.find('LearningPage').progress.done, 4);
    view.find('LearningPage').onExplore(); assert.equal(closed, 1);
    assert.equal(view.requests.length, 0); assert.equal(view.welcomeWrites(), 0);
  } finally {view.dispose();}
});

test('closing Demo cancels its pending simulated response', () => {
  const view = screen(true, {demoOnly: true, demoProgress: {needed: 15, done: 15}, demoIntroSeen: true});
  view.render(); assert.equal(view.timerCount(), 1);
  view.dispose(); assert.equal(view.timerCount(), 0);
  view.advance(5000); assert.equal(view.requests.length, 0);
});

test('real loading waits for the response and has no minimum display timer', async () => {
  const view = screen(true);
  try {
    view.render(); view.advance(10000); await view.settle();
    assert.equal(view.find('StandoutsLoading').loading, true);
    assert.equal(view.timerCount(), 0);
    view.requests[0].resolve({cards: [{id: 'ready-profile'}], state: 'ok', refreshesInSeconds: 3600});
    await view.settle();
    assert.equal(view.find('StandoutsLoading').loading, false);
    assert.equal(view.find('List').data[0].id, 'ready-profile');
    view.focus(false); view.focus(true);
    assert.equal(view.requests.length, 1);
    assert.equal(view.find('StandoutsLoading').loading, false);
  } finally {view.dispose();}
});

test('an older response cannot stop a newer Standouts request or replace its profiles', async () => {
  const view = screen(true);
  try {
    view.render(); const older = view.requests[0];
    view.find('List').refreshControl.props.onRefresh(); view.render();
    assert.equal(older.options.signal.aborted, true);
    older.resolve({cards: [{id: 'outdated-profile'}], state: 'ok', refreshesInSeconds: 3600}); await view.settle();
    assert.equal(view.find('StandoutsLoading').loading, true);
    view.requests[1].resolve({cards: [{id: 'latest-profile'}], state: 'ok', refreshesInSeconds: 3600}); await view.settle();
    assert.equal(view.find('List').data[0].id, 'latest-profile');
    assert.equal(view.find('StandoutsLoading').loading, false);
  } finally {view.dispose();}
});

test('leaving Standouts cancels a real pending request', () => {
  const view = screen(true); view.render();
  const pending = view.requests[0]; view.dispose();
  assert.equal(pending.options.signal.aborted, true);
});
