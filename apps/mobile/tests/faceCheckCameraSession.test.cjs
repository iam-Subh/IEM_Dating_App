const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function deferred() {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
}
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() {for (let i = 0; i < 60; i++) await tick();}

function screen({challengeRequest, photoRequest, uploadRequest, submitRequest, challengeAnswers = [], detect, onWait, result = {status: 'verified', reason: null}, params = {}, canGoBack = true, actions = ['blink', 'left', 'smile']} = {}) {
  const state = [];
  const calls = {challenge: 0, capture: 0, submit: 0, upload: 0, deletes: [], back: 0, replace: [], reset: [], brightness: [], resultChecks: 0};
  const effects = [];
  let cursor = 0;
  const react = {
    createElement: (type, props, ...children) => ({type, props: {...props, children}}),
    useState(value) {const index = cursor++; if (!(index in state)) state[index] = value; return [state[index], next => {state[index] = next;}];},
    useRef(value) {const index = cursor++; return state[index] ??= {current: value};},
    useCallback: fn => fn,
    useMemo: fn => fn(),
    // Runs again when its dependencies change, as React does.
    useEffect(fn, deps) {
      const index = cursor++;
      const previous = state[index];
      if (previous && deps && deps.every((value, i) => Object.is(value, previous[i]))) return;
      if (previous && !deps) return;
      state[index] = deps ?? [];
      effects.push(fn());
    },
  };
  const challenge = {challengeId: 'test', actions, framesPerStep: 1,
    uploads: ['straight', ...actions].map(step => ({step, index: 0, uploadUrl: 'test-upload', contentType: 'image/jpeg'}))};
  const photoOutput = {async capturePhoto() {
    calls.capture++;
    if (photoRequest) await photoRequest();
    const index = calls.capture;
    return {saveToTemporaryFileAsync: async () => `file://photo-${index}`, dispose() {}};
  }};
  const modules = {
    react: {...react, default: react},
    './FaceCheckIntroduction': {FaceCheckIntroduction: 'Intro'},
    './FaceCheckCamera': {FaceCheckCamera: 'CameraPage'},
    './FaceCheckFailure': {FaceCheckFailure: 'Failure'},
    './FaceCheckResult': {FaceCheckResult: 'Result'},
    './MediaCorrectionPage': {MediaCorrectionPage: 'Correction'},
    'react-native': {NativeModules: detect ? {FaceDetection: {}} : {}, ActivityIndicator: 'Spinner', Alert: {alert() {}}, Image: 'Image', Linking: {}, Pressable: 'Button', ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: {create: v => v, absoluteFill: {}}},
    '@react-native-ml-kit/face-detection': {default: {detect}},
    '@react-navigation/native': {useNavigation: () => ({canGoBack: () => canGoBack, goBack() {calls.back++;}, replace(...args) {calls.replace.push(args);}, reset(value) {calls.reset.push(value);}}), useRoute: () => ({params})},
    '@expo/vector-icons': {Ionicons: 'Icon'},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 24, bottom: 24})},
    'expo-haptics': {ImpactFeedbackStyle: {Light: 'light'}, impactAsync: async () => {}},
    'expo-image-manipulator': {SaveFormat: {JPEG: 'jpeg'}, manipulateAsync: async uri => ({uri: `${uri}-small`})},
    'expo-file-system': {UploadType: {BINARY_CONTENT: 'binary'}, File: class {
      constructor(uri) {this.uri = uri;}
      delete() {calls.deletes.push(this.uri);}
      async upload() {calls.upload++; if (uploadRequest) await uploadRequest(); return {status: 200};}
    }},
    'react-native-vision-camera': {Camera: 'Camera', useCameraDevice: () => ({}), useCameraPermission: () => ({hasPermission: true}), usePhotoOutput: () => photoOutput},
    '../../services/api': {api: {async post(url) {
      if (url.endsWith('challenge')) {calls.challenge++; if (challengeRequest) await challengeRequest(); return {data: {data: challenge}};}
      calls.submit++; if (submitRequest) await submitRequest(calls.submit); return {data: {data: result}};
    },
    // How a check ended, after the app lost submit's answer. Then: expired.
    async get(url) {
      assert.ok(url.endsWith('/verification/face/challenge/test'));
      return {data: {data: challengeAnswers[calls.resultChecks++] ?? {state: 'expired'}}};
    }}},
    '../../store': {store: {getState: () => ({auth: {isAuthenticated: true}})}},
    './useVerificationStatus': {refreshVerificationStatus: async () => {}},
    './captureBrightness': {raiseCaptureBrightness: async () => {calls.brightness.push('raise');}, restoreCaptureBrightness: async () => {calls.brightness.push('restore');}},
    '../auth/onboarding/onboardingNavigation': {openOnboardingReview() {}},
  };
  const exported = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/features/verification/RealPersonCheckScreen.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020}}).outputText,
    {exports: exported, setTimeout: (fn, ms) => {onWait?.(ms); return setImmediate(fn);}, require: name => {if (!modules[name]) throw new Error(name); return modules[name];}});
  const render = () => {cursor = 0; return exported.RealPersonCheckScreen();};
  return {render, calls, unmount() {effects.forEach(cleanup => cleanup?.());}};
}

test('camera startup does not capture; ready starts only once during a pending request', async () => {
  const pending = deferred();
  const page = screen({challengeRequest: () => pending.promise});
  await page.render().props.onStart();
  const opening = page.render();
  opening.props.onReady();
  assert.equal(page.calls.challenge, 0);
  opening.props.preview.props.onStarted();
  const ready = page.render();
  assert.equal(ready.props.ready, true);
  assert.equal(ready.props.step, 1);
  assert.equal(page.calls.capture, 0);
  ready.props.onReady();
  ready.props.onReady();
  assert.equal(page.calls.challenge, 1);
  ready.props.onClose();
  pending.resolve();
  await settle();
  assert.equal(page.calls.capture, 0);
  assert.equal(page.calls.submit, 0);
});

test('completion captures four steps, submits once, and rejects a queued second ready press', async () => {
  const page = screen();
  await page.render().props.onStart();
  page.render().props.preview.props.onStarted();
  const ready = page.render();
  ready.props.onReady();
  await settle();
  assert.equal(page.calls.capture, 4);
  assert.equal(page.calls.upload, 4);
  assert.equal(page.calls.submit, 1);
  assert.equal(page.calls.deletes.length, 4);
  ready.props.onReady();
  assert.equal(page.calls.challenge, 1);
});

test('closing during a pending capture deletes its frame and stops upload and submission', async () => {
  const pending = deferred();
  const page = screen({photoRequest: () => pending.promise});
  await page.render().props.onStart();
  page.render().props.preview.props.onStarted();
  page.render().props.onReady();
  await settle();
  assert.equal(page.calls.capture, 1);
  page.render().props.onClose();
  pending.resolve();
  await settle();
  assert.deepEqual(page.calls.deletes, ['file://photo-1-small']);
  assert.equal(page.calls.upload, 0);
  assert.equal(page.calls.submit, 0);
});

test('unmounting during the challenge prevents capture', async () => {
  const pending = deferred();
  const page = screen({challengeRequest: () => pending.promise});
  await page.render().props.onStart();
  page.render().props.preview.props.onStarted();
  page.render().props.onReady();
  page.unmount();
  pending.resolve();
  await settle();
  assert.equal(page.calls.capture, 0);
  assert.equal(page.calls.submit, 0);
});

test('retry after a failed challenge starts a fresh session only after ready', async () => {
  let attempts = 0;
  const page = screen({challengeRequest: async () => {if (++attempts === 1) throw new Error('offline');}});
  await page.render().props.onStart();
  page.render().props.preview.props.onStarted();
  page.render().props.onReady();
  await settle();
  assert.equal(page.render().type, 'Failure');
  assert.equal(page.render().props.result.reason, 'connection');
  await page.render().props.onRetry();
  const retry = page.render();
  assert.equal(retry.props.ready, false);
  assert.equal(retry.props.started, false);
  assert.equal(retry.props.completed, 0);
  retry.props.preview.props.onStarted();
  page.render().props.onReady();
  await settle();
  assert.equal(page.calls.challenge, 2);
  assert.equal(page.calls.submit, 1);
});

test('green confirmation requires a positive detection result for the current step', async () => {
  const confirmations = [];
  const page = screen({
    detect: async uri => {
      const index = Number(uri.match(/photo-(\d+)/)[1]);
      return [{rotationY: index === 3 ? 25 : 0, leftEyeOpenProbability: index === 2 ? 0 : 1,
        rightEyeOpenProbability: index === 2 ? 0 : 1, smilingProbability: index === 4 ? 1 : 0}];
    },
    onWait(ms) {
      const props = page.render().props;
      if (ms === 500) confirmations.push({captured: props.captured, confirmed: props.confirmed});
      if (ms === 1500 || ms === 2200) assert.equal(props.confirmed, false, 'Each new prompt resets confirmation');
    },
  });
  await page.render().props.onStart();
  page.render().props.preview.props.onStarted();
  page.render().props.onReady();
  await settle();
  assert.deepEqual(confirmations, Array.from({length: 4}, () => ({captured: true, confirmed: true})));
  assert.equal(page.calls.submit, 1);
});

test('frames captured without local detection do not show green confirmation', async () => {
  const confirmations = [];
  const page = screen({onWait(ms) {if (ms === 500) confirmations.push(page.render().props.confirmed);}});
  await page.render().props.onStart();
  page.render().props.preview.props.onStarted();
  page.render().props.onReady();
  await settle();
  assert.deepEqual(confirmations, [false, false, false, false]);
  assert.equal(page.calls.submit, 1);
});

test('failed detection retries without a green confirmation or upload', async () => {
  const page = screen({detect: async () => [], onWait(ms) {
    assert.equal(page.render().props.confirmed, false);
    assert.notEqual(ms, 500, 'A failed step must not show success feedback');
  }});
  await page.render().props.onStart();
  page.render().props.preview.props.onStarted();
  page.render().props.onReady();
  await settle();
  assert.equal(page.calls.capture, 3);
  assert.equal(page.calls.upload, 0);
  assert.equal(page.calls.submit, 0);
  assert.equal(page.render().props.result.failedStep, 'straight');
});

test('capture, upload, and result-request errors retain the actual failure stage', async () => {
  for (const [stage, option] of [['capture', 'photoRequest'], ['upload', 'uploadRequest'], ['submit', 'submitRequest']]) {
    const page = screen({[option]: async () => {throw new Error('failed');}});
    await page.render().props.onStart();
    page.render().props.preview.props.onStarted();
    page.render().props.onReady();
    await settle();
    const result = page.render();
    assert.equal(result.type, 'Failure');
    assert.equal(result.props.result.reason, stage);
  }
});

test('head-turn headings follow the challenge direction when right precedes left', async () => {
  const prompts = [];
  const page = screen({actions: ['right', 'left', 'blink'], onWait(ms) {
    // Each action's first wait: 2.2 s, or 0.9 s for a turn (its first frame comes mid-turn).
    if (ms === 2200 || ms === 900) prompts.push(page.render().props.title);
  }});
  await page.render().props.onStart();
  page.render().props.preview.props.onStarted();
  page.render().props.onReady();
  await settle();
  assert.deepEqual(prompts, ['Turn your head\nto your right', 'Turn your head\nto your left', 'Close your eyes']);
  assert.equal(page.calls.submit, 1);
});

test('all correction reasons use one page and onboarding opens the selected media options', async () => {
  for (const [reason, kind] of [['main_photo', 'photo'], ['photo', 'photo'], ['video', 'video']]) {
    const items = [{url: 'affected', kind, main: reason === 'main_photo', status: 'mismatch'}];
    const page = screen({result: {status: 'needs_fix', reason, items}, params: {onboarding: true}});
    await page.render().props.onStart();
    page.render().props.preview.props.onStarted();
    page.render().props.onReady();
    await settle();
    const resultPage = page.render();
    assert.equal(resultPage.type, 'Correction');
    assert.equal(resultPage.props.items, items);
    resultPage.props.onEdit(items[0]);
    assert.equal(page.calls.replace[0][0], 'PhotoUpload');
    assert.equal(page.calls.replace[0][1].correctionTarget.kind, kind);
    assert.equal(page.calls.replace[0][1].correctionTarget.url, 'affected');
  }
});

test('account correction opens the photo or video section with a return route', async () => {
  for (const canGoBack of [true, false]) {
    const page = screen({result: {status: 'needs_fix', reason: 'video', items: []}, canGoBack});
    await page.render().props.onStart();
    page.render().props.preview.props.onStarted();
    page.render().props.onReady();
    await settle();
    page.render().props.onEdit({kind: 'video'});
    const route = canGoBack ? {name: page.calls.replace[0][0], params: page.calls.replace[0][1]} : page.calls.reset[0].routes[1];
    assert.equal(route.name, 'EditProfile');
    assert.equal(route.params.section, 'video');
  }
});

test('the screen is bright from ready until the steps end, and back to normal after', async () => {
  const page = screen();
  await page.render().props.onStart();
  page.render().props.preview.props.onStarted();
  assert.equal(page.calls.brightness.includes('raise'), false, 'not before ready');
  page.render().props.onReady();
  assert.equal(page.calls.brightness.at(-1), 'raise');
  await settle();
  page.render();
  assert.equal(page.calls.submit, 1);
  assert.equal(page.calls.brightness.at(-1), 'restore', 'restored once the steps are done');
});

test('closing during the steps restores the brightness', async () => {
  const pending = deferred();
  const page = screen({photoRequest: () => pending.promise});
  await page.render().props.onStart();
  page.render().props.preview.props.onStarted();
  page.render().props.onReady();
  await settle();
  page.unmount();
  assert.equal(page.calls.brightness.at(-1), 'restore');
  pending.resolve();
  await settle();
});

test('a check that outlasts its request shows the result the server reached, not an error', async () => {
  const page = screen({
    submitRequest: async () => {throw new Error('timeout of 120000ms exceeded');},
    challengeAnswers: [{state: 'checking'}, {state: 'done', result: {status: 'verified', reason: null, items: []}}],
  });
  await page.render().props.onStart();
  page.render().props.preview.props.onStarted();
  page.render().props.onReady();
  await settle();
  const shown = page.render();
  assert.equal(shown.type, 'Result');
  assert.equal(shown.props.status, 'verified');
  assert.equal(page.calls.submit, 1, 'the check is not sent twice while the server is still checking');
  assert.equal(page.calls.resultChecks, 2);
});

test('a submit lost on the way is sent once more while the check is open', async () => {
  const page = screen({
    submitRequest: async (attempt) => {if (attempt === 1) throw new Error('Network Error');},
    challengeAnswers: [{state: 'not_submitted'}],
  });
  await page.render().props.onStart();
  page.render().props.preview.props.onStarted();
  page.render().props.onReady();
  await settle();
  assert.equal(page.calls.submit, 2);
  assert.equal(page.render().type, 'Result');
});

test('a server answer to submit, such as an expired check, is shown without retrying', async () => {
  const expired = Object.assign(new Error('gone'), {response: {status: 410, data: {code: 'FACE_CHALLENGE_EXPIRED'}}});
  const page = screen({submitRequest: async () => {throw expired;}});
  await page.render().props.onStart();
  page.render().props.preview.props.onStarted();
  page.render().props.onReady();
  await settle();
  const shown = page.render();
  assert.equal(shown.type, 'Failure');
  assert.equal(shown.props.result.errorCode, 'FACE_CHALLENGE_EXPIRED');
  assert.equal(page.calls.resultChecks, 0);
});
