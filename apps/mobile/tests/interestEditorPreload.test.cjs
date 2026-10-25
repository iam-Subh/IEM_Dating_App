const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Run the editor hooks without creating native views. Check the draft and
// selection state across preload, focus, and a return from the selection sheet.
function editor(formOptions) {
  let cursor = 0;
  let focused = false;
  let changed = false;
  let focusChanged = false;
  const slots = [];
  const effects = [];
  const timers = new Map();
  const drafts = [];
  const preloads = [];
  const destinations = [];
  let timerId = 0;
  let focusCallback;
  let focusCleanup;
  const route = {key:'interest-editor', params:{reviewEdit:true}};
  let data = {preferences:{interests:['nba'], bio:'Saved bio'}, clubs:['Music Club']};
  const navigation = {isFocused:() => focused, preload:(...args) => preloads.push(args), navigate:(...args) => destinations.push(args)};
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => value === b[index]);
  const react = {
    startTransition: callback => callback(),
    // The catalogue component holds the groups; render it in place.
    createElement:(type, props, ...children) => ['InterestCatalog', 'InterestForm'].includes(type?.name) ? type(props) : ({type, props:{...props, children}}),
    forwardRef:callback => callback, useMemo:callback => callback(),
    memo:value => value,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => {
        const next = typeof value === 'function' ? value(slots[index]) : value;
        if (next !== slots[index]) {slots[index] = next; changed = true;}
      }];
    },
    useRef(initial) {const index = cursor++; return slots[index] ??= {current:initial};},
    useCallback(callback, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = {callback, deps};
      return slots[index].callback;
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) effects.push(() => {
        slots[index]?.cleanup?.(); slots[index] = {deps, cleanup:callback()};
      });
    },
  };
  react.useLayoutEffect = react.useEffect;
  const gesture = () => new Proxy({}, {get:() => () => gesture()});
  const animated = {View:'AnimatedView', Text:'AnimatedText', ScrollView:'AnimatedScrollView', createAnimatedComponent:() => 'AnimatedTextInput'};
  const modules = {
    react:{...react, default:react},
    'react-native':{Keyboard:{dismiss() {}}, Platform:{OS:'android'}, ScrollView:'ScrollView', StatusBar:'StatusBar', Text:'Text', TextInput:'TextInput', View:'View', StyleSheet:{create:value => value, absoluteFill:{}}, useWindowDimensions:() => ({fontScale:1})},
    '@react-navigation/native':{
      useIsFocused:() => focused, useNavigation:() => navigation, useRoute:() => route, CommonActions:{},
      useFocusEffect(callback) {
        const index = cursor++;
        if (slots[index] !== callback) {slots[index] = callback; focusCallback = callback; focusChanged = true;}
      },
    },
    'react-native-keyboard-controller':{KeyboardAvoidingView:'KeyboardAvoidingView', useKeyboardState:() => false, useReanimatedKeyboardAnimation:() => ({progress:{value:0}})},
    'react-native-reanimated':{
      __esModule:true, default:animated, useSharedValue:initial => {
        const index = cursor++; return slots[index] ??= {value:initial};
      },
      useAnimatedRef:() => react.useRef(null),
      useDerivedValue:callback => ({get value() {return callback();}}),
      useAnimatedStyle:callback => callback(), useAnimatedProps:callback => callback(),
      useAnimatedReaction() {}, useEvent:callback => callback, interpolate:() => 0, runOnUI:fn => fn, runOnJS:fn => fn,
      Easing:{quad:() => {}, out:value => value},
    },
    'react-native-gesture-handler':{Gesture:{Tap:gesture}, GestureDetector:'GestureDetector'},
    'expo-linear-gradient':{LinearGradient:'Gradient'}, '@expo/vector-icons':{Ionicons:'Icon'},
    'react-native-safe-area-context':{useSafeAreaInsets:() => ({bottom:0})},
    'react-native-svg':{__esModule:true, default:'Svg', G:'G', Path:'Path', Rect:'Rect'},
    '@iem-dating/shared/interest-catalog':require('@iem-dating/shared/interest-catalog'),
    '../../../core/profile/profileOptions':{PROFILE_CLUBS:['Music Club']},
    './InterestGroupView': {InterestGroupView: () => null, CLUB_LIMIT: 5, INTEREST_LIMIT: 100},
    './OnboardingFormArtwork': {InterestArtwork: () => null},
    '../../../components/EditScreenHeader': {EditScreenHeader: 'EditHeader'},
    '../../../components/ProfileEditForms': {FormSheet: 'FormSheet'},
    './afterScreenTransition': {afterScreenTransition: (_navigation, callback) => {callback(); return () => {}; }},
    './useOptionalSave':{useOptionalSave:() => ({data, route, navigation, editing:true, busy:false, draft:fields => drafts.push(fields)})},
    './InterestVisuals':{interestEmojis:{}, interestGradient:() => ['pink','plum']},
    './ConnectionDesign':{ConnectionFooter:'Footer', ConnectionNav:'Nav', ConnectionSheetHeader:'Header', RoundedTick:'Tick', TapChoice:'Button', connectionColors:{}, connectionStyles:{}},
  };
  const exported = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
    '../src/features/auth/onboarding/InterestIntroduction.tsx'), 'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.React, target:ts.ScriptTarget.ES2020},
  }).outputText, {
    exports:exported, require:name => {if (!modules[name]) throw new Error(name); return modules[name];},
    setTimeout:callback => {const id = ++timerId; timers.set(id, callback); return id;},
    clearTimeout:id => timers.delete(id), requestAnimationFrame:callback => {callback(); return 1;}, cancelAnimationFrame() {},
  });
  let tree;
  function render() {
    do {
      changed = false; cursor = 0;
      tree = formOptions ? exported.InterestForm({controller:modules['./useOptionalSave'].useOptionalSave(), ...formOptions}) : exported.InterestIntroduction();
      if (focused && focusChanged) {focusCleanup?.(); focusCleanup = focusCallback();}
      focusChanged = false;
      while (effects.length) effects.shift()();
    } while (changed);
  }
  function find(predicate, node = tree) {
    if (!node || typeof node !== 'object') return;
    if (predicate(node)) return node;
    for (const child of node.props?.children?.flat(Infinity) || []) {const result = find(predicate, child); if (result) return result;}
  }
  render();
  return {
    drafts, preloads, destinations, render,
    openReview() {find(node => node.props?.accessibilityLabel === 'View selected interests').props.onAccessibilityTap();},
    data(value) {data = value; render();},
    focus(value) {
      if (focused === value) return;
      focused = value;
      if (value) focusChanged = true; else {focusCleanup?.(); focusCleanup = undefined;}
      render();
    },
    returnSelection(selection) {route.params = {...route.params, interestSelection:selection}; render();},
    flush() {for (const [id, callback] of [...timers]) {timers.delete(id); callback();} render();},
    count() {return find(node => node.props?.accessibilityLiveRegion === 'polite' && node.type === 'AnimatedTextInput').props.defaultValue;},
    group(id) {return find(node => typeof node.type === 'function' && node.props?.category && node.props.group?.id === id);},
    selection() {return {interests: this.group('fan_favorites').props.selected, clubs: this.group('college_clubs')?.props.selected ?? []};},
    groupCount() {
      let total = 0;
      const walk = node => {
        if (!node || typeof node !== 'object') return;
        if (typeof node.type === 'function' && node.props?.category) total++;
        for (const child of node.props?.children?.flat(Infinity) || []) walk(child);
      };
      walk(tree);
      return total;
    },
  };
}

test('preloading the hidden Interests editor does not update the onboarding draft or open a sheet', () => {
  const screen = editor();
  screen.flush();
  assert.equal(screen.drafts.length, 0);
  assert.equal(screen.preloads.length, 0);
});

test('the preloaded editor reads the latest answers on first focus', () => {
  const screen = editor();
  screen.data({preferences:{interests:['nba','manga'], bio:'Latest bio'}, clubs:[]});
  screen.focus(true);
  assert.equal(screen.count(), '2 selected');
  assert.deepEqual(Array.from(screen.selection().interests), ['nba','manga']);
  screen.flush();
  assert.deepEqual(Array.from(screen.drafts[0].preferences.interests), ['nba','manga']);
  assert.equal(screen.drafts[0].preferences.bio, 'Latest bio');
});

test('returning from the selection sheet keeps removals instead of resetting saved answers', () => {
  const screen = editor();
  screen.focus(true);
  screen.focus(false);
  screen.returnSelection({interests:[], clubs:[]});
  screen.focus(true);
  assert.equal(screen.count(), 'Find a few favourites');
  assert.equal(screen.selection().interests.length, 0);
  assert.equal(screen.selection().clubs.length, 0);
  screen.flush();
  assert.equal(screen.drafts[0].preferences.interests.length, 0);
});

test('leaving the editor cancels its pending draft update', () => {
  const screen = editor();
  screen.focus(true);
  screen.focus(false);
  screen.flush();
  assert.equal(screen.drafts.length, 0);
});

test('the catalogue renders its first groups at once and the rest after the page appears', () => {
  const screen = editor();
  assert.equal(screen.groupCount(), 2);
  screen.focus(true);
  assert.equal(screen.groupCount(), 13);
});

test('tapping interests updates the count, and the club limit holds', () => {
  const screen = editor();
  screen.focus(true);
  const music = screen.group('music');
  music.props.onToggle('k_pop', false);
  screen.render();
  assert.equal(screen.count(), '3 selected');
  const clubs = screen.group('college_clubs');
  for (const club of ['A', 'B', 'C', 'D', 'E', 'F']) clubs.props.onToggle(club, true);
  screen.render();
  assert.equal(screen.selection().clubs.length, 5);
  clubs.props.onToggle('Music Club', true);
  screen.render();
  assert.equal(screen.selection().clubs.length, 4);
});

test('profile interests excludes clubs and opens the native review route with the current selection', () => {
  const screen = editor({dark:true, includeClubs:false});
  screen.focus(true);
  assert.equal(screen.groupCount(),12);
  assert.equal(screen.group('college_clubs'),undefined);
  assert.equal(screen.count(),'1 selected');
  assert.equal(screen.preloads[0][0],'ProfileInterestSelectionReview');
  screen.openReview();
  assert.equal(screen.destinations[0][0],'ProfileInterestSelectionReview');
  assert.equal(screen.destinations[0][1].returnKey,'interest-editor');
  assert.equal(screen.destinations[0][1].clubs.length,0);
  screen.focus(false);
  screen.returnSelection({interests:[],clubs:['Music Club']});
  screen.focus(true);
  assert.equal(screen.count(),'Find a few favourites');
  assert.equal(screen.selection().interests.length,0);
  assert.equal(screen.group('college_clubs'),undefined);
});
