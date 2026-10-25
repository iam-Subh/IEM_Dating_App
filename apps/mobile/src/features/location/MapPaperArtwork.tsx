import React from 'react';
import Svg, {Circle, Defs, G, LinearGradient, Path, Pattern, Rect, Stop} from 'react-native-svg';

/** Decorative paper map. It contains no locations or profile positions. */
export function MapPaperArtwork({panel, prefix = 'paper'}: {panel?: number; prefix?: string}) {
  const grid = prefix + 'Grid';
  const texture = prefix + 'Texture';
  const paper = prefix + 'Paper';
  return <Svg width="100%" height="100%" viewBox={panel === undefined ? '0 0 320 360' : (panel * 80) + ' 0 80 360'} preserveAspectRatio="none" accessible={false}>
    <Defs>
      <LinearGradient id={paper} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#EDDCC2"/><Stop offset=".5" stopColor="#EED3AC"/><Stop offset="1" stopColor="#E6CEAA"/></LinearGradient>
      <Pattern id={grid} patternUnits="userSpaceOnUse" width={26} height={32} patternTransform="rotate(-31)">
        <Path d="M0 0H26M0 0V32" fill="none" stroke="#FFF9E9" strokeWidth={1.2}/>
        <Path d="M13 0V32" fill="none" stroke="#F9EDDA" strokeWidth={.65}/>
      </Pattern>
      <Pattern id={texture} patternUnits="userSpaceOnUse" width={21} height={19}>
        <Rect x={3} y={3} width={10} height={6} rx={1} fill="#D3AF7F" opacity={.17}/>
        <Circle cx={16} cy={13} r={.6} fill="#B99268" opacity={.15}/>
      </Pattern>
    </Defs>
    <Rect width={320} height={360} fill={'url(#' + paper + ')'}/>
    <Path d="M0 62L87 25 177 70 110 180 0 129ZM145 191L249 134 320 226 239 336 122 308Z" fill="#E4C39C" opacity={.35}/>
    <Rect width={320} height={360} fill={'url(#' + texture + ')'}/>
    <Rect width={320} height={360} fill={'url(#' + grid + ')'}/>
    <Path d="M273-10C239 33 224 68 239 105S278 166 245 202 214 215 207 249 185 278 170 315 161 340 153 373" fill="none" stroke="#91D5D4" strokeWidth={14}/>
    <Path d="M277-10C243 33 228 68 243 105S282 166 249 202 218 215 211 249 189 278 174 315 165 340 157 373" fill="none" stroke="#B0E3DD" strokeWidth={3} opacity={.5}/>
    <G fill="#D2DF8F" stroke="#EBEDBD" strokeWidth={2}>
      <Path d="M147 14Q175 3 186 30L186 82Q180 112 157 103L143 89Q130 68 135 42Z"/>
      <Path d="M17 190L58 182 55 221 32 232Z"/>
      <Path d="M72 237L115 223 130 267 88 279Z"/>
      <Path d="M201 275L228 258 241 272 216 290Z"/>
    </G>
    <Circle cx={106} cy={246} r={11} fill="#96D8D6"/>
    <G fill="#CCDA90" opacity={.75}>
      <Rect x={56} y={113} width={17} height={11} transform="rotate(-25 64 119)"/>
      <Rect x={261} y={290} width={14} height={15} transform="rotate(-31 268 297)"/>
      <Rect x={136} y={294} width={9} height={11} transform="rotate(-24 140 299)"/>
      <Circle cx={210} cy={137} r={4}/><Circle cx={73} cy={64} r={3}/><Circle cx={59} cy={78} r={3}/><Circle cx={278} cy={242} r={3}/><Circle cx={216} cy={323} r={3}/>
    </G>
    <G fill="none" strokeLinecap="round" strokeLinejoin="round">
      <G stroke="#FFF1D4" strokeWidth={5}>
        <Path d="M-9 107L83 120 174 142 234 150 330 119"/><Path d="M114-12L110 60 100 121 95 181Q94 223 140 267L206 331 240 373"/>
        <Path d="M-10 171L97 182 170 200 228 205 328 249"/><Path d="M3 335L66 309 143 279 196 244 229 186 261 145 321 138"/>
      </G>
      <G stroke="#EDC26E" strokeWidth={1.8}>
        <Path d="M-9 107L83 120 174 142 234 150 330 119"/><Path d="M114-12L110 60 100 121 95 181Q94 223 140 267L206 331 240 373"/>
        <Path d="M-10 171L97 182 170 200 228 205 328 249"/><Path d="M3 335L66 309 143 279 196 244 229 186 261 145 321 138"/>
      </G>
      <G stroke="#FFF8E8" strokeWidth={2.3}>
        <Path d="M-10 251L58 224 102 199 158 193 194 174 210 126 204 66 218-12"/>
        <Path d="M21-10L54 69 63 129 70 186 71 244 86 299 120 370"/>
        <Path d="M164 105L142 155 132 216 160 244 185 251 255 286 332 308"/>
        <Path d="M-8 289L41 273 93 280 150 310 193 300 251 333 329 354"/>
      </G>
    </G>
    <Rect x={4} y={4} width={312} height={352} fill="none" stroke="#FAECD4" strokeWidth={8}/>
  </Svg>;
}
