const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'docs/design-review/reminders/explore-loading');
const glyphs = require(path.join(root, 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json'));
const stubs = {
  'react-native-svg': `import React from 'react';const make=tag=>({accessible,importantForAccessibility,...props})=>React.createElement(tag,props);export default make('svg');export const Defs=make('defs'),Mask=make('mask'),Path=make('path'),Rect=make('rect');`,
  '@expo/vector-icons': `import React from 'react';const glyphs=${JSON.stringify(glyphs)};export function Ionicons({name,size=20,color}){return <span aria-hidden="true" style={{fontFamily:'Ionicons',fontSize:size,color,lineHeight:1,display:'inline-flex',alignItems:'center',justifyContent:'center',width:size,height:size,flexShrink:0}}>{String.fromCodePoint(glyphs[name])}</span>;}`,
  'expo-linear-gradient': `import React from 'react';export function LinearGradient({colors,locations,style,pointerEvents}){return <div style={{...style,pointerEvents,backgroundImage:'linear-gradient(to bottom,'+colors.map((color,i)=>color+' '+Math.round(locations[i]*100)+'%').join(',')+')'}}/>;}`,
};
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {ExploreLoadingDemo} from './apps/mobile/src/development/ExploreLoadingPreview';
function Preview(){const [open,setOpen]=React.useState(true),[replay,setReplay]=React.useState(0),[reduced,setReduced]=React.useState(()=>matchMedia('(prefers-reduced-motion:reduce)').matches);const restart=()=>{setReplay(n=>n+1);setOpen(true)};return <><aside className="controls"><span className="label">DEMO ONLY</span><h1>Finding profiles</h1><p>Choose a scenario in the phone to preview the loading animation and its result.</p><p>Location and preferences are simulated. Nothing is saved.</p><button onClick={restart}>Restart demo</button><label className="option"><input type="checkbox" checked={reduced} onChange={e=>setReduced(e.target.checked)}/> Reduce motion</label></aside><div className="phone">{open?<ExploreLoadingDemo initialScenario={new URLSearchParams(location.search).get('mode')==='empty'?'empty':'open'} key={replay} avatarUri="avatar.jpg" profileUri="profile.jpg" topInset={24} bottomInset={16} reduceMotionOverride={reduced} onClose={()=>setOpen(false)}/>:<div className="closed"><h2>Demo closed</h2><button onClick={restart}>Show demo</button></div>}</div></>};createRoot(document.getElementById('root')).render(<Preview/>);`;

async function sample(file, url) {
  const destination = path.join(out, file);
  if (fs.existsSync(destination)) return;
  const response = await fetch(url);
  if (!response.ok) throw Error(`Sample image: ${response.status}`);
  fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}
async function main() {
  fs.mkdirSync(out, {recursive: true});
  fs.copyFileSync(path.join(root, 'apps/mobile/assets/illustrations/discover-kitten.png'), path.join(out, 'kitten.png'));
  await Promise.all([
    sample('avatar.jpg', 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=160&q=85'),
    sample('profile.jpg', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=900&q=85'),
  ]);
  await esbuild.build({
    absWorkingDir: root, stdin: {contents: entry, loader: 'tsx', resolveDir: root}, bundle: true, minify: true,
    platform: 'browser', outfile: path.join(out, 'preview.js'),
    define: {__DEV__: 'false', global: 'globalThis', 'process.env.NODE_ENV': '"production"'}, alias: {'react-native': 'react-native-web'},
    plugins: [{name: 'explore-loading-preview', setup(build) {
      build.onResolve({filter: /discover-kitten\.png$/}, () => ({path: 'kitten', namespace: 'preview-asset'}));
      build.onLoad({filter: /.*/, namespace: 'preview-asset'}, () => ({contents: `module.exports = {uri: 'kitten.png'};`, loader: 'js'}));
      build.onResolve({filter: /.*/}, args => stubs[args.path] ? {path: args.path, namespace: 'preview'} : undefined);
      build.onLoad({filter: /.*/, namespace: 'preview'}, args => ({contents: stubs[args.path], loader: 'jsx', resolveDir: root}));
    }}],
  });
  fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Explore loading · Demo</title><style>
${['DMSans_400Regular','DMSans_500Medium','DMSans_700Bold','Ionicons'].map(font => `@font-face{font-family:${font};src:url('../${font}.ttf')}`).join('')}
*{box-sizing:border-box}html,body,#root{margin:0;min-height:100%;background:#1A1818}body{font-family:DMSans_400Regular,sans-serif;color:#F5EFEA}#root{display:flex;justify-content:center;align-items:center;gap:64px;min-height:100dvh;padding:24px}.controls{width:240px}.label{font-size:10px;color:#CCACB7;letter-spacing:2px}.controls h1{font:27px DMSans_700Bold}.controls p{font-size:13px;line-height:22px;color:#B4AAAE}.option{display:flex;gap:8px;align-items:center;font-size:12px;margin-top:24px;color:#B4AAAE}button{cursor:pointer;border:0;border-radius:24px;background:#EAC4C8;color:#35272C;padding:14px 20px;font:14px DMSans_700Bold}.phone{display:flex;width:390px;height:844px;max-height:calc(100dvh - 48px);background:#100F0D;border-radius:30px;overflow:hidden;box-shadow:0 16px 60px #0004;flex-shrink:0}.closed{margin:auto;padding:28px;text-align:center}@media(max-width:750px){#root{padding:0;display:block}.controls{display:none}.phone{width:100%;height:100dvh;max-height:none;border-radius:0;box-shadow:none}}
</style></head><body><div id="root"></div><script src="preview.js"></script></body></html>`);
  console.log('Built Explore loading demo. The real Explore screen shares its ring renderer.');
}
main().catch(error => {console.error(error);process.exitCode=1;});
