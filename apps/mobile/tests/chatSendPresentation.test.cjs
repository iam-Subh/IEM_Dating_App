const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(name) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/chat', name), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports });
  return exports;
}
const { createChatAutoScroll } = load('chatAutoScroll.ts');
const sendMotionModule = load('chatSendMotion.ts');
const { createChatSendMotion, riseOffset, riseProgress } = sendMotionModule;

test('sending from older history follows the new row after commit and native anchoring', () => {
  const follow = createChatAutoScroll();
  follow.commit('old', 0, false, 1000);
  follow.drag();
  follow.scroll(900, 1100);
  assert.equal(follow.commit('old', 0, false, 1100), false);
  // The request can commit before the new message has reached the list.
  assert.equal(follow.commit('old', 1, false, 1200), true);
  follow.scroll(950, 1216);
  assert.equal(follow.commit('sent-1', 1, false, 1232), true);
  follow.scroll(1040, 1248);
  assert.equal(follow.isFollowing(), true);
  assert.equal(follow.commit('sent-2', 2, false, 1264), true);
  follow.scroll(0, 1700);
  assert.equal(follow.isFollowing(), true);
});

test('incoming messages and older pages do not pull a reader out of history', () => {
  const follow = createChatAutoScroll();
  follow.commit('first', 0, false, 1000);
  follow.drag();
  follow.scroll(800, 1100);
  assert.equal(follow.commit('incoming', 0, false, 1200), false);
  assert.equal(follow.commit('incoming', 0, false, 1250), false);
  follow.scroll(50, 1300);
  assert.equal(follow.commit('next', 0, false, 1400), true);
  // A deliberate drag interrupts even an unfinished send correction.
  follow.drag();
  assert.equal(follow.isFollowing(), false);
});

test('a detached message window waits for the latest page before following', () => {
  const follow = createChatAutoScroll();
  assert.equal(follow.commit('historical', 1, true, 1000), false);
  assert.equal(follow.commit('latest', 1, false, 1100), true);
});

test('rapid sends keep independent origins and consume each animation once', () => {
  const motion = createChatSendMotion();
  motion.setOrigin({ x: 340, y: 700, capturedAt: 1000 });
  motion.register('temp-a', 1001);
  motion.setOrigin({ x: 340, y: 650, capturedAt: 1020 });
  motion.register('temp-b', 1021);
  assert.equal(motion.take('temp-a', 1100).y, 700);
  assert.equal(motion.take('temp-b', 1100).y, 650);
  // Recycled rows, server acknowledgements, and retries must stay static.
  assert.equal(motion.take('temp-a', 1101), null);
  assert.equal(motion.has('history', 1101), false);
  motion.register('programmatic-send', 1102);
  assert.equal(motion.has('programmatic-send', 1102), false);
});

test('stale origins and off-screen sends cannot animate on a later history visit', () => {
  const motion = createChatSendMotion();
  motion.setOrigin({ x: 340, y: 700, capturedAt: 1000 });
  motion.register('stale-origin', 2200);
  assert.equal(motion.has('stale-origin', 2200), false);
  motion.setOrigin({ x: 340, y: 700, capturedAt: 2200 });
  motion.register('expired', 2201);
  assert.equal(motion.has('expired', 3800), false);
  assert.equal(motion.take('expired', 3800), null);
});

const linear = x => x;
const D = sendMotionModule.TELEGRAM_SEND_MS;

test('rapid sends lift the rows above together: each lift adds, none resets another', () => {
  const rises = [{ id: 'a', height: 50, t0: 1000 }];
  // Right after the first send: the row above is back down by the whole lift.
  assert.equal(riseOffset(rises, 1000, null, 0, linear), 50);
  // A second send halfway through the first: the rest of the first is kept.
  rises.push({ id: 'b', height: 40, t0: 1000 + D / 2 });
  assert.equal(riseOffset(rises, 1000 + D / 2, null, 0, linear), 25 + 40);
  // Both settle on their own curve; nothing jumps.
  assert.equal(riseOffset(rises, 1000 + D, null, 0, linear), 20);
  assert.equal(riseOffset(rises, 1000 + D * 2, null, 0, linear), 0);
});

test('a sent row does not lift itself, and lifts from before a row appeared do not move it', () => {
  const rises = [{ id: 'a', height: 50, t0: 1000 }, { id: 'b', height: 40, t0: 1100 }];
  // Row a rises on its own entry: only b's lift moves it.
  assert.equal(riseOffset(rises, 1100, 'a', 900, linear), 40);
  // Row b appeared after a's lift began: a's lift is not its to undo.
  assert.equal(riseOffset(rises, 1100, 'b', 1050, linear), 0);
  assert.equal(riseProgress(rises[0], 1000 + D / 4, linear), 0.25);
});

function rowHarness({ reduced = false, target = { pageX: 7, pageY: 580, width: 346, height: 52 }, origin } = {}) {
  const exports = {};
  const animated = {
    default: { View: 'AnimatedView' },
    Easing: { bezierFn: () => x => x },
    measure: () => target,
    runOnUI: fn => fn,
    useAnimatedRef: () => ({}),
    useAnimatedStyle: fn => fn,
    useReducedMotion: () => reduced,
    useSharedValue: value => ({ value }),
  };
  const react = { useCallback: fn => fn, useRef: value => ({ current: value }) };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/chat/components/OutgoingMessageTransition.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, Date, require: name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
    if (name === 'react-native-reanimated') return animated;
    if (name === '../chatSendMotion') return sendMotionModule;
    throw new Error(name);
  } });
  const motion = createChatSendMotion();
  const now = Date.now();
  motion.setOrigin({ x: 340, y: 700, capturedAt: now, ...origin });
  motion.register('send', now);
  const rises = { value: [] };
  const clock = { rises, now: { value: now } };
  const lifted = [];
  motion.onRise((id, height) => { lifted.push([id, height]); rises.value = [...rises.value, { id, height, t0: clock.now.value }]; });
  const view = exports.OutgoingMessageTransition({ id: 'send', motion, clock, children: 'bubble' });
  return { view, motion, clock, lifted, style: view.props.style };
}

test('a sent row rises from the type box into place, on the shared clock, and lifts the rows above once', () => {
  const field = { rect: { x: 60, y: 700, width: 220, height: 44 } };
  const r = rowHarness({ origin: { field, text: 'hello' } });
  // Hidden until its start is known, so it never shows at the end first.
  assert.equal(r.style().opacity, 0);
  r.view.props.onLayout({ nativeEvent: { layout: { height: 52 } } });
  r.view.props.onLayout({ nativeEvent: { layout: { height: 52 } } });
  assert.deepEqual(r.lifted, [['send', 52]], 'one lift, its own height');
  // Starts with its bottom on the type box's bottom, at the box's text size.
  let style = r.style();
  assert.equal(style.opacity, 1);
  assert.equal(style.transform[0].translateY, 744 - (580 + 52));
  assert.equal(style.transform[1].scale, 17 / 16);
  // Ends exactly in place.
  r.clock.now.value += D;
  style = r.style();
  assert.equal(style.transform[0].translateY, 0);
  assert.equal(style.transform[1].scale, 1);
});

test('reduced motion, a missing layout or a send from elsewhere shows the row at once', () => {
  const reduced = rowHarness({ reduced: true });
  assert.equal(reduced.style().opacity, 1);
  reduced.view.props.onLayout({ nativeEvent: { layout: { height: 52 } } });
  assert.deepEqual(reduced.lifted, []);
  const noLayout = rowHarness();
  noLayout.view.props.onLayout();
  assert.equal(noLayout.style().opacity, 1);
  assert.deepEqual(noLayout.lifted, []);
});
