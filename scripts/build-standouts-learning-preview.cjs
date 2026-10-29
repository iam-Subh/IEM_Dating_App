const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'docs/design-review/reminders/standouts-learning');
const glyphs = require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json');

async function main() {
  fs.mkdirSync(out, {recursive: true});
  fs.copyFileSync(path.join(root, 'apps/mobile/assets/illustrations/standouts-rose-bouquet.png'), path.join(out, 'bouquet.png'));
  for (const stage of ['sprout', 'buds', 'bloom']) {
    const name = `standouts-growing-${stage}.png`;
    fs.copyFileSync(path.join(root, 'apps/mobile/assets/illustrations', name), path.join(out, name));
  }
  fs.copyFileSync(path.join(root, 'docs/design-review/reminders/explore-loading/profile.jpg'), path.join(out, 'aanya.jpg'));
  const maya = path.join(out, 'maya.jpg');
  if (!fs.existsSync(maya)) {
    const response = await fetch('https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=500&q=85', {signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw Error('Could not load the Maya demo photo.');
    fs.writeFileSync(maya, Buffer.from(await response.arrayBuffer()));
  }
  await esbuild.build({
    absWorkingDir: root,
    stdin: {loader: 'tsx', resolveDir: root, contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {LearningPage} from './apps/mobile/src/features/discovery/components/StandoutsLearning';
      import {StandoutsInfoContent} from './apps/mobile/src/screens/main/StandoutsInfoScreen';
      import {StandoutsLoading} from './apps/mobile/src/features/discovery/components/StandoutsLoading';
      import {StandoutsIcon} from './apps/mobile/src/features/discovery/components/StandoutsIcon';
      function Preview() {
        const initial = Number(new URLSearchParams(location.search).get('swipes') ?? 4);
        const [done, setDone] = React.useState(Number.isFinite(initial) ? Math.max(0, Math.min(15, initial)) : 4);
        const [page, setPage] = React.useState('explore');
        const [explained, setExplained] = React.useState(false);
        const [loading, setLoading] = React.useState(false);
        const timer = React.useRef(null), generation = React.useRef(0), infoReturn = React.useRef('learning');
        const cancel = () => {generation.current++; clearTimeout(timer.current); setLoading(false);};
        React.useEffect(()=>()=>{generation.current++;clearTimeout(timer.current)},[]);
        const showPicks = () => {
          cancel(); const current = generation.current; setPage('picks'); setLoading(true);
          // Preview-only response delay. The app uses its real request completion.
          timer.current = setTimeout(async()=>{
            await Promise.all(['aanya.jpg','maya.jpg'].map(src=>{const image=new window.Image();image.src=src;return image.decode().catch(()=>{});}));
            if(current===generation.current) setLoading(false);
          },2400);
        };
        const showStandouts = () => {
          if(!explained){infoReturn.current='learning';setPage('info');return;}
          if(done<15){cancel();setPage('learning');}else showPicks();
        };
        const closeInfo = () => {
          setExplained(true);
          if(infoReturn.current==='picks'){setPage('picks');return;}
          if(done<15)setPage('learning');else showPicks();
        };
        const back = () => {if(page==='info')closeInfo();else{cancel();setPage('explore');}};
        React.useEffect(()=>{const onKey=e=>{if(e.key==='Escape'){e.preventDefault();back();}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[page,done,explained]);
        const changeCount = n => {cancel();setDone(n);if(n===15||page==='picks')setPage('explore');};
        const firstVisit = () => {cancel();setExplained(false);setPage('explore');};
        const controls = <><button onClick={firstVisit}>First visit</button>{[0,5,10,15].map(n=><button key={n} aria-pressed={done===n} onClick={()=>changeCount(n)}>{n} swipes</button>)}</>;
        return <><aside><span className="label">DESIGN PREVIEW</span><h1>Standouts learning</h1>
          <p>Tap Standouts in Explore. The first visit shows Learn more. Close it or press Escape to see swipe progress.</p>
          <label htmlFor="swipes">{done} of 15 swipes</label>
          <input id="swipes" type="range" min="0" max="15" value={done} onChange={e=>changeCount(Number(e.target.value))}/>
          <div className="stages">{controls}</div>
          <p>At 15 swipes, tap Standouts again. Its icon animates during loading, then fades out to reveal sample profiles. These controls do not change account data.</p></aside>
          <div className="mobile-controls"><span>Preview</span>{controls}</div>
          <section className="phone" aria-label="Standouts learning preview">
            {page==='info' ? <StandoutsInfoContent onClose={closeInfo} weeklyGrant={5} topInset={20} bottomInset={12}/> : <>
            <header>{page==='explore' ? <><strong>Explore</strong><button className="standouts-entry" onClick={showStandouts} aria-label="Open Standouts"><StandoutsIcon size={28} color="#E8C698" heartColor="#F2BDC9"/></button></> : <><button className="back" onClick={back} aria-label="Back to Explore">‹</button><strong>Standouts</strong><button className="info" aria-label="About Standouts" onClick={()=>{infoReturn.current=page;setPage('info')}}>ⓘ</button></>}</header>
            <main>{page==='explore' ? <section className="explore-demo" data-testid="preview-explore">
              <div className="demo-profile"><img src="aanya.jpg" alt=""/><strong>Aanya, 22</strong></div>
              <div className="swipe-actions"><button onClick={()=>setDone(n=>Math.min(15,n+1))}>Pass</button><button onClick={()=>setDone(n=>Math.min(15,n+1))}>Like</button></div>
              <p>{done} of 15 demo swipes</p>
            </section> : page==='learning' ? <LearningPage progress={{done, needed:15}} onExplore={()=>setPage('explore')}/> : !loading ?
              <section className="unlocked" data-testid="standouts-unlocked">
                <h2>Your daily picks</h2>
                <div className="sample-picks">{[['Aanya',22,'aanya.jpg'],['Maya',21,'maya.jpg']].map(([name,age,photo])=>
                  <article key={name}><img src={photo} alt=""/><strong>{name}, {age}</strong></article>)}</div>
              </section> : null}</main>
            <div className="home-indicator" aria-hidden="true"/>
            </>}
            <StandoutsLoading loading={loading}/>
          </section></>;
      }
      createRoot(document.getElementById('root')).render(<Preview/>);`},
    bundle: true, minify: true, platform: 'browser', outfile: path.join(out, 'preview.js'),
    alias: {'react-native': 'react-native-web'},
    define: {__DEV__: 'false', global: 'globalThis', 'process.env.NODE_ENV': '"production"'},
    plugins: [{name: 'learning-preview', setup(build) {
      build.onResolve({filter: /standouts-(?:rose-bouquet|growing-(?:sprout|buds|bloom))\.png$/}, args => ({path: path.basename(args.path), namespace: 'preview-asset'}));
      build.onLoad({filter: /.*/, namespace: 'preview-asset'}, args => ({contents: `module.exports = ${JSON.stringify({uri: args.path === 'standouts-rose-bouquet.png' ? 'bouquet.png' : args.path})};`, loader: 'js'}));
      build.onResolve({filter: /^react-native-svg$/}, () => ({path: 'svg', namespace: 'preview-svg'}));
      build.onLoad({filter: /.*/, namespace: 'preview-svg'}, () => ({contents: `import React from 'react';const make=tag=>({accessible,importantForAccessibility,...props})=>React.createElement(tag,props);export default make('svg');export const Circle=make('circle'),Defs=make('defs'),Mask=make('mask'),Path=make('path'),Rect=make('rect');`, loader: 'jsx', resolveDir: root}));
      build.onResolve({filter: /^(?:@expo\/vector-icons|@react-navigation\/native|react-native-safe-area-context)$/}, args => ({path: args.path, namespace: 'preview-module'}));
      build.onLoad({filter: /.*/, namespace: 'preview-module'}, args => ({contents: args.path==='@expo/vector-icons'
        ? `import React from 'react';const glyphs=${JSON.stringify(glyphs)};export function Ionicons({name,size=20,color}){return <span aria-hidden="true" style={{fontFamily:'Ionicons',fontSize:size,color,lineHeight:1}}>{String.fromCodePoint(glyphs[name])}</span>;}`
        : args.path==='@react-navigation/native' ? `export const useNavigation=()=>({}),useRoute=()=>({params:{}});`
        : `export const useSafeAreaInsets=()=>({top:0,bottom:0,left:0,right:0});`, loader: 'jsx', resolveDir: root}));
    }}],
  });
  fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Standouts learning · Preview</title><style>
${['DMSans_400Regular', 'DMSans_700Bold', 'CormorantGaramond_600SemiBold', 'Ionicons'].map(font => `@font-face{font-family:${font};src:url('../${font}.ttf')}`).join('')}
*{box-sizing:border-box}html,body,#root{margin:0;min-height:100%;font-family:DMSans_400Regular,sans-serif;background:#1B1918;color:#F6EEEA}#root{min-height:100dvh;display:flex;align-items:center;justify-content:center;gap:64px;padding:24px}aside{width:250px}h1{font:26px DMSans_700Bold;margin:14px 0}aside p{font-size:13px;line-height:21px;color:#B9ACA5}.label{font-size:10px;letter-spacing:1.6px;color:#E8C698}aside label{display:block;font-size:13px;margin-top:28px}input{width:100%;accent-color:#E8C698;margin:16px 0}.stages{display:flex;flex-wrap:wrap;gap:8px}button{font:12px DMSans_700Bold;cursor:pointer;border:0;border-radius:20px;padding:10px 12px;background:#38302B;color:#E8C698}.phone{width:390px;height:844px;max-height:calc(100dvh - 48px);display:flex;flex-direction:column;background:#100F0D;border-radius:28px;overflow:hidden;box-shadow:0 16px 60px #0003}header{display:flex;align-items:center;gap:12px;min-height:80px;padding:28px 20px 12px;flex-shrink:0}header a{color:#F6EEEA;text-decoration:none;font-size:30px;width:24px;line-height:30px}header strong{font:20px DMSans_700Bold}header span{color:#C8C0B8;font-size:18px}main{flex:1;overflow-y:auto;scrollbar-width:none;padding:0 12px}main::-webkit-scrollbar{display:none}.home-indicator{width:120px;height:4px;border-radius:2px;background:#AAA6A2;margin:12px auto;flex-shrink:0}@media(max-width:750px){#root{display:block;padding:0}aside{display:none}.phone{width:100%;height:100dvh;max-height:none;border-radius:0;box-shadow:none}}
.phone{position:relative}.mobile-controls{display:none}button[aria-pressed="true"]{background:#E8C698;color:#302025}.unlocked{padding:8px 8px 24px}.unlocked h2{font:20px DMSans_700Bold;margin:0 0 20px}.sample-picks{display:grid;grid-template-columns:1fr 1fr;gap:12px}.sample-picks article{border-radius:18px;overflow:hidden;background:#242120;text-align:left}.sample-picks article img{display:block;width:100%;height:250px;object-fit:cover}.sample-picks strong{display:block;font:14px DMSans_700Bold;padding:12px}header .standouts-entry{margin-left:auto;border:1px solid #776342;width:44px;height:44px;padding:7px;background:#29251D}header .back,header .info{padding:0;background:transparent;color:#F6EEEA;width:28px;height:36px;font-size:28px}header .info{font-size:18px}.explore-demo{padding:12px 8px;text-align:center}.demo-profile{position:relative;border-radius:24px;overflow:hidden;height:390px}.demo-profile img{width:100%;height:100%;object-fit:cover}.demo-profile strong{position:absolute;left:20px;bottom:20px;font:24px DMSans_700Bold;text-shadow:0 2px 8px #000}.swipe-actions{display:flex;justify-content:center;gap:20px;margin:22px 0 14px}.swipe-actions button{min-width:90px;background:#302B28;color:#F6EEEA}.swipe-actions button:last-child{background:#F2C9D3;color:#302025}.explore-demo p{font-size:12px;color:#B8B0AA}@media(max-width:750px){.mobile-controls{display:flex;height:56px;align-items:center;gap:6px;padding:8px;background:#24201D;overflow-x:auto;scrollbar-width:none}.mobile-controls>*{flex-shrink:0}.mobile-controls span{font-size:10px;color:#C4B6A5;margin-right:4px}.mobile-controls button{font-size:11px;padding:8px 10px}.phone{height:calc(100dvh - 56px)}}
</style></head><body><div id="root"></div><script src="preview.js?v=${Date.now()}"></script></body></html>`);
  console.log('Built Standouts learning preview with the shared app component.');
}
main().catch(error => {console.error(error); process.exitCode = 1;});
