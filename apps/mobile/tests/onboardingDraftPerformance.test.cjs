const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm'), ts=require('typescript');
function load(file,modules){
 const exports={};
 const source=fs.readFileSync(path.join(__dirname,'../src',file),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,__DEV__:true,require:name=>modules[name]??require(name)});
 return exports;
}
test('duplicate draft writes preserve state identity, but changed values and steps persist',()=>{
 const auth=load('store/authSlice.ts',{}), reducer=auth.default;
 const first=reducer(undefined,auth.saveOnboardingDraft({step:'Interests',fields:{preferences:{interests:['nba']},password:'private'}}));
 assert.equal(first.onboardingDraft.fields.password,undefined);
 const repeated=reducer(first,auth.saveOnboardingDraft({step:'Interests',fields:{preferences:{interests:['nba']}}}));
 assert.equal(repeated,first);
 const changed=reducer(first,auth.saveOnboardingDraft({fields:{preferences:{interests:['nba','music']}}}));
 assert.notEqual(changed,first);assert.equal(changed.onboardingDraft.fields.preferences.interests.length,2);
 const moved=reducer(changed,auth.saveOnboardingDraft({step:'ShareMore'}));
 assert.equal(moved.onboardingDraft.step,'ShareMore');assert.equal(JSON.stringify(moved.onboardingDraft.fields),JSON.stringify(changed.onboardingDraft.fields));
});
function onboarding(){
 let focused=true, equality, puts=0, refreshes=0;const listeners={};
 const selected={token:'token',user:{name:'Saved',preferences:{interests:['nba']}},isAuthenticated:false,nextRequiredStep:'profile',onboardingDraft:{step:'NameSelection',fields:{name:'Old'}}};
 const current={...selected,onboardingDraft:{step:'NameSelection',fields:{name:'Latest'}}};
 const dispatched=[];const navigation={canGoBack:()=>true,goBack(){},navigate(){},isFocused:()=>focused,addListener:(event,callback)=>{listeners[event]=callback;return()=>{};}};
 const mod=load('features/auth/onboarding/useOnboarding.ts',{
  react:{useCallback:fn=>fn,useEffect:fn=>fn(),useRef:current=>({current}),useReducer:()=>[0,()=>refreshes++]},'react-redux':{useDispatch:()=>action=>dispatched.push(action),useStore:()=>({getState:()=>({auth:current})}),useSelector:(selector,compare)=>{equality=compare;return selector({auth:selected});}},
  '@react-navigation/native':{useNavigation:()=>navigation,useRoute:()=>({name:'NameSelection',params:{reviewEdit:true}}),useFocusEffect(){}},
  '../../../store':{store:{getState:()=>({auth:current})}},'../../../store/authSlice':{saveOnboardingDraft:payload=>({type:'draft',payload}),updateUser:payload=>({type:'user',payload})},
  '../../../services/api':{api:{put:async()=>{puts++;return{data:{data:{name:'Changed'}}};}}},'./onboardingFlow':{previousProfileStep:()=>null},'./afterScreenTransition':{afterScreenTransition(){}},
  '../../../development/onboardingPreviewRuntime':{isOnboardingPreview:()=>false},
 });
 return{listeners,get refreshes(){return refreshes;},render:mod.useOnboarding,selected,current,dispatched,get equality(){return equality;},get puts(){return puts;},set focused(value){focused=value;}};
}
test('focused pages read the current draft without subscribing to every draft write',()=>{
 const h=onboarding();assert.equal(h.render().data.name,'Latest');assert.equal(h.equality(h.selected,h.current),true);
 assert.equal(h.equality(h.selected,{...h.current,user:{name:'New'}}),false);
 h.focused=false;assert.equal(h.render().data.name,'Old');assert.equal(h.equality(h.selected,{...h.current,user:{name:'New'}}),true);
 h.current.onboardingDraft.fields.name='Newest';h.focused=true;assert.equal(h.render().data.name,'Newest');
});
test('unchanged answers skip the profile request; changed answers still save before returning',async()=>{
 const h=onboarding(),o=h.render();await o.save({preferences:{interests:['nba']}});assert.equal(h.puts,0);assert.equal(h.dispatched[0].type,'draft');
 await o.save({name:'Changed'});assert.equal(h.puts,1);assert.equal(h.dispatched[1].type,'user');assert.equal(h.dispatched[2].type,'draft');
});
test('leaving a page does not re-render it, and returning to it refreshes once',()=>{
 const h=onboarding();h.render();h.listeners.focus();assert.equal(h.refreshes,0);
 h.focused=false;h.listeners.blur();assert.equal(h.refreshes,0);h.focused=true;h.listeners.focus();assert.equal(h.refreshes,1);h.listeners.focus();assert.equal(h.refreshes,1);
});
