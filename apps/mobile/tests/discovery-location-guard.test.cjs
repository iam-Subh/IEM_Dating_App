const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the real save and permission handlers without a device or server.
function screen(status = {}, permission = {status: 'granted', accuracy: 'approximate'}, locationFails = false, putError) {
  const state = [], effects = [], dependencies = [], cleanup = [];
  let cursor = 0, putCount = 0, savedCount = 0, dialog;
  const react = {
    createElement: (type, props) => ({type, props}),
    useState(initial) {const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => {state[index] = typeof value === 'function' ? value(state[index]) : value;}];},
    useRef(initial) {const index = cursor++; if (!(index in state)) state[index] = {current: initial}; return state[index];},
    useEffect(callback, deps) {const index = cursor++; if (!dependencies[index] || deps.some((value, i) => value !== dependencies[index][i])) {dependencies[index] = deps; effects.push(() => {cleanup[index]?.(); cleanup[index] = callback();});}},
  };
  const modules = {
    react,
    'react-native': {StyleSheet: {create: value => value}, Alert: {alert: (_, __, buttons) => {dialog = buttons;}}},
    '@react-navigation/native': {useNavigation: () => ({})},
    'react-redux': {useDispatch: () => () => {}, useSelector: () => ({user: {gender: 'Man'}})},
    '../../../store/authSlice': {saveOnboardingDraft: value => value},
    '../../../services/api': {api: {
      async get(url) {return {data: {data: url === '/profile/location' ? status : url === '/profile/preferences' ? {areaOptions: {campus: {label: 'My campus'}}} : {
        discoveryCategory: 'man', showMeCategories: ['woman'], minAgePref: 20, maxAgePref: 28, discoveryMode: 'distance', collegeScope: 'campus',
      }}};},
      async put() {putCount++; if (putError) throw putError; return {data: {data: {preferencesConfirmedAt: 'confirmed'}}};}, async delete() {},
    }},
    '../../location/locationClient': {
      requestPermission: async () => permission,
      sendCurrentLocation: async () => {if (locationFails) throw new Error('No fix');},
      resetLocationSession() {}, locationErrorMessage: () => 'Could not get your location. Try again.',
    },
    '../../location/distanceUnits': {useDistanceUnit: () => 'km'},
    '../../auth/onboarding/OnboardingFrame': {}, '../../auth/onboarding/theme': {rose: {}}, './MatchingIntroduction': {},
  };
  const module = {exports: {}};
  const source = fs.readFileSync(path.join(__dirname, '../src/features/discovery/components/DiscoverySettings.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020}}).outputText,
    {module, exports: module.exports, require: id => modules[id] ?? require(id), setTimeout, clearTimeout});
  const render = () => {cursor = 0; const view = module.exports.DiscoverySettings({embedded: true, visible: true, onClose() {}, onSaved() {savedCount++;}}); while (effects.length) effects.shift()(); return view.props;};
  return {
    render,
    async load() {render(); await new Promise(resolve => setImmediate(resolve)); return render();},
    async share() {render().shareLocation(); await dialog.find(button => button.text === 'Continue').onPress(); return render();},
    counts: () => ({putCount, savedCount}), dispose: () => cleanup.forEach(fn => fn?.()),
  };
}

test('Continue blocks Nearby without location and points to Share location', async () => {
  const view = screen();
  try {await (await view.load()).onNext(); assert.equal(view.render().locationError, 'Tap Share location to use Nearby.'); assert.deepEqual(view.counts(), {putCount: 0, savedCount: 0});}
  finally {view.dispose();}
});

test('permission denial and a failed location fix keep Nearby blocked', async () => {
  for (const view of [screen({}, {status: 'denied', canAskAgain: true}), screen({}, undefined, true)]) {
    try {await view.load(); const props = await view.share(); assert.equal(props.locationReady, false); assert.ok(props.locationError); await props.onNext(); assert.equal(view.counts().putCount, 0);}
    finally {view.dispose();}
  }
});

test('a successful share clears the warning and permits Continue', async () => {
  const view = screen();
  try {await (await view.load()).onNext(); const props = await view.share(); assert.equal(props.locationReady, true); assert.equal(props.locationError, ''); await props.onNext(); assert.deepEqual(view.counts(), {putCount: 1, savedCount: 1});}
  finally {view.dispose();}
});

test('only a valid saved location or recent shared fix can bypass sharing', async () => {
  for (const [status, ready] of [
    [{consented: true, fresh: true, cell: {latitude: 0, longitude: 0}}, true],
    [{consented: true, canSavePlace: true}, true],
    [{consented: true, fresh: false, cell: {latitude: 0, longitude: 0}}, false],
    [{consented: false, fresh: true, cell: {latitude: 0, longitude: 0}}, false],
    [{consented: true, fresh: true, cell: null}, false],
  ]) {
    const view = screen(status);
    try {const props = await view.load(); assert.equal(props.locationReady, ready); await props.onNext(); assert.equal(view.counts().putCount, ready ? 1 : 0);}
    finally {view.dispose();}
  }
});

test('removing location clears its ready state', async () => {
  const view = screen({consented: true, fresh: true, cell: {latitude: 0, longitude: 0}});
  try {await (await view.load()).removeLocation(); assert.equal(view.render().locationReady, false); assert.equal(view.render().mode, 'college');}
  finally {view.dispose();}
});

test('a server rejection after location expires points back to Share location', async () => {
  const view = screen({consented: true, canSavePlace: true}, undefined, false, {response: {data: {code: 'LOCATION_REQUIRED'}}});
  try {await (await view.load()).onNext(); const props = view.render(); assert.equal(props.locationReady, false); assert.equal(props.locationError, 'Tap Share location to use Nearby.'); assert.equal(view.counts().savedCount, 0);}
  finally {view.dispose();}
});
