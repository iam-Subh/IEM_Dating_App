const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Run the actual gesture callbacks. Native recognition still needs a device.
function preview(cached = true, minimal = false) {
  const shared = [];
  const gestures = {};
  const cancelled = [];
  const states = [{width:360,height:640}, undefined, undefined, false, 0, false];
  let state = 0;
  const react = {
    createElement: (type, props, ...children) => ({type, props: {...props, children}}),
    useState: initial => {const value=states[state++];return [value === undefined ? typeof initial === 'function' ? initial() : initial : value, () => {}];},
    useEffect: () => {},
  };
  const createGesture = name => {
    const target = {callbacks: {}, config: {}};
    const proxy = new Proxy(target, {get(object, key) {
      if (key in object) return object[key];
      return value => {
        if (key.startsWith('on')) object.callbacks[key] = value;
        else object.config[key] = value;
        return proxy;
      };
    }});
    gestures[name] = proxy;
    return proxy;
  };
  const exported = {};
  const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/auth/onboarding', file), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020},
  }).outputText;
  const cache = {};
  vm.runInNewContext(compile('photoPreviewCache.ts'), {exports: cache});
  if (cached) cache.rememberPreviewPhoto('file:///photo.jpg', {width:360,height:640});
  const geometry = {};
  vm.runInNewContext(compile('photoPreviewGeometry.ts'), {exports: geometry});
  const animated = {View: 'AnimatedView', Image: 'AnimatedImage'};
  const modules = {
    react: {...react, default: react},
    'react-native': {View: 'View', Text: 'Text', Modal: 'Modal', StatusBar: 'StatusBar', ActivityIndicator: 'Spinner', StyleSheet: {create:value => value, absoluteFill:{position:'absolute',top:0,bottom:0,left:0,right:0}}},
    'react-native-safe-area-context': {SafeAreaView: 'SafeAreaView'},
    '@expo/vector-icons': {Ionicons: 'Icon'},
    'react-native-gesture-handler': {GestureDetector: 'Detector', GestureHandlerRootView: 'Root', Gesture: {
      Pinch: () => createGesture('pinch'), Pan: () => createGesture('pan'), Tap: () => createGesture('tap'),
      Simultaneous: (...items) => ({kind: 'simultaneous', items}), Exclusive: (...items) => ({kind: 'exclusive', items}),
    }},
    'react-native-reanimated': {__esModule: true, default: animated,
      useSharedValue: value => {const result = {value}; shared.push(result); return result;},
      useAnimatedStyle: value => value, withTiming: value => value, cancelAnimation: value => cancelled.push(value),
    },
    './ConnectionDesign': {TapChoice: 'Button', connectionStyles: {}},
    './photoPreviewGeometry': geometry,
    './photoPreviewCache': cache,
  };
  vm.runInNewContext(compile('ProfilePhotoPreview.tsx'), {exports: exported, require: name => {
    if (!modules[name]) throw new Error(name);
    return modules[name];
  }});
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return;
    if (predicate(node)) return node;
    for (const child of node.props?.children?.flat(Infinity) || []) {
      const result = find(child, predicate);
      if (result) return result;
    }
  };
  const root = exported.ProfilePhotoPreview({photos: ['file:///photo.jpg'], index: 0, onIndex() {}, onClose() {}});
  const child = find(root, node => typeof node.type === 'function');
  const tree = child.type({...child.props, controls: !minimal});
  const composition = find(tree, node => node.type === 'Detector').props.gesture;
  return {gestures, composition, shared, cancelled, cache, image:find(tree,node => node.type === 'AnimatedImage'), spinner:find(tree,node => node.type === 'Spinner'),
    transform: () => ({scale: shared[0].value, x: shared[1].value, y: shared[2].value}),
  };
}

test('drag does not wait for double-tap and remains available after a pinch', () => {
  const p = preview();
  assert.equal(p.composition.kind, 'simultaneous');
  assert.equal(p.composition.items.length, 3);
  assert.ok(p.composition.items.includes(p.gestures.pan));
  assert.equal(p.gestures.pan.config.maxPointers, undefined);
  const pinch = p.gestures.pinch.callbacks;
  const pan = p.gestures.pan.callbacks;
  pan.onBegin();
  pinch.onStart({focalX: 180, focalY: 320});
  pinch.onUpdate({scale: 2, focalX: 200, focalY: 330});
  assert.deepEqual(p.transform(), {scale: 2, x: 20, y: 10});
  pan.onChange({changeX: 100, changeY: 100, numberOfPointers: 2});
  assert.deepEqual(p.transform(), {scale: 2, x: 20, y: 10});
  pinch.onFinalize();
  pan.onChange({changeX: 12, changeY: -7, numberOfPointers: 1});
  assert.deepEqual(p.transform(), {scale: 2, x: 32, y: 3});
});

test('the single-photo viewer double-taps in and out and resets its pan', () => {
  const p = preview(true, true);
  const tap = p.gestures.tap.callbacks;
  tap.onEnd({x: 260, y: 400}, false);
  assert.deepEqual(p.transform(), {scale: 1, x: 0, y: 0});
  tap.onEnd({x: 260, y: 400}, true);
  assert.deepEqual(p.transform(), {scale: 2.5, x: -120, y: -120});
  p.gestures.pan.callbacks.onChange({changeX: 20, changeY: 10, numberOfPointers: 1});
  tap.onEnd({x: 220, y: 380}, true);
  assert.deepEqual(p.transform(), {scale: 1, x: 0, y: 0});
});

test('drag responds immediately when the user reverses direction at an edge', () => {
  const p = preview();
  p.gestures.tap.callbacks.onEnd({x: 180, y: 320}, true);
  const pan = p.gestures.pan.callbacks;
  pan.onBegin();
  assert.ok(p.cancelled.includes(p.shared[0]));
  pan.onChange({changeX: 1000, changeY: 0, numberOfPointers: 1});
  assert.equal(p.transform().x, 270);
  pan.onChange({changeX: -10, changeY: 0, numberOfPointers: 1});
  assert.equal(p.transform().x, 260);
});

test('pinch cancellation restores dragging and two fingers cannot trigger double-tap zoom', () => {
  const p = preview();
  p.gestures.pinch.callbacks.onStart({focalX: 180, focalY: 320});
  p.gestures.pinch.callbacks.onUpdate({scale: 2, focalX: 180, focalY: 320});
  p.gestures.pinch.callbacks.onFinalize();
  p.gestures.pan.callbacks.onChange({changeX: 8, changeY: 4, numberOfPointers: 1});
  assert.deepEqual(p.transform(), {scale: 2, x: 8, y: 4});
  let failed = false;
  p.gestures.tap.callbacks.onTouchesDown({numberOfTouches: 2}, {fail() {failed = true;}});
  assert.equal(failed, true);
});


test('opening the photo uses its full viewport before metadata arrives, without a spinner flash', () => {
  for (const cached of [true,false]) {
    const p=preview(cached);
    assert.deepEqual({...p.image.props.style[0]}, {position:'absolute',top:0,bottom:0,left:0,right:0});
    assert.equal(p.spinner,undefined);
    assert.equal(p.gestures.pinch.config.enabled,cached);
    p.image.props.onLoad({nativeEvent:{source:{width:1200,height:2400}}});
    assert.deepEqual({...p.cache.previewPhotoSize('file:///photo.jpg')}, {width:1200,height:2400});
  }
});
