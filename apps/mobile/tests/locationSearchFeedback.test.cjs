const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const flush = () => new Promise(resolve => setImmediate(resolve));

function hook({permission = 'granted', quietRefresh = false} = {}) {
  const cells = [], dependencies = [], effects = [], cleanup = [];
  let cursor = 0, gpsCalls = 0, resolveGps, rejectGps, onSettings;
  const changed = [];
  const gps = new Promise((resolve, reject) => {resolveGps = resolve; rejectGps = reject;});
  let status = {mode: 'distance', source: 'live', fresh: false, cell: null, updatedAt: null, places: []};
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) {const i = cursor++; if (!(i in cells)) cells[i] = initial; return [cells[i], value => {cells[i] = typeof value === 'function' ? value(cells[i]) : value;}];},
    useRef(initial) {const i = cursor++; return cells[i] ?? (cells[i] = {current: initial});},
    useCallback(fn, deps) {const i = cursor++; if (!same(dependencies[i], deps)) {cells[i] = fn; dependencies[i] = deps;} return cells[i];},
    useEffect(fn, deps) {const i = cursor++; if (!same(dependencies[i], deps)) {dependencies[i] = deps; effects.push(() => {cleanup[i]?.(); cleanup[i] = fn();});}},
  };
  const modules = {
    react,
    'react-native': {AppState: {addEventListener: () => ({remove() {}})}},
    '../../services/api': {api: {
      async get(url) {return {data: {data: url === '/profile/location' ? status : {}}};},
      async put(url) {status = {...status, mode: url === '/profile/discovery' ? 'college' : 'distance', source: 'place', fresh: true, cell: {latitude: 1, longitude: 1}};},
    }},
    './locationClient': {
      onLocationSessionReset() {}, onLocationSettingsChanged(fn) {onSettings = fn; return () => {};},
      readPermission: async () => ({status: permission, canAskAgain: true}),
      requestPermission: async () => ({status: permission, canAskAgain: true}),
      sendCurrentLocation: () => {gpsCalls++; return gps;},
      refreshIfDue: async options => {
        if (!quietRefresh || permission !== 'granted') return 'skipped';
        options.onLocate(); gpsCalls++; return gps;
      },
      locationErrorMessage: () => 'Location unavailable. Try again.',
    },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/location/useLocationGate.ts'), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  }).outputText, {exports, require: id => modules[id]});
  const render = () => {cursor = 0; const result = exports.useLocationGate(true, next => changed.push(next)); while (effects.length) effects.shift()(); return result;};
  return {
    render, changed, settings: () => onSettings(), gpsCalls: () => gpsCalls,
    async load() {render(); await flush(); return render();},
    success() {status = {...status, fresh: true, cell: {latitude: 1, longitude: 1}}; resolveGps({changed: true});},
    failure() {rejectGps(new Error('GPS unavailable'));},
    dispose() {cleanup.forEach(fn => fn?.());},
  };
}

test('permission denial never starts location loading or a GPS request', async () => {
  const view = hook({permission: 'denied'});
  try {
    const loaded = await view.load(); await loaded.actions.turnOn();
    assert.equal(view.render().locating, false);
    assert.equal(view.render().kind, 'off');
    assert.equal(view.gpsCalls(), 0);
    assert.equal(view.changed.length, 0);
  } finally {view.dispose();}
});

test('location loading covers the actual GPS request and clears after a confirmed result', async () => {
  const view = hook();
  try {
    const loaded = await view.load(); const pending = loaded.actions.turnOn(); await flush();
    assert.equal(view.render().locating, true);
    assert.equal(view.gpsCalls(), 1);
    assert.equal(view.changed.length, 0);
    view.success(); await pending;
    assert.equal(view.render().locating, false);
    assert.equal(view.render().kind, 'none');
    assert.equal(view.changed[0].fresh, true);
  } finally {view.dispose();}
});

test('a failed GPS request stops loading and keeps the retry gate and error', async () => {
  const view = hook();
  try {
    const loaded = await view.load(); const pending = loaded.actions.retry(); await flush();
    assert.equal(view.render().locating, true);
    view.failure(); await pending;
    const result = view.render();
    assert.equal(result.locating, false);
    assert.equal(result.kind, 'refresh');
    assert.equal(result.error, 'Location unavailable. Try again.');
    assert.equal(view.changed.length, 0);
  } finally {view.dispose();}
});

test('a due background refresh shows location loading and publishes the accepted status', async () => {
  const view = hook({quietRefresh: true});
  try {
    await view.load(); assert.equal(view.render().locating, true);
    view.success(); await flush();
    assert.equal(view.render().locating, false);
    assert.equal(view.changed.length, 1);
    assert.equal(view.changed[0].fresh, true);
  } finally {view.dispose();}
});

test('saved-place and college changes do not start GPS loading', async () => {
  const view = hook();
  try {
    await (await view.load()).actions.usePlace('saved-place');
    assert.equal(view.render().locating, false);
    await view.render().actions.switchToCollege();
    assert.equal(view.render().locating, false);
    assert.equal(view.gpsCalls(), 0);
    assert.equal(view.changed.at(-1).mode, 'college');
  } finally {view.dispose();}
});
