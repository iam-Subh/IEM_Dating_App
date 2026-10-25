const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), vm=require('node:vm'), ts=require('typescript');
const root=path.join(__dirname,'../src/features/auth/onboarding');
const compile=file=>ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React}}).outputText;
function moduleAt(file,modules={}){const exports={};vm.runInNewContext(compile(file),{exports,require:name=>{if(!(name in modules))throw Error(name);return modules[name];}});return exports;}

test('photo dimensions from the card are available before the full-screen image loads',()=>{
 const cache=moduleAt('photoPreviewCache.ts');cache.rememberPreviewPhoto('photo',{width:1600,height:2400});assert.deepEqual({...cache.previewPhotoSize('photo')},{width:1600,height:2400});cache.rememberPreviewPhoto('photo',{width:0,height:0});assert.equal(cache.previewPhotoSize('photo').width,1600);
 for(let i=0;i<65;i++)cache.rememberPreviewPhoto('photo'+i,{width:1,height:2});assert.equal(cache.previewPhotoSize('photo'),undefined);assert.equal(cache.previewPhotoSize('photo64').height,2);
});
test('native page preparation waits for appearance and cancels on leaving',()=>{
 let focused=true, listener, unsubscribed=false;const tasks=[];const {afterScreenTransition}=moduleAt('afterScreenTransition.ts',{'react-native':{Platform:{OS:'android'},InteractionManager:{runAfterInteractions:callback=>{const task={callback,cancelled:false,cancel(){this.cancelled=true;}};tasks.push(task);return task;}}}});let calls=0;
 const cleanup=afterScreenTransition({isFocused:()=>focused,addListener:(event,callback)=>{assert.equal(event,'transitionEnd');listener=callback;return()=>unsubscribed=true;}},()=>calls++);assert.equal(tasks.length,0);listener({data:{closing:true}});assert.equal(tasks.length,0);listener({data:{closing:false}});tasks[0].callback();assert.equal(calls,1);listener({data:{closing:false}});focused=false;cleanup();tasks[1].callback();assert.equal(calls,1);assert.equal(tasks[1].cancelled,true);assert.equal(unsubscribed,true);
});


// Render an interest group to plain objects, calling function components.
function group({college=false,selected=[],busy=false,options}={}){
 const toggles=[];
 const react={memo:x=>x,useCallback:x=>x,useRef:current=>({current}),useState:initial=>[initial,()=>{}],useEffect(){},useLayoutEffect(){},createElement(type,props,...children){if(typeof type==='function')return type({...props,children});return{type,props:{...props,children}};}};
 const modules={react:{...react,default:react},'react-native':{View:'View',Text:'Text',Animated:{View:'NativeAnimatedView'},StyleSheet:{create:x=>x,absoluteFill:{}}},'@expo/vector-icons':{Ionicons:'Icon'},'expo-linear-gradient':{LinearGradient:'Gradient'},
  'react-native-reanimated':{__esModule:true,default:{View:'AnimatedView'},useAnimatedStyle:cb=>cb()},'react-native-svg':{__esModule:true,default:'Svg',Path:'Path'},'./InterestVisuals':{interestEmojis:{},interestGradient:()=>['pink','plum']},'./ConnectionDesign':{RoundedTick:'Tick',connectionColors:{}}};
 const exported=moduleAt('InterestGroupView.tsx',modules);
 const interests=[{id:'a',label:'A'},{id:'b',label:'B'},{id:'c',label:'C'},{id:'d',label:'D'},{id:'e',label:'E'},{id:'f',label:'F'}];
 const tree=exported.InterestGroupView({group:{id:college?'college_clubs':'music',title:'Music',interests},icon:'music',options,selected,busy,onToggle:(id,club)=>toggles.push([id,club])});
 const tags=[];(function walk(node){if(!node||typeof node!=='object')return;if(node.props?.accessibilityRole==='checkbox')tags.push(node);for(const child of [node.props?.children].flat(Infinity))walk(child);})(tree);
 return{tree,tags,toggles,tap(index){const tag=tags[index];if(tag.props.onStartShouldSetResponder())tag.props.onResponderRelease();}};
}
test('a tap toggles its own tag, and only selected tags draw a gradient',()=>{
 const g=group({selected:['b']});g.tap(0);g.tap(1);assert.deepEqual(g.toggles,[['a',false],['b',false]]);
 const gradients=g.tags.filter(tag=>[tag.props.children].flat(Infinity).some(child=>child?.type==='Gradient'));assert.equal(gradients.length,1);assert.equal(gradients[0].props.accessibilityLabel,'B');
 assert.equal(g.tags[1].props.accessibilityState.checked,true);assert.equal(g.tags[0].props.accessibilityState.checked,false);
});
test('a full club list blocks new picks but allows removal, and a save in progress blocks every tap',()=>{
 const g=group({college:true,selected:['a','b','c','d','e']});g.tap(5);assert.equal(g.toggles.length,0);assert.equal(g.tags[5].props.accessibilityState.disabled,true);g.tap(0);assert.deepEqual(g.toggles,[['a',true]]);
 const saving=group({busy:true});saving.tap(0);assert.equal(saving.toggles.length,0);
});
test('search results render only the matching options',()=>{
 const g=group({options:[{id:'c',label:'C'}]});assert.equal(g.tags.length,1);assert.equal(g.tags[0].props.accessibilityLabel,'C');
});
