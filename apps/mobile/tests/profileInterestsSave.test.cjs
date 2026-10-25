const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function editor(reply = {data:{success:true,data:{id:'account'}}}) {
  let cursor = 0, closes = 0;
  const cells = [], writes = [], actions = [];
  const user = {preferences:{interests:['nba'], bio:'Keep this bio'}, clubs:['Photography']};
  const react = {
    createElement:(type, props) => ({type, props}), useMemo:fn => fn(),
    useState(initial) {const i = cursor++; if (!(i in cells)) cells[i] = initial; return [cells[i], value => {cells[i] = value;}];},
    useRef(initial) {const i = cursor++; return cells[i] ??= {current:initial};},
  };
  const modules = {
    react:{__esModule:true, default:react, ...react},
    '@react-navigation/native':{useNavigation:() => ({goBack:() => closes++}), useRoute:() => ({params:{}})},
    'react-redux':{useSelector:fn => fn({auth:{user}}), useDispatch:() => action => actions.push(action)},
    '@iem-dating/shared/interest-catalog':require('@iem-dating/shared/interest-catalog'),
    '../../../features/auth/onboarding/InterestIntroduction':{InterestForm:'InterestForm'},
    '../../../services/api':{api:{put:async (...args) => {writes.push(args); if (reply instanceof Error) throw reply; return reply;}}},
    '../../../store/authSlice':{updateUser:payload => ({payload})},
  };
  const exported = {};
  const source = fs.readFileSync(path.join(__dirname,'../src/screens/main/edit/EditInterestsScreen.tsx'),'utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2020, jsx:ts.JsxEmit.React}}).outputText,
    {exports:exported, require:name => {assert.ok(modules[name],name); return modules[name];}});
  return {writes, actions, closes:() => closes, render:() => {cursor=0; return exported.EditInterestsScreen().props;}};
}

test('the shared editor excludes clubs and does not write an onboarding draft', () => {
  const e = editor(), props = e.render();
  assert.equal(props.dark,true);
  assert.equal(props.includeClubs,false);
  assert.equal(JSON.stringify(props.controller.data),JSON.stringify({preferences:{interests:['nba']}}));
  props.controller.draft({clubs:[]});
  assert.equal(e.actions.length,0);
  assert.equal(e.writes.length,0);
});

test('saving interests sends one update and does not overwrite clubs', async () => {
  const e = editor(), form = e.render().controller;
  await Promise.all([form.saveOptional({preferences:{interests:[]},clubs:[]}),form.saveOptional({preferences:{interests:['nba']},clubs:['Music/Band']})]);
  assert.equal(e.writes.length,1);
  assert.equal(e.writes[0][0],'/profile');
  assert.equal(JSON.stringify(e.writes[0][1]),JSON.stringify({preferences:{interests:[]}}));
  assert.equal(e.actions.length,1);
  assert.equal(e.closes(),1);
});

test('a failed save keeps the shared form open and allows another attempt', async () => {
  const e = editor({data:{success:false,message:'Try again.'}});
  await e.render().controller.saveOptional({preferences:{interests:['nba']},clubs:[]});
  assert.equal(e.closes(),0);
  assert.equal(e.actions.length,0);
  assert.equal(e.render().controller.error,'Try again.');
  assert.equal(e.render().controller.busy,false);
  await e.render().controller.saveOptional({preferences:{interests:['nba']},clubs:[]});
  assert.equal(e.writes.length,2);
});
