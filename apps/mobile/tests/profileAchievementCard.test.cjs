const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Render the component with controlled hooks, storage, focus, and timers.
// No native view or animation is required to check the completion lifecycle.
function harness(saved = new Map()) {
  const slots = [];
  const timers = new Map();
  let index = 0, focused = true, timerId = 0;
  let props = { accountId: 'a', tasks: [{ ok: true, title: 'Photos', label: 'Add photos', route: 'PhotoUpload' }], onOpen() {}, onNext() {} };
  const effects = [];
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useRef(value) { const i = index++; return slots[i] ??= { current: value }; },
    useState(value) { const i = index++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { slots[i] = next; }]; },
    useEffect(effect, deps) {
      const i = index++, previous = slots[i];
      if (!previous || deps.some((value, n) => value !== previous.deps[n])) {
        previous?.cleanup?.();
        slots[i] = { deps };
        effects.push(() => { slots[i].cleanup = effect(); });
      }
    },
  };
  const animated = { View: 'AnimatedView', createAnimatedComponent: value => value };
  const storage = {
    getItem: async key => saved.get(key) || null,
    setItem: async (key, value) => { saved.set(key, value); },
    removeItem: async key => { saved.delete(key); },
  };
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/screens/main/profile/ProfileAchievementCard.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: false,
  } }).outputText, {
    exports,
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name === 'react') return { ...react, default: react };
      if (name === '@react-native-async-storage/async-storage') return { default: storage };
      if (name === '@react-navigation/native') return { useIsFocused: () => focused };
      if (name === 'react-native') return { Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: value => value } };
      if (name === '@expo/vector-icons') return { Ionicons: 'Icon' };
      if (name === 'react-native-svg') return { default: 'Svg', Circle: 'Circle' };
      if (name === 'react-native-reanimated') return {
        default: animated, cancelAnimation() {}, Easing: { out: value => value, cubic() {} },
        FadeIn: { duration() {} }, FadeOut: { duration() {} },
        useAnimatedProps: fn => fn(), useAnimatedStyle: fn => fn(), useReducedMotion: () => false,
        useSharedValue: value => react.useRef({ value }).current, withTiming: value => value,
      };
      throw new Error(`Unexpected module: ${name}`);
    },
  });
  function render(update = {}) {
    props = { ...props, ...update };
    index = 0;
    const tree = exports.ProfileAchievementCard(props);
    effects.splice(0).forEach(effect => effect());
    return tree;
  }
  return {
    render, saved,
    focus(value) { focused = value; render(); },
    async settle(update) { render(update); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); return render(); },
    finish() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test('an initially complete profile celebrates, hides, and stays hidden after restart', async () => {
  const h = harness();
  assert.ok(await h.settle());
  h.finish();
  assert.equal(h.render(), null);
  h.unmount();
  assert.equal(await harness(h.saved).settle(), null);
});

test('removing a required detail restores the card and permits a new celebration', async () => {
  const h = harness(new Map([['profile-completion-celebrated:v1:a', '1']]));
  assert.equal(await h.settle(), null);
  assert.ok(await h.settle({ tasks: [{ ok: false, title: 'Photos', label: 'Add photos', route: 'PhotoUpload' }] }));
  assert.ok(await h.settle({ tasks: [{ ok: true, title: 'Photos', label: 'Add photos', route: 'PhotoUpload' }] }));
  h.finish();
  assert.equal(h.render(), null);
});

test('completion acknowledgement belongs to one account', async () => {
  const h = harness(new Map([['profile-completion-celebrated:v1:a', '1']]));
  assert.equal(await h.settle(), null);
  assert.ok(await h.settle({ accountId: 'b' }));
  h.finish();
  assert.equal(h.render(), null);
  assert.equal(h.saved.get('profile-completion-celebrated:v1:b'), '1');
});

test('leaving Profile before the celebration ends does not acknowledge completion', async () => {
  const h = harness();
  assert.ok(await h.settle());
  h.focus(false);
  h.finish();
  assert.equal(h.saved.size, 0);
  h.focus(true);
  assert.ok(await h.settle());
  h.finish();
  assert.equal(h.render(), null);
});

test('removing a detail cancels a pending completion dismissal', async () => {
  const h = harness();
  assert.ok(await h.settle());
  await h.settle({ tasks: [{ ok: false, title: 'Photos', label: 'Add photos', route: 'PhotoUpload' }] });
  h.finish();
  assert.ok(h.render());
  assert.equal(h.saved.size, 0);
});
