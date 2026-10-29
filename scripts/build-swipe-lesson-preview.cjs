const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'docs/design-review/reminders/swipe-lesson');
const glyphs = require(path.join(root, 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json'));
const stubs = {
  'react-native-svg': `import React from 'react';const make=tag=>({accessible,importantForAccessibility,...props})=>React.createElement(tag,props);export default make('svg');export const G=make('g'),Path=make('path'),Defs=make('defs'),LinearGradient=make('linearGradient'),Stop=make('stop');`,
  '@expo/vector-icons': `import React from 'react';const glyphs=${JSON.stringify(glyphs)};export function Ionicons({name,size=20,color}){return <span aria-hidden="true" style={{fontFamily:'Ionicons',fontSize:size,color,lineHeight:1,display:'inline-flex',alignItems:'center',justifyContent:'center',width:size,height:size,flexShrink:0}}>{String.fromCodePoint(glyphs[name])}</span>;}`,
  'expo-linear-gradient': `import React from 'react';export function LinearGradient({colors,locations,style,pointerEvents}){return <div style={{...style,pointerEvents,backgroundImage:'linear-gradient(to bottom,'+colors.map((color,i)=>color+' '+Math.round(locations[i]*100)+'%').join(',')+')'}}/>;}`,
};
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {SwipeLesson} from './apps/mobile/src/features/teaching/SwipeLesson';
function Preview(){const [open,setOpen]=React.useState(true);const [replay,setReplay]=React.useState(0);const again=()=>{setReplay(n=>n+1);setOpen(true)};return <><aside className="controls"><span className="label">DEMO ONLY</span><h1>Learn to swipe</h1><p>The app component. Watch each direction, then drag the practice card.</p><p>The hand and card move together. The heart and cross buttons also work.</p><button onClick={again}>Restart preview</button><p className="small">No accounts, Likes, or profiles are changed.</p></aside><div className="phone">{open?<SwipeLesson key={replay} photo={{uri:'practice-photo.jpg'}} topInset={24} bottomInset={16} onDone={()=>setOpen(false)}/>:<div className="finished"><h2>Explore demo</h2><p>The app returns to your demo cards here.</p><button onClick={again}>Replay lesson</button></div>}</div></>};createRoot(document.getElementById('root')).render(<Preview/>);`;

async function main() {
  fs.mkdirSync(out, {recursive: true});
  const photo = path.join(out, 'practice-photo.jpg');
  fs.copyFileSync(path.join(root, 'apps/mobile/assets/teaching/swipe-practice.jpg'), photo);
  await esbuild.build({
    absWorkingDir: root, stdin: {contents: entry, loader: 'tsx', resolveDir: root}, bundle: true, minify: true,
    platform: 'browser', outfile: path.join(out, 'preview.js'),
    define: {__DEV__: 'false', global: 'globalThis', 'process.env.NODE_ENV': '"production"'}, alias: {'react-native': 'react-native-web'},
    plugins: [{name: 'swipe-lesson-preview', setup(build) {
      build.onResolve({filter: /swipe-practice\.jpg$/}, () => ({path: 'practice-photo', namespace: 'lesson-photo'}));
      build.onLoad({filter: /.*/, namespace: 'lesson-photo'}, () => ({contents: `module.exports = {uri: 'practice-photo.jpg'};`, loader: 'js'}));
      build.onResolve({filter: /.*/}, args => stubs[args.path] ? {path: args.path, namespace: 'preview'} : undefined);
      build.onLoad({filter: /.*/, namespace: 'preview'}, args => ({contents: stubs[args.path], loader: 'jsx', resolveDir: root}));
    }}],
  });
  fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Swipe lesson · IEM Connect</title><style>
${['DMSans_400Regular','DMSans_500Medium','DMSans_700Bold','Ionicons'].map(font => `@font-face{font-family:${font};src:url('../${font}.ttf')}`).join('')}
*{box-sizing:border-box}html,body,#root{margin:0;min-height:100%;background:#1C1917}body{font-family:DMSans_400Regular,sans-serif;color:#F6F1EA}#root{display:flex;justify-content:center;align-items:center;gap:64px;min-height:100dvh;padding:24px}.controls{width:240px}.label{font-size:10px;color:#CFA7A3;letter-spacing:2px}.controls h1{font:27px DMSans_700Bold}.controls p{font-size:13px;line-height:22px;color:#BDB5AB}.controls .small{font-size:11px}button{cursor:pointer;border:0;border-radius:24px;background:#F2C1BE;color:#352329;padding:14px 20px;font:14px DMSans_700Bold}.phone{display:flex;width:390px;height:844px;max-height:calc(100dvh - 48px);background:#100F0D;border-radius:30px;overflow:hidden;box-shadow:0 16px 60px #0004;flex-shrink:0}.finished{margin:auto;padding:28px;text-align:center}.finished p{font-size:13px;line-height:21px;color:#BDB5AB}svg{display:block}@media(max-width:750px){#root{padding:0;display:block}.controls{display:none}.phone{width:100%;height:100dvh;max-height:none;border-radius:0;box-shadow:none}}
</style></head><body><div id="root"></div><script src="preview.js"></script></body></html>`);
  console.log('Built demo swipe lesson from the app component.');
}
main().catch(error => {console.error(error);process.exitCode=1;});
