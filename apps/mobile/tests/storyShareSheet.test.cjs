const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(relative, requireStub) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/stories/create/editor', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: requireStub, requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} });
  return exports;
}
const requests = load('storyShareRequests.ts');

test('each audience choice completes once, even if transitionEnd and cleanup both run', () => {
  for (const choice of ['followers', 'close_friends', 'edit_close_friends', null]) {
    const received = [];
    const id = requests.createStoryShareRequest({ count: 8, avatar: null, canEditCloseFriends: true, onResult: value => received.push(value) });
    assert.equal(requests.storyShareRequest(id).count, 8);
    requests.finishStoryShareRequest(id, choice);
    requests.finishStoryShareRequest(id, choice);
    assert.deepEqual(received, [choice]);
    assert.equal(requests.storyShareRequest(id), undefined);
  }
});

test('closing the story editor cancels pending sharing without publishing', () => {
  let published = false;
  const id = requests.createStoryShareRequest({ count: 8, avatar: null, canEditCloseFriends: true, onResult: () => { published = true; } });
  requests.cancelStoryShareRequest(id);
  requests.finishStoryShareRequest(id, 'followers');
  assert.equal(published, false);
});

function sheetHarness() {
  let transitionEnd;
  let storyBack;
  let backCount = 0;
  const received = [];
  const id = requests.createStoryShareRequest({ count: 8, avatar: null, canEditCloseFriends: true, onResult: value => received.push(value) });
  const react = {
    useRef: value => ({ current: value }),
    useEffect: fn => fn(),
  };
  const module = load('StoryShareSheet.tsx', name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react-native') return { View: 'View', Pressable: 'Pressable', Text: 'Text', Image: 'Image', StyleSheet: { create: styles => styles } };
    if (name === '@react-navigation/native') return {
      useNavigation: () => ({ goBack: () => { backCount += 1; }, addListener: (name, fn) => { transitionEnd = fn; return () => {}; } }),
      useRoute: () => ({ params: { requestId: id } }),
    };
    if (name === '@expo/vector-icons') return { Ionicons: 'Icon' };
    if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 12 }) };
    if (name === 'expo-video-thumbnails') return {};
    if (name === '../../settings/storySettings') return { CLOSE_FRIENDS_GREEN: '#1DBF3A' };
    if (name === '../backStack') return { useStoryBack: fn => { storyBack = fn; } };
    if (name === './storyShareRequests') return requests;
    throw new Error(name);
  });
  const root = module.StoryShareSheetScreen();
  const find = (node, label) => {
    if (!node || typeof node !== 'object') return null;
    if (node.props?.accessibilityLabel === label) return node;
    return [].concat(node.props?.children ?? []).map(child => find(child, label)).find(Boolean);
  };
  return { received, backCount: () => backCount, transitionEnd: event => transitionEnd(event), back: () => storyBack(), button: label => find(root, label) };
}

test('sharing starts after the native sheet closes and a double tap cannot publish twice', () => {
  const sheet = sheetHarness();
  sheet.button('Share to your story').props.onPress();
  sheet.button('Share to Close Friends').props.onPress();
  assert.equal(sheet.backCount(), 1);
  assert.deepEqual(sheet.received, []);
  sheet.transitionEnd({ data: { closing: true } });
  sheet.transitionEnd({ data: { closing: true } });
  assert.deepEqual(sheet.received, ['followers']);
});

test('Android Back dismisses the share sheet without publishing', () => {
  const sheet = sheetHarness();
  assert.equal(sheet.back(), true);
  assert.equal(sheet.backCount(), 1);
  sheet.transitionEnd({ data: { closing: true } });
  assert.deepEqual(sheet.received, [null]);
});

test('Edit Close Friends closes the sheet before opening the list', () => {
  const sheet = sheetHarness();
  sheet.button('Edit Close Friends').props.onPress();
  assert.deepEqual(sheet.received, []);
  sheet.transitionEnd({ data: { closing: true } });
  assert.deepEqual(sheet.received, ['edit_close_friends']);
});
