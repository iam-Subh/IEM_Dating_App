const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'docs/design-review/reminders/match-preview');
const glyphs = require(path.join(root, 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json'));
const material = require(path.join(root, 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json'));
const stubs = {
  'react-native-svg': `import React from 'react';const make=tag=>({accessible,importantForAccessibility,...props})=>React.createElement(tag,props);export default make('svg');export const Defs=make('defs'),RadialGradient=make('radialGradient'),Rect=make('rect'),Stop=make('stop');`,
  'react-native-keyboard-controller': `export {KeyboardAvoidingView} from 'react-native';`,
  'react-native-safe-area-context': `import React from 'react';export const SafeAreaInsetsContext=React.createContext({top:24,bottom:16,left:0,right:0});export const initialWindowMetrics=null;`,
  'react-native-reanimated': `export const useReducedMotion=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;`,
  '@expo/vector-icons': `import React from 'react';const glyphs=${JSON.stringify(glyphs)};export function MaterialCommunityIcons({name,size=20,color}){return <span aria-hidden="true" style={{fontFamily:'MaterialCommunityIcons',fontSize:size,color,lineHeight:1,display:'inline-flex',alignItems:'center',justifyContent:'center',width:size,height:size}}>{String.fromCodePoint(${material['bullseye-arrow']})}</span>;}export function Ionicons({name,size=20,color}){return <span aria-hidden="true" style={{fontFamily:'Ionicons',fontSize:size,color,lineHeight:1,display:'inline-flex',alignItems:'center',justifyContent:'center',width:size,height:size,flexShrink:0}}>{String.fromCodePoint(glyphs[name])}</span>;}`,
};
async function main() {
  await esbuild.build({
    absWorkingDir: root, entryPoints: [path.join(out, 'entry.tsx')], bundle: true, minify: true,
    platform: 'browser', outfile: path.join(out, 'preview.js'),
    define: {__DEV__: 'false', 'process.env.NODE_ENV': '"production"'}, alias: {'react-native': 'react-native-web'},
    plugins: [{name: 'match-preview', setup(build) {
      build.onResolve({filter: /.*/}, args => stubs[args.path] ? {path: args.path, namespace: 'preview'} : undefined);
      build.onLoad({filter: /.*/, namespace: 'preview'}, args => ({contents: stubs[args.path], loader: 'jsx', resolveDir: root}));
    }}],
  });
  fs.copyFileSync(path.join(root, 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf'), path.join(out, 'MaterialCommunityIcons.ttf'));
  const fonts = ['DMSans_400Regular', 'DMSans_500Medium', 'DMSans_700Bold', 'Ionicons'];
  fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Match screen · IEM Connect</title><style>
${fonts.map(font => `@font-face{font-family:${font};src:url('../${font}.ttf')}`).join('')}@font-face{font-family:MaterialCommunityIcons;src:url('MaterialCommunityIcons.ttf')}
*{box-sizing:border-box}html,body,#root{margin:0;min-height:100%;background:#191718}body{font-family:DMSans_400Regular,sans-serif;color:#F6F4F6}#root{display:flex;justify-content:center;align-items:center;gap:64px;min-height:100vh;padding:24px}.preview-controls{width:240px;align-self:center;flex-shrink:0}.preview-controls h1{font-size:24px;font-family:DMSans_700Bold}.preview-controls p{font-size:13px;line-height:21px;color:#BDB7C0}.preview-controls button,.reopen{border:0;border-radius:24px;padding:14px 20px;background:#FFE568;color:#222222;font-weight:bold;cursor:pointer}.preview-controls label{display:flex;gap:8px;align-items:center;font-size:12px;margin-top:24px}.phone-backdrop{width:390px;height:844px;max-height:calc(100dvh - 48px);flex-shrink:0;background:#100F0D;border-radius:32px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 16px 60px #0005}.reopen{margin:auto}textarea:focus{outline:none}@media(max-width:750px){#root{padding:0;display:block}.preview-controls{display:none}.phone-backdrop{width:100%;height:100dvh;max-height:none;border-radius:0;box-shadow:none}}
</style></head><body><div id="root"></div><script src="preview.js"></script></body></html>`);
  console.log('Built match preview from the current app component.');
}
main().catch(error => {console.error(error);process.exitCode=1;});
