const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const flush = () => new Promise(resolve => setImmediate(resolve));

// Run the actual screen's hooks and request handlers. Native children are
// represented by elements so tests can inspect their public props.
function screen() {
  const cells = [], deps = [], cleanups = [], effects = [], timers = new Map();
  let cursor = 0, dirty = false, timerId = 0, now = 0, preferencesChanged, locationChanged, tree;
  const requests = [];
  const location = {kind: 'none', locating: false, busy: false, status: null, actions: {}};
  const react = {
    createElement: (type, props, ...children) => ({type, props: {...props, children}}),
    useState(initial) {
      const i = cursor++;
      if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial;
      return [cells[i], value => {const next = typeof value === 'function' ? value(cells[i]) : value; if (!Object.is(next, cells[i])) {cells[i] = next; dirty = true;}}];
    },
    useRef(initial) {const i = cursor++; return cells[i] ?? (cells[i] = {current: initial});},
    useCallback(fn) {return fn;},
    useContext: () => ({top: 24, bottom: 16, left: 0, right: 0}),
    useSyncExternalStore: (_, get) => get(),
    useEffect(fn, next) {
      const i = cursor++;
      if (!deps[i] || !next || next.some((value, k) => !Object.is(value, deps[i][k]))) {
        deps[i] = next;
        effects.push(() => {cleanups[i]?.(); cleanups[i] = fn();});
      }
    },
  };
  react.useLayoutEffect = react.useEffect;
  const time = {
    setTimeout(fn, delay = 0) {const id = ++timerId; timers.set(id, {fn, at: now + delay}); return id;},
    clearTimeout(id) {timers.delete(id);},
  };
  const native = {
    View: 'View', Text: 'Text', Image: 'Image', Pressable: 'Pressable', TouchableOpacity: 'TouchableOpacity',
    ScrollView: 'ScrollView', SafeAreaView: 'SafeAreaView', Modal: 'Modal', StatusBar: 'StatusBar',
    StyleSheet: {create: x => x, absoluteFill: {}}, Platform: {OS: 'android'},
    Dimensions: {get: () => ({width: 360, height: 804})}, useWindowDimensions: () => ({width: 360, height: 804}),
    AppState: {currentState: 'active', addEventListener: () => ({remove() {}})},
  };
  const gesture = new Proxy({}, {get: () => () => gesture});
  const modules = {
    react,
    'react-native': native,
    'react-native-reanimated': {default: {View: 'AnimatedView', Text: 'AnimatedText'}, __esModule: true,
      useSharedValue: value => {const ref = react.useRef({value}); return ref.current;},
      useAnimatedStyle: fn => fn(), useAnimatedReaction() {}, useReducedMotion: () => false,
      withTiming: value => value, withSpring: value => value, cancelAnimation() {},
      runOnUI: fn => fn, runOnJS: fn => fn, Easing: {out: x => x, cubic: x => x}},
    'react-native-gesture-handler': {Gesture: {Pan: () => gesture}, GestureDetector: 'GestureDetector', GestureHandlerRootView: 'Root'},
    '@react-navigation/native': {useNavigation: () => ({navigate() {}}), useIsFocused: () => true, useFocusEffect() {}},
    '@tanstack/react-query': {useQuery: () => ({data: {groups: []}})},
    'react-redux': {useSelector: fn => fn({auth: {user: {id: 'me', avatarUrl: 'https://example.test/me.jpg'}}})},
    '../../../core/theme/colors': {colors: {}},
    '../../notifications/useUnreadNotifications': {useUnreadNotifications: () => ({unread: 0})},
    '../../verification/DeckVerifyBanner': {useDeckReminderCard: () => ({}), useDeckPrompt: () => ({})},
    '../standoutsIntro': {useStandoutsIntro: () => ({pointerShown: true}), hasNewStandouts: () => false, introReady: () => false},
    '../standoutsLearning': {useStandoutsLearning: () => ({learning: false, justLearned: false}), refreshLearning() {}},
    '../../teaching/tipsSeen': {takeNewcomer: async () => false, tipUnseen: () => false},
    '../useRoses': {useRoses: () => ({balance: {roses: 1}})},
    '../preferencesEvents': {onPreferencesChanged: fn => {preferencesChanged = fn; return () => {}; }},
    '../discoveryArrival': {getDiscoveryArrival: () => ({active: false}), subscribeDiscoveryArrival() {}},
    '../../location/useLocationGate': {useLocationGate: (_, fn) => {locationChanged = fn; return location;}},
    '../../location/cardLabels': {placeLine: () => ''},
    '../media/preparation': {createImagePreparation: () => ({isPrepared: () => false, update() {}, stop() {}}), photoPreparationWindow: () => []},
    '../../../services/api': {api: {get(url, config) {return new Promise((resolve, reject) => requests.push({url, config, resolve: data => resolve({data: {data}}), reject}));}}},
  };
  function load(file) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020},
    }).outputText, {exports, require(id) {
      if (id in modules) return modules[id];
      if (id === '../discoveryRequests') return load(path.join(__dirname, '../src/features/discovery/discoveryRequests.ts'));
      if (id === '../searchFeedback') return load(path.join(__dirname, '../src/features/discovery/searchFeedback.ts'));
      if (id.endsWith('.png')) return id;
      return new Proxy({}, {get: (_, name) => String(name)});
    }, ...time, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, AbortController, __DEV__: false});
    return exports;
  }
  const actual = load(path.join(__dirname, '../src/features/discovery/screens/DiscoverScreen.tsx'));
  function render() {
    let loops = 0;
    do {
      if (++loops > 30) throw Error('Render did not settle');
      dirty = false; cursor = 0;
      tree = actual.DiscoverScreen({});
      while (effects.length) effects.shift()();
    } while (dirty);
    return tree;
  }
  function elements(type) {
    const found = [];
    function visit(node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {node.forEach(visit); return;}
      if (node.type === type) found.push(node);
      visit(node.props?.children);
    }
    visit(tree);
    return found;
  }
  return {requests, location, render, elements, preferences: () => preferencesChanged(),
    locationReady: status => locationChanged(status),
    async settle() {await flush(); render();},
    advance(ms) {now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) {timers.delete(id); timer.fn();} render();},
    dispose() {cleanups.forEach(fn => fn?.());},
  };
}
const card = id => ({id, name: 'Person ' + id, age: 22, photos: ['https://example.test/' + id], primaryPhoto: 'https://example.test/' + id});
const page = cards => ({cards, nextCursor: null, state: cards.length ? 'ready' : 'exhausted'});

test('real Explore uses the signed-in photo and reveals the first card as soon as media is ready', async () => {
  const view = screen();
  try {
    view.render();
    assert.equal(view.elements('ProfileSearchLoading')[0].props.avatarUri, 'https://example.test/me.jpg');
    view.requests[0].resolve(page([card('a')])); await view.settle();
    assert.equal(view.elements('ProfileSearchLoading').length, 1);
    const profile = view.elements('SwipeCard')[0];
    assert.equal(profile.props.isActiveCard, false);
    profile.props.onMediaState('ready'); view.render();
    assert.equal(view.elements('ProfileSearchLoading').length, 0);
    assert.equal(view.elements('SwipeCard')[0].props.isActiveCard, true);
  } finally {view.dispose();}
});

test('media state changes cannot extend the two-second limit for the first card', async () => {
  const view = screen();
  try {
    view.render(); view.requests[0].resolve(page([card('a')])); await view.settle();
    view.advance(1000);
    view.elements('SwipeCard')[0].props.onMediaState('buffering'); view.render();
    view.advance(999); assert.equal(view.elements('ProfileSearchLoading').length, 1);
    view.elements('SwipeCard')[0].props.onMediaState('loading'); view.render();
    view.advance(1); assert.equal(view.elements('ProfileSearchLoading').length, 0);
  } finally {view.dispose();}
});

test('a failed first image immediately releases the loader to the card error UI', async () => {
  const view = screen();
  try {
    view.render(); view.requests[0].resolve(page([card('a')])); await view.settle();
    view.elements('SwipeCard')[0].props.onMediaState('error'); view.render();
    assert.equal(view.elements('ProfileSearchLoading').length, 0);
    assert.equal(view.elements('SwipeCard').length, 1);
  } finally {view.dispose();}
});

test('leaving the screen cancels its pending recommendation request', () => {
  const view = screen(); view.render();
  const request = view.requests[0];
  assert.equal(request.config.signal.aborted, false);
  view.dispose();
  assert.equal(request.config.signal.aborted, true);
});

test('a preference change replaces a pending request; an older response cannot replace its result', async () => {
  const view = screen();
  try {
    view.render(); const old = view.requests[0]; view.preferences(); view.render();
    assert.equal(old.config.signal.aborted, true);
    assert.equal(view.elements('ProfileSearchLoading')[0].props.reason, 'preferences');
    view.requests[1].resolve(page([card('new')])); await view.settle();
    old.resolve(page([card('old')])); await view.settle();
    assert.equal(view.elements('SwipeCard')[0].props.user.id, 'new');
  } finally {view.dispose();}
});

test('empty results use the cat; network errors use Retry and can recover', async () => {
  const view = screen();
  try {
    view.render(); view.requests[0].reject(new Error('Offline')); await view.settle();
    assert.equal(view.elements('ProfileSearchLoading').length, 0);
    view.elements('ProfileSearchError')[0].props.onRetry(); view.render();
    view.requests[1].resolve(page([])); await view.settle();
    assert.equal(view.elements('ProfileSearchError').length, 0);
    assert.equal(view.elements('ProfileSearchLoading').length, 0);
    assert.ok(view.elements('Image').some(node => String(node.props.source).includes('discover-kitten.png')));
  } finally {view.dispose();}
});

test('actual location acquisition uses the location label, then searches nearby; denial keeps the gate', async () => {
  const view = screen();
  try {
    view.location.kind = 'refresh'; view.location.locating = true; view.render();
    assert.equal(view.elements('ProfileSearchLoading')[0].props.reason, 'location');
    assert.equal(view.elements('LocationGate').length, 0);
    view.location.locating = false; view.location.kind = 'none';
    view.locationReady({mode: 'distance'}); view.render();
    assert.equal(view.elements('ProfileSearchLoading')[0].props.reason, 'nearby');
    view.location.kind = 'settings'; view.render();
    assert.equal(view.elements('LocationGate').length, 1);
    assert.equal(view.elements('ProfileSearchLoading').length, 0);
  } finally {view.dispose();}
});
