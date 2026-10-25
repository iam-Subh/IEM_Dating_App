const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function screen(hasPassword = false) {
  const state = [], effects = [], calls = [], dispatches = [];
  let cursor = 0;
  const react = {
    createElement: (type, props) => ({type, props}),
    useState(initial) {const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], next => {state[i] = typeof next === 'function' ? next(state[i]) : next;}];},
    useEffect(fn) {const i = cursor++; if (!(i in state)) {state[i] = true; effects.push(fn);}},
  };
  const modules = {
    react: {...react, default: react},
    '../onboarding/StudentVerificationEntry': {StudentVerificationEntry: 'Entry'},
    '../../verification/useVerificationStatus': {refreshVerificationStatus: async () => {}},
    'react-native': {Alert: {alert() {}}},
    'react-redux': {useDispatch: () => action => dispatches.push(action), useSelector: callback => callback({auth: {user: {googleSub: 'google'}}})},
    '../../../services/api': {api: {
      async get(url) {return {data: {data: url.includes('institutions') ? [{code: 'IEM', name: 'Institute of Engineering and Management', domainShared: false}] : {hasPassword}}};},
      async post(url, body) {calls.push({url, body}); return {data: {data: url.endsWith('/send') ? {challengeId: 'challenge-1'} : {membership: {campusConfirmed: true, institution: {name: 'IEM'}}, onboarding: {nextRequiredStep: 'profile'}}}};},
    }},
    '../../../store/authSlice': {setCredentials: data => data, updateUser: data => data, setNextRequiredStep: data => data},
    '../../../services/credentialStore': {credentialStore: {}},
    '@react-navigation/native': {useNavigation: () => ({canGoBack: () => false}), useRoute: () => ({name: 'StudentVerification'})},
    'expo-location': {},
  };
  const exported = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/features/auth/screens/StudentVerificationScreen.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React}}).outputText,
    {exports: exported, require: name => modules[name], setInterval() {}, clearInterval() {}});
  const render = () => {cursor = 0; return exported.StudentVerificationScreen().props;};
  return {render, calls, dispatches, async load() {render(); effects.forEach(fn => fn()); for (let i = 0; i < 5; i++) await Promise.resolve();}};
}
const settle = async () => {for (let i = 0; i < 5; i++) await Promise.resolve();};

test('college verification keeps its service endpoint and requires a password only when needed', async () => {
  const page = screen();
  await page.load();
  page.render().onEmail('firstname.lastname2024@iem.edu.in');
  page.render().onSend();
  await settle();
  assert.equal(page.render().hasChallenge, true);
  assert.equal(page.render().timer, 60);
  assert.equal(page.calls[0].url, '/verification/student/send');
  page.render().onCode('123456');
  page.render().onVerify();
  assert.equal(page.calls.length, 1);
  page.render().onPassword('password-123');
  page.render().onVerify();
  await settle();
  assert.equal(page.calls[1].url, '/verification/student/verify');
  assert.equal(page.calls[1].body.challengeId, 'challenge-1');
  assert.equal(page.calls[1].body.password, 'password-123');
  assert.equal(page.calls[1].body.email, 'firstname.lastname2024@iem.edu.in');
});

test('changing email clears the code and cooldown prevents another send', async () => {
  const page = screen(true);
  await page.load();
  page.render().onEmail('name@iem.edu.in');
  page.render().onSend(); await settle();
  page.render().onResend();
  assert.equal(page.calls.length, 1);
  page.render().onCode('123456');
  page.render().onBack();
  assert.equal(page.render().hasChallenge, false);
  assert.equal(page.render().code, '');
  assert.equal(page.render().email, 'name@iem.edu.in');
});

test('an account with a password submits the code without a replacement password', async () => {
  const page = screen(true);
  await page.load();
  page.render().onEmail('name@iem.edu.in');
  page.render().onSend(); await settle();
  page.render().onCode('123456');
  page.render().onVerify(); await settle();
  assert.equal(page.calls[1].body.code, '123456');
  assert.equal('password' in page.calls[1].body, false);
});
