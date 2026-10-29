const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'docs/design-review/reminders/account-goodbye');
const glyphs = require(path.join(root, 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json'));
const stubs = {
  '@expo/vector-icons': `import React from 'react';const glyphs=${JSON.stringify(glyphs)};export function Ionicons({name,size=20,color,style}){return <span aria-hidden="true" style={{fontFamily:'Ionicons',fontSize:size,color,lineHeight:1,display:'inline-flex',alignItems:'center',justifyContent:'center',width:size,height:size,flexShrink:0,...style}}>{String.fromCodePoint(glyphs[name])}</span>;}`,
  'react-native-safe-area-context': `import React from 'react';export const SafeAreaInsetsContext=React.createContext({top:24,bottom:16,left:0,right:0});export const initialWindowMetrics=null;`,
};
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {AccountGoodbyeContent} from './apps/mobile/src/features/auth/screens/AccountGoodbyeScreen';import artwork from './apps/mobile/assets/illustrations/account-closed-envelope-2d.png';
function Preview(){const [open,setOpen]=React.useState(true),[fallback,setFallback]=React.useState(false);const date=new Date(Date.now()+30*86400000).toISOString();return <><aside className="controls"><span className="label">DESIGN PREVIEW</span><h1>Account closed</h1><p>Flat 2D artwork, neutral black, and two plain status rows.</p><p>The recovery deadline appears once. Done keeps its existing app behaviour.</p><button onClick={()=>setOpen(true)}>Show page</button><label className="option"><input type="checkbox" checked={fallback} onChange={e=>setFallback(e.target.checked)}/> Preview missing date</label><p className="small">This preview does not delete or restore an account.</p></aside><div className="phone">{open?<AccountGoodbyeContent scheduledFor={fallback?null:date} artwork={{uri:artwork}} topInset={24} bottomInset={16} onDone={()=>setOpen(false)}/>:<div className="finished"><h2>Preview closed</h2><p>In the app, Done continues to Welcome.</p><button onClick={()=>setOpen(true)}>Show page</button></div>}</div></>};createRoot(document.getElementById('root')).render(<Preview/>);`;
async function main() {
  fs.mkdirSync(out, {recursive: true});
  await esbuild.build({
    absWorkingDir: root, stdin: {contents: entry, loader: 'tsx', resolveDir: root}, bundle: true, minify: true,
    platform: 'browser', outfile: path.join(out, 'preview.js'), loader: {'.png': 'dataurl'},
    define: {__DEV__: 'false', global: 'globalThis', 'process.env.NODE_ENV': '"production"'}, alias: {'react-native': 'react-native-web'},
    plugins: [{name: 'account-goodbye-preview', setup(build) {
      build.onResolve({filter: /.*/}, args => stubs[args.path] ? {path: args.path, namespace: 'preview'} : undefined);
      build.onLoad({filter: /.*/, namespace: 'preview'}, args => ({contents: stubs[args.path], loader: 'jsx', resolveDir: root}));
    }}],
  });
  fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Account closed · IEM Connect</title><style>
${['DMSans_400Regular','DMSans_500Medium','DMSans_700Bold','Ionicons'].map(font => `@font-face{font-family:${font};src:url('../${font}.ttf')}`).join('')}
*{box-sizing:border-box}html,body,#root{margin:0;min-height:100%;background:#18181B}body{font-family:DMSans_400Regular,sans-serif;color:#F5F0E7}#root{display:flex;justify-content:center;align-items:center;gap:64px;min-height:100dvh;padding:24px}.controls{width:240px}.label{font-size:10px;color:#C4ADA3;letter-spacing:2px}.controls h1{font:27px DMSans_700Bold}.controls p{font-size:13px;line-height:22px;color:#BDB7AB}.controls .small{font-size:11px}.option{display:flex;gap:8px;align-items:center;font-size:12px;margin-top:24px;color:#BDB7AB}button{cursor:pointer;border:0;border-radius:24px;background:#E8CBC4;color:#32251F;padding:14px 20px;font:14px DMSans_700Bold}.phone{display:flex;width:390px;height:844px;max-height:calc(100dvh - 48px);background:#0D0D0F;border-radius:30px;overflow:hidden;box-shadow:0 16px 60px #0004;flex-shrink:0}.finished{margin:auto;padding:28px;text-align:center}.finished p{font-size:13px;line-height:21px;color:#BDB7AB}@media(max-width:750px){#root{padding:0;display:block}.controls{display:none}.phone{width:100%;height:100dvh;max-height:none;border-radius:0;box-shadow:none}}
</style></head><body><div id="root"></div><script src="preview.js"></script></body></html>`);
  console.log('Built account-closed preview from the app component.');
}
main().catch(error => {console.error(error);process.exitCode=1;});
