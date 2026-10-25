const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the preview handlers with a native-player double. Decoder timing
// and the physical video surface still require device verification.
function preview() {
  let cursor = 0;
  let initialized = false;
  const slots = [];
  const effects = [];
  const timers = new Map();
  let timerId = 0;
  const listeners = new Map();
  const seeks = [];
  let currentTime = 20;
  const player = {
    duration: 60, playing: false, muted: true, status: 'readyToPlay', loads: 0, plays: 0,
    get currentTime() {return currentTime;},
    set currentTime(value) {currentTime = value; seeks.push(value);},
    play() {this.playing = true; this.plays++;},
    pause() {this.playing = false;},
    replaceAsync() {this.loads++; return Promise.resolve();},
    addListener(name, callback) {listeners.set(name, callback); return {remove() {listeners.delete(name);}};},
  };
  const same = (a, b) => a && a.length === b.length && a.every((value, index) => value === b[index]);
  const react = {
    createElement: (type, props, ...children) => ({type, props: {...props, children}}),
    memo: value => value,
    useState(value) {const index = cursor++; if (!(index in slots)) slots[index] = value; return [slots[index], next => {slots[index] = typeof next === 'function' ? next(slots[index]) : next;}];},
    useRef(value) {const index = cursor++; return slots[index] ??= {current: value};},
    useCallback(callback, deps) {const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = {callback, deps}; return slots[index].callback;},
    useEffect(callback, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) effects.push(() => {slots[index]?.cleanup?.(); slots[index] = {deps, cleanup: callback()};});
    },
  };
  const modules = {
    react: {...react, default: react},
    'react-native': {View: 'View', Text: 'Text', Modal: 'Modal', StatusBar: 'StatusBar', ActivityIndicator: 'ActivityIndicator',
      StyleSheet: {create: value => value, absoluteFill: {}}, AppState: {addEventListener: () => ({remove() {}})}},
    'react-native-safe-area-context': {SafeAreaView: 'SafeAreaView'},
    '@expo/vector-icons': {Ionicons: 'Icon', MaterialCommunityIcons: 'Icon'},
    '@react-native-community/slider': {__esModule: true, default: 'Slider'},
    'expo-video': {VideoView: 'VideoView', useVideoPlayer: (_, setup) => {if (!initialized) {initialized = true; setup(player);} return player;}},
    './ConnectionDesign': {TapChoice: 'Button', connectionColors: {}, connectionStyles: {}},
    './profileVideoRecording': {recordingTimeLabel: value => String(value)},
    './VideoPreviewGlow': {VideoPreviewGlow: 'VideoPreviewGlow', useVideoGlowFrames: () => []},
  };
  const exported = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/features/auth/onboarding/ProfileVideoPreview.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020}}).outputText, {
    exports: exported, require: name => {if (!modules[name]) throw new Error(name); return modules[name];}, Date,
    setTimeout: (callback, delay) => {const id = ++timerId; timers.set(id, {callback, delay}); return id;},
    clearTimeout: id => timers.delete(id),
  });
  let tree;
  let visible = false;
  const render = () => {
    cursor = 0;
    tree = exported.ProfileVideoPreview({uri: 'file:///selected.mp4', visible, onClose: () => {visible = false;}});
    while (effects.length) effects.shift()();
  };
  function find(predicate, node = tree) {
    if (!node || typeof node !== 'object') return;
    if (predicate(node)) return node;
    for (const child of node.props?.children?.flat(Infinity) || []) {const result = find(predicate, child); if (result) return result;}
  }
  render();
  return {
    player, seeks, render,
    visible(value) {visible = value; render();},
    event(name, event) {listeners.get(name)(event); render();},
    tap(label) {find(node => node.props?.accessibilityLabel === label).props.onPress(); render();},
    slider() {return find(node => node.type === 'Slider').props;},
    flush() {for (const [id, timer] of [...timers]) {timers.delete(id); timer.callback();} render();},
  };
}

test('reopening retains the player and pauses until the user presses play', () => {
  const p = preview();
  p.visible(true);
  assert.equal(p.player.plays, 1);
  p.visible(false);
  assert.equal(p.player.playing, false);
  p.visible(true);
  assert.equal(p.player.plays, 1);
  assert.equal(p.player.loads, 0);
  assert.equal(p.player.bufferOptions.preferredForwardBufferDuration, 15);
});

test('rapid skip presses accumulate from the last requested position without replacing the source', () => {
  const p = preview(); p.visible(true);
  p.tap('Go forward 10 seconds'); p.tap('Go forward 10 seconds'); p.tap('Go back 10 seconds');
  assert.deepEqual(p.seeks, [30, 40, 30]);
  p.event('timeUpdate', {currentTime: 20});
  p.tap('Go forward 10 seconds');
  assert.equal(p.seeks.at(-1), 40);
  assert.equal(p.player.loads, 0);
});

test('dragging seeks before release, coalesces updates, and commits the final position', () => {
  const p = preview(); p.visible(true);
  p.slider().onSlidingStart();
  assert.equal(p.player.playing, false);
  assert.equal(p.player.scrubbingModeOptions.scrubbingModeEnabled, true);
  p.slider().onValueChange(10); p.slider().onValueChange(12); p.slider().onValueChange(15);
  p.flush();
  assert.deepEqual(p.seeks, [15]);
  p.slider().onValueChange(18);
  p.slider().onSlidingComplete(19); p.flush();
  assert.deepEqual(p.seeks, [15, 19]);
  assert.equal(p.player.scrubbingModeOptions.scrubbingModeEnabled, false);
  assert.equal(p.player.playing, true);
});

test('playback end returns to frame zero and waits for a replay tap', () => {
  const p = preview(); p.visible(true);
  p.event('playToEnd');
  assert.equal(p.player.currentTime, 0);
  assert.equal(p.player.playing, false);
  assert.equal(p.slider().value, 0);
  p.tap('Replay video');
  assert.equal(p.player.playing, true);
});

test('a queued end event cannot cancel a backward seek, but reaching the end still resets', () => {
  const p = preview(); p.visible(true);
  p.tap('Go back 10 seconds');
  p.event('playToEnd');
  assert.equal(p.player.currentTime, 10);
  p.player.currentTime = 60;
  p.event('playToEnd');
  assert.equal(p.player.currentTime, 0);
  assert.equal(p.player.playing, false);
});

test('closing cancels a pending drag seek and prevents background playback', () => {
  const p = preview(); p.visible(true);
  p.slider().onSlidingStart(); p.slider().onValueChange(35);
  p.tap('Close video preview'); p.flush();
  assert.deepEqual(p.seeks, []);
  assert.equal(p.player.playing, false);
  assert.equal(p.player.scrubbingModeOptions.scrubbingModeEnabled, false);
});
