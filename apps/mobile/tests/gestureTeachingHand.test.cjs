const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function hand({pose = 'point', reduced = false, direction = 'right', anchorAtContact = false} = {}) {
  const effects = [], shared = [], styles = [], animatedProps = [], timings = [], repeats = [], cancelled = [];
  let completions = 0;
  const react = {createElement: (type, props, ...children) => ({type, props, children}), useEffect: effect => effects.push(effect), useRef: value => ({current: value}), useCallback: fn => fn};
  const interpolate = (value, input, output) => {
    let i = 0;
    while (i < input.length - 2 && value > input[i + 1]) i++;
    return output[i] + (output[i + 1] - output[i]) * ((value - input[i]) / (input[i + 1] - input[i]));
  };
  const modules = {
    react: {...react, default: react},
    './TeachingHandArt': {TeachingHandArt: 'TeachingHandArt'},
    'react-native': {View: 'View', Text: 'Text', StyleSheet: {create: value => value}},
    'react-native-svg': {__esModule: true, default: 'Svg', Circle: 'Circle', G: 'G', Path: 'Path'},
    'react-native-reanimated': {__esModule: true, default: {View: 'AnimatedView', createAnimatedComponent: value => value},
      useReducedMotion: () => reduced, useSharedValue: value => {const result = {value}; shared.push(result); return result;},
      useAnimatedStyle: fn => {styles.push(fn); return fn;}, useAnimatedProps: fn => {animatedProps.push(fn); return fn;},
      cancelAnimation: value => cancelled.push(value), interpolate, runOnJS: fn => fn, Easing: {linear: 'linear'},
      withTiming: (value, options, callback) => {timings.push({value, options, callback}); return value;},
      withRepeat: (animation, count, reverse, callback) => {repeats.push({animation, count, reverse, callback}); return 0;},
    },
  };
  const exported = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/teaching/GestureTeachingHand.tsx'), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React},
  }).outputText, {exports: exported, require: name => {if (!modules[name]) throw new Error(name); return modules[name];}});
  exported.GestureTeachingHand({pose, direction, anchorAtContact, text: 'Gesture tip', onComplete: () => completions++});
  const cleanups = effects.map(effect => effect());
  return {shared, styles, animatedProps, timings, repeats, cancelled, cleanups, completions: () => completions};
}

test('each teaching gesture plays twice and finishes after the fade', () => {
  for (const pose of ['point', 'hold', 'swipe', 'longPress']) {
    const h = hand({pose});
    assert.equal(h.repeats.length, 1);
    assert.equal(h.repeats[0].count, 2);
    assert.equal(h.timings[0].options.duration, 1500);
    h.repeats[0].callback(true);
    assert.equal(h.completions(), 0);
    assert.equal(h.timings[1].options.duration, 220);
    h.timings[1].callback(true);
    assert.equal(h.completions(), 1);
  }
});

test('Reduce Motion schedules no animation and keeps the hand and label visible', () => {
  for (const pose of ['point', 'hold', 'swipe', 'longPress']) {
    const h = hand({pose, reduced: true});
    assert.equal(h.repeats.length, 0);
    assert.equal(h.timings.length, 0);
    assert.equal(h.styles[0]().opacity, 1);
    assert.equal(h.styles[1]().opacity, 1);
    assert.equal(h.styles[2]().opacity, 1);
  }
});

test('tap presses 6 pixels, the hold ring fills, and long-press text waits 600 milliseconds', () => {
  const tap = hand(); tap.shared[0].value = 0.18;
  assert.equal(tap.styles[0]().transform[1].translateY, 6);
  const hold = hand({pose: 'hold'}); hold.shared[0].value = 0.75;
  assert.equal(hold.animatedProps[1]().strokeDashoffset, 0);
  const long = hand({pose: 'longPress'}); long.shared[0].value = 0.55;
  assert.equal(long.styles[2]().opacity, 0);
  long.shared[0].value = 0.6;
  assert.equal(long.styles[2]().opacity, 1);
});

test('unmount cancels both animations', () => {
  const h = hand(); h.cancelled.length = 0;
  h.cleanups.forEach(cleanup => cleanup?.());
  assert.equal(h.cancelled.length, 2);
  assert.ok(h.cancelled.includes(h.shared[0]));
  assert.ok(h.cancelled.includes(h.shared[1]));
});

test('anchored tap and hold contact the target without overshooting it', () => {
  for (const pose of ['point', 'hold', 'longPress']) {
    const h = hand({pose, anchorAtContact: true});
    assert.equal(h.styles[0]().transform[1].translateY, -6);
    h.shared[0].value = 0.18;
    assert.equal(h.styles[0]().transform[1].translateY, 0);
  }
});
