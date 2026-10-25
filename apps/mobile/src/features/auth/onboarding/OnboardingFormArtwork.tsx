import React, {memo} from 'react';
import {View} from 'react-native';
import Svg, {Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop, Text as SvgText} from 'react-native-svg';

// Shared artwork preserves the onboarding illustrations in profile editors.
export const lifestyleDesign: Record<string, {label: string; tint: string; light: string; dark: string}> = {
  drink: {label: 'Drinking', tint: '#F3E3E8', light: '#F6BBCF', dark: '#B36689'},
  smoke: {label: 'Smoking', tint: '#F4E8DD', light: '#E8B78F', dark: '#B57858'},
  exercise: {label: 'Exercise', tint: '#EBE6F0', light: '#C7B1D5', dark: '#80618F'},
  pets: {label: 'Pets', tint: '#E5ECE0', light: '#B7CBAA', dark: '#738D67'},
};

// Four small, static illustrations keep sheet opening independent of artwork updates.
export const LifestyleArt = memo(function LifestyleArt({id}: {id: string}) {
  const color = lifestyleDesign[id];
  return <Svg width="100%" height="100%" viewBox="0 0 120 110" accessible={false}>
    <Defs><LinearGradient id={`habit-${id}`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={color.light}/><Stop offset="1" stopColor={color.dark}/></LinearGradient></Defs>
    {id === 'drink' && <G transform="rotate(12 60 52)">
      <Ellipse cx="61" cy="96" rx="24" ry="4" fill={color.dark} opacity="0.12"/>
      <Path d="M38 17H82L78 51Q76 68 62 70V89L79 94Q82 95 79 97H41Q38 95 41 94L58 89V70Q44 68 42 51Z" fill="#BE8AA2" transform="translate(2 2)"/>
      <Path d="M38 17H82L78 51Q76 68 62 70V89L79 94Q82 95 79 97H41Q38 95 41 94L58 89V70Q44 68 42 51Z" fill="#FFF3F6" stroke="#C790A8" strokeWidth="1.5"/>
      <Path d="M42 42Q60 47 78 42L77 51Q75 67 60 67Q45 67 43 51Z" fill={`url(#habit-${id})`}/>
      <Path d="M45 22L48 48" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round"/>
      <Path d="M46 94H71" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round"/>
    </G>}
    {id === 'smoke' && <G transform="rotate(-16 60 60)">
      <Ellipse cx="59" cy="86" rx="41" ry="5" fill={color.dark} opacity="0.12"/>
      <Path d="M82 44C92 36 78 29 87 19M93 43C104 32 91 29 100 21" fill="none" stroke="#BBA99D" strokeWidth="3" strokeLinecap="round"/>
      <Rect x="18" y="57" width="84" height="19" rx="5" fill="#C7B6AA"/>
      <Rect x="18" y="53" width="84" height="19" rx="5" fill="#FFFAF4" stroke="#CAB5A5" strokeWidth="1.2"/>
      <Path d="M23 53H43V72H23Q18 72 18 67V58Q18 53 23 53Z" fill={`url(#habit-${id})`}/>
      <Path d="M43 54V71M47 54V71" stroke="#D8C5B6" strokeWidth="1"/>
      <Path d="M98 54V71" stroke="#95766A" strokeWidth="4"/>
      <Path d="M53 57H90" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round"/>
    </G>}
    {id === 'exercise' && <G transform="rotate(-10 60 62)">
      <Ellipse cx="62" cy="92" rx="44" ry="5" fill={color.dark} opacity="0.12"/>
      <Path d="M20 50L32 39L48 49L58 38L74 62L96 68Q106 72 105 85H17V64Z" fill="#614969" transform="translate(0 3)"/>
      <Path d="M20 47L32 36L48 46L58 35L74 59L96 65Q106 69 105 82H17V61Z" fill={`url(#habit-${id})`} stroke="#8A6B9B" strokeWidth="1.2"/>
      <Path d="M18 73Q53 79 103 74L105 82Q105 87 99 87H22Q17 87 17 82Z" fill="#FFFAFF" stroke="#BCAAC7" strokeWidth="1"/>
      <Path d="M50 46L62 42M55 52L67 48M60 58L72 54" stroke="#F3D6E4" strokeWidth="3" strokeLinecap="round"/>
      <Path d="M27 54L34 47L42 54" fill="none" stroke="#E3D4EB" strokeWidth="2" strokeLinecap="round"/>
      <Path d="M24 82H94" stroke="#D8C8E1" strokeWidth="1.5" strokeLinecap="round"/>
    </G>}
    {id === 'pets' && <G transform="rotate(10 60 56)">
      <Ellipse cx="60" cy="96" rx="34" ry="5" fill={color.dark} opacity="0.12"/>
      <G fill="#617E57" transform="translate(2 4)"><Ellipse cx="31" cy="47" rx="10" ry="14" transform="rotate(-25 31 47)"/><Ellipse cx="49" cy="29" rx="10" ry="14"/><Ellipse cx="74" cy="29" rx="10" ry="14"/><Ellipse cx="93" cy="47" rx="10" ry="14" transform="rotate(25 93 47)"/><Path d="M38 66C43 60 46 51 61 51C76 51 79 60 84 66C99 86 81 99 67 89Q61 85 55 89C41 99 23 86 38 66Z"/></G>
      <G fill={`url(#habit-${id})`}><Ellipse cx="31" cy="47" rx="10" ry="14" transform="rotate(-25 31 47)"/><Ellipse cx="49" cy="29" rx="10" ry="14"/><Ellipse cx="74" cy="29" rx="10" ry="14"/><Ellipse cx="93" cy="47" rx="10" ry="14" transform="rotate(25 93 47)"/><Path d="M38 66C43 60 46 51 61 51C76 51 79 60 84 66C99 86 81 99 67 89Q61 85 55 89C41 99 23 86 38 66Z"/></G>
      <Path d="M43 69Q49 58 60 58" fill="none" stroke="#DEECD4" strokeWidth="3" strokeLinecap="round"/>
    </G>}
  </Svg>;
});


export const personalityDesign: Record<string, {label: string; tint: string; light: string; dark: string}> = {
  communication: {label: 'Communication', tint: '#ECE7F2', light: '#DAC9E8', dark: '#9A7DAF'},
  love_reception: {label: 'Receiving love', tint: '#F4E4E9', light: '#F1BECE', dark: '#BA708E'},
  personality: {label: 'Personality', tint: '#F3E9DF', light: '#F1D4AF', dark: '#C2936D'},
  star_sign: {label: 'Star sign', tint: '#E7ECE2', light: '#D4DEBD', dark: '#8B9E78'},
};
export const zodiac: Record<string, string> = {capricorn: '♑', aquarius: '♒', pisces: '♓', aries: '♈', taurus: '♉', gemini: '♊', cancer: '♋', leo: '♌', virgo: '♍', libra: '♎', scorpio: '♏', sagittarius: '♐'};

export function Check() {
  return <Svg width={18} height={18} viewBox="0 0 24 24" accessible={false}><Path d="M5 12.5L10 17L19 7" fill="none" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/></Svg>;
}

export const ConnectionArt = memo(function ConnectionArt({id}: {id: string}) {
  const look = personalityDesign[id];
  return <Svg width="100%" height="100%" viewBox="0 0 100 100" accessible={false}>
    <Defs><LinearGradient id={`connect-${id}`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={look.light}/><Stop offset="1" stopColor={look.dark}/></LinearGradient></Defs>
    {id === 'communication' && <>
      <G transform="rotate(-10 43 39)">
        <Path d="M17 18H64Q74 18 74 28V51Q74 60 64 60H40L24 72L26 60H17Q8 60 8 51V28Q8 18 17 18Z" fill="#8C6CA3" transform="translate(1 3)"/>
        <Path d="M17 18H64Q74 18 74 28V51Q74 60 64 60H40L24 72L26 60H17Q8 60 8 51V28Q8 18 17 18Z" fill={`url(#connect-${id})`} stroke="#9B7CAF" strokeWidth="1"/>
        <Path d="M21 30H53M21 40H43" stroke="#FFF7FF" strokeWidth="3" strokeLinecap="round"/>
      </G>
      <G transform="rotate(8 65 65)"><Path d="M49 47H82Q91 47 91 56V72Q91 81 82 81H77L81 91L67 81H49Q40 81 40 72V56Q40 47 49 47Z" fill="#E9DAF1" stroke="#BCA0CC" strokeWidth="1.5"/><Circle cx="54" cy="64" r="2.5" fill="#9774AB"/><Circle cx="65" cy="64" r="2.5" fill="#9774AB"/><Circle cx="76" cy="64" r="2.5" fill="#9774AB"/></G>
    </>}
    {id === 'love_reception' && <G transform="rotate(-8 50 58)">
      <Path d="M13 43L50 17L87 43V80Q87 87 80 87H20Q13 87 13 80Z" fill="#D18CA5"/>
      <Path d="M13 43L50 17L87 43L50 71Z" fill="#C2819A"/>
      <Rect x="25" y="24" width="50" height="51" rx="7" fill="#FFF4F7" stroke="#E3B6C6"/>
      <Path d="M50 58C45 53 34 47 34 40C34 30 46 28 50 36C54 28 66 30 66 40C66 47 55 53 50 58Z" fill={`url(#connect-${id})`}/>
      <Path d="M13 44L50 66L87 44V80Q87 87 80 87H20Q13 87 13 80Z" fill={`url(#connect-${id})`} stroke="#C589A0" strokeWidth="1.2"/>
      <Path d="M15 82L40 60M85 82L60 60" stroke="#F8D6E2" strokeWidth="1.5"/>
      <Path d="M21 82H72" stroke="#FFEAF0" strokeWidth="2" strokeLinecap="round"/>
    </G>}
    {id === 'personality' && <>
      <G transform="rotate(-12 35 51)"><Ellipse cx="35" cy="53" rx="25" ry="32" fill="#C08D67"/><Ellipse cx="33" cy="50" rx="25" ry="32" fill={`url(#connect-${id})`}/><Path d="M22 46Q26 42 30 46M37 46Q41 42 45 46" stroke="#77533F" strokeWidth="2" fill="none" strokeLinecap="round"/><Path d="M24 58Q33 64 42 58" stroke="#77533F" strokeWidth="2.5" fill="none" strokeLinecap="round"/><Ellipse cx="19" cy="54" rx="4" ry="2" fill="#D39786" opacity="0.6"/></G>
      <G transform="rotate(14 68 59)"><Ellipse cx="69" cy="60" rx="23" ry="29" fill="#B78596"/><Ellipse cx="67" cy="57" rx="23" ry="29" fill="#E8B8C6"/><Circle cx="59" cy="52" r="2" fill="#785361"/><Circle cx="75" cy="52" r="2" fill="#785361"/><Path d="M57 62Q67 74 77 62Z" fill="#9F5E74"/><Path d="M60 64H74" stroke="#FFF4ED" strokeWidth="2" strokeLinecap="round"/></G>
    </>}
    {id === 'star_sign' && <>
      <Path d="M57 14C23 17 11 57 31 78C46 94 70 90 83 74C49 85 31 43 57 14Z" fill="#82946E" transform="translate(2 3)"/>
      <Path d="M57 14C23 17 11 57 31 78C46 94 70 90 83 74C49 85 31 43 57 14Z" fill={`url(#connect-${id})`} stroke="#8E9F79" strokeWidth="1"/>
      <Path d="M38 26Q23 41 27 57" stroke="#EDF2DD" strokeWidth="3" fill="none" strokeLinecap="round"/>
      <Path d="M67 31L83 45L67 60" stroke="#A6B193" strokeWidth="1.3" fill="none"/>
      <Circle cx="67" cy="31" r="3" fill="#8B9E78"/><Circle cx="83" cy="45" r="3" fill="#8B9E78"/><Circle cx="67" cy="60" r="3" fill="#8B9E78"/>
      <Path d="M79 14V24M74 19H84" stroke="#8B9E78" strokeWidth="2" strokeLinecap="round"/>
    </>}
  </Svg>;
});


export const intentionCopy: Record<string, {title: string; detail: string; art: number}> = {
  'Long-term partner': {title: 'Long-term partner', detail: 'Looking for something lasting', art: 0},
  'Long-term, but short-term OK': {title: 'Mostly long-term', detail: 'Open to something short-term', art: 1},
  'Short-term, but long-term OK': {title: 'Mostly short-term', detail: 'Open to something long-term', art: 2},
  'Short-term fun': {title: 'Short-term fun', detail: 'Keeping things casual', art: 3},
  'New friends': {title: 'New friends', detail: 'Here to build friendships', art: 4},
  'Still figuring it out': {title: 'Still exploring', detail: 'Figuring out what I want', art: 5},
};

// All six drawings share a 64-unit canvas, rounded strokes, and the same palette.
export function IntentionArt({kind}: {kind: number}) {
  const heart = 'M32 43C29 40 14 30 14 21C14 11 27 8 32 18C37 8 50 11 50 21C50 30 35 40 32 43Z';
  return <Svg width={56} height={38} viewBox="0 0 64 52" accessible={false}>
    <Ellipse cx={32} cy={27} rx={25} ry={23} fill="#F5E7EB"/>
    <G stroke="#82445E" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {kind === 0 && <>
        <Path d={heart} fill="#DFA6B9"/>
        <Path d="M20 22C20 17 24 16 27 19" stroke="#FFF5F8" fill="none"/>
        <Path d="M26 29L30 33Q31 34 32 32L39 24" fill="none"/>
      </>}
      {kind === 1 && <>
        <Path d={heart} transform="translate(-5 -1) scale(.9)" fill="#DFA6B9"/>
        <Path d="M35 35C35 29 41 27 45 33C49 27 55 29 55 35C55 40 48 45 45 47C42 45 35 40 35 35Z" fill="#F5D5C4"/>
        <Path d="M15 19Q17 15 21 17" stroke="#FFF5F8" fill="none"/>
      </>}
      {kind === 2 && <>
        <Path d="M10 24L53 10L41 43L29 31L22 40L22 28Z" fill="#E7B7C6"/>
        <Path d="M22 28L53 10L29 31" fill="#FAE5EC"/>
        <Path d="M12 36L8 40M17 42L14 46" fill="none"/>
      </>}
      {kind === 3 && <>
        <G transform="rotate(18 22 27)">
          <Path d="M15 12H29V23C29 33 15 33 15 23Z" fill="#E3ABBE"/>
          <Path d="M16 20H28M22 31V43M16 43H28" fill="none"/>
        </G>
        <G transform="rotate(-18 43 27)">
          <Path d="M36 12H50V23C50 33 36 33 36 23Z" fill="#F5D5C4"/>
          <Path d="M37 20H49M43 31V43M37 43H49" fill="none"/>
        </G>
        <Path d="M32 5V9" fill="none"/>
      </>}
      {kind === 4 && <>
        <Path d="M10 10H35Q41 10 41 16V28Q41 34 35 34H23L14 40V34H10Q5 34 5 28V16Q5 10 10 10Z" fill="#E3ABBE"/>
        <Path d="M34 23H54Q59 23 59 28V38Q59 43 54 43H51V48L43 43H34Q29 43 29 38V28Q29 23 34 23Z" fill="#F5D5C4"/>
        <Path d="M13 21H29M37 33H51" fill="none"/>
      </>}
      {kind === 5 && <>
        <Circle cx={32} cy={27} r={20} fill="#FAEFF3"/>
        <Path d="M39 17L36 31L25 37L28 23Z" fill="#DFA6B9"/>
        <Path d="M28 23L36 31L25 37Z" fill="#F5D5C4"/>
        <Path d="M32 10V13M49 27H46M32 44V41M15 27H18" fill="none"/>
      </>}
    </G>
  </Svg>;
}


const leftRibbon = 'M65 103C50 92 27 77 18 59C8 39 18 20 36 19C48 18 57 25 64 34L57 45C51 37 43 32 35 34C23 37 24 48 29 58C37 72 54 84 72 95Z';
const rightRibbon = 'M64 34C75 17 94 14 109 25C125 38 120 58 107 73C96 85 82 95 72 104L60 97C78 85 96 71 103 57C110 42 100 29 89 32C82 33 76 38 70 45Z';

export const OrientationArtwork = memo(function OrientationArtwork() {
  return <Svg width="100%" height="100%" viewBox="0 0 132 128" accessible={false}>
    <Defs>
      <LinearGradient id="orientationRose" x1="12" y1="22" x2="76" y2="106" gradientUnits="userSpaceOnUse">
        <Stop offset="0" stopColor="#FFE0E9"/><Stop offset="0.35" stopColor="#EAA1B9"/><Stop offset="0.73" stopColor="#CA6B92"/><Stop offset="1" stopColor="#8F3C62"/>
      </LinearGradient>
      <LinearGradient id="orientationPlum" x1="78" y1="22" x2="106" y2="97" gradientUnits="userSpaceOnUse">
        <Stop offset="0" stopColor="#D8B5CF"/><Stop offset="0.42" stopColor="#B477A0"/><Stop offset="0.76" stopColor="#7D446F"/><Stop offset="1" stopColor="#552A51"/>
      </LinearGradient>
      <RadialGradient id="orientationShadow"><Stop offset="0" stopColor="#715365" stopOpacity="0.18"/><Stop offset="1" stopColor="#715365" stopOpacity="0"/></RadialGradient>
    </Defs>
    <Ellipse cx="70" cy="116" rx="44" ry="9" fill="url(#orientationShadow)"/>
    <G transform="translate(2 5)"><Path d={leftRibbon} fill="#A15176"/><Path d={rightRibbon} fill="#54274B"/></G>
    <Path d={leftRibbon} fill="url(#orientationRose)"/>
    <Path d={rightRibbon} fill="url(#orientationPlum)"/>
    <Path d="M20 49C15 32 29 19 42 25C48 27 52 31 57 37" fill="none" stroke="#FFEAF0" strokeWidth="2" strokeLinecap="round" opacity="0.8"/>
    <Path d="M72 34C84 20 103 22 110 34" fill="none" stroke="#ECD3E5" strokeWidth="1.8" strokeLinecap="round" opacity="0.8"/>
    <Path d="M101 70C90 83 77 93 67 99" fill="none" stroke="#D99FC0" strokeWidth="1" strokeLinecap="round" opacity="0.55"/>
  </Svg>;
});


export function InterestArtwork() {
  return <Svg width={114} height={108} viewBox="0 0 132 124" accessible={false}>
    <G stroke="#7D4B66" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <G transform="translate(73 6) rotate(13 22 24)">
        <Path d="M2 32V22C2-3 44-3 44 22V32" fill="none" strokeWidth={7} stroke="#E4A5BE"/>
        <Path d="M2 32V22C2 0 44 0 44 22V32" fill="none"/>
        <Rect x={-3} y={24} width={13} height={22} rx={5} fill="#E4A5BE"/>
        <Rect x={36} y={24} width={13} height={22} rx={5} fill="#E4A5BE"/>
        <Path d="M4 29V39M42 29V39" stroke="#FAE8EF"/>
      </G>
      <G transform="translate(8 7) rotate(-12 22 31)">
        <Rect x={0} y={4} width={44} height={59} rx={5} fill="#E9C9A9"/>
        <Path d="M5 51H44V63H5C-2 63-2 51 5 51Z" fill="#FFF4E7"/>
        <Path d="M8 5V50M8 55H39M8 59H39" fill="none" strokeWidth={1.6}/>
        <Path d="M22 5H33V30L27.5 25L22 30Z" fill="#BC789A"/>
      </G>
      <G transform="translate(37 70) rotate(7 32 20)">
        <Path d="M16 4H47Q57 4 61 15L65 29Q69 45 55 43L44 33H20L9 43Q-5 45-1 29L3 15Q6 4 16 4Z" fill="#D8C9DF"/>
        <Path d="M17 14V27M10.5 20.5H23.5" strokeWidth={3}/>
        <Path d="M44 15H44.1M51 22H51.1" stroke="#A8567F" strokeWidth={5}/>
        <Path d="M28 13H35M28 30H35" fill="none"/>
      </G>
    </G>
  </Svg>;
}


export const socialTints = ['#EAE5F1', '#E6ECDF', '#F4E4E9', '#F3E8DC'];
export const SocialArt = memo(function Art({kind}: {kind: number}) {
  return <Svg width="100%" height="100%" viewBox="0 0 100 90" accessible={false}>
    <Defs><LinearGradient id={`social-${kind}`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={kind === 1 ? '#C8D5B4' : kind === 3 ? '#EDC7A0' : '#E7B7CC'}/><Stop offset="1" stopColor={kind === 1 ? '#829B6D' : kind === 3 ? '#C28F61' : '#B87394'}/></LinearGradient></Defs>
    {kind === 0 && <G transform="rotate(-9 50 45)"><Rect x="20" y="18" width="63" height="62" rx="10" fill="#9C7CAE"/><Rect x="16" y="14" width="63" height="62" rx="10" fill="#FFFAFF" stroke="#AC90BC" strokeWidth="2"/><Path d="M16 34H79V24Q79 14 69 14H26Q16 14 16 24Z" fill="#BCA0CE"/><Path d="M31 9V22M64 9V22" stroke="#80608D" strokeWidth="5" strokeLinecap="round"/><SvgText x="47" y="60" fontSize="24" fontWeight="bold" textAnchor="middle" fill="#80608D">75%</SvgText></G>}
    {kind === 1 && <G transform="rotate(-10 48 46)"><Rect x="20" y="12" width="54" height="67" rx="7" fill="#748E61"/><Rect x="17" y="9" width="54" height="67" rx="7" fill="url(#social-1)"/><Path d="M28 10V75M37 29H60M37 39H58M37 49H52" stroke="#F1F6E9" strokeWidth="2.5" strokeLinecap="round"/><Path d="M78 23L87 27L67 70L59 76L60 66Z" fill="#E8B783" stroke="#B3835C" strokeWidth="1.5"/><Path d="M59 76L61 67L67 70Z" fill="#735742"/></G>}
    {kind === 2 && <><Path d="M60 23H86V49H60ZM60 49V76M85 49V76M57 51H90" fill="#D9BFCA" stroke="#B38A9E" strokeWidth="3" strokeLinejoin="round"/><Path d="M17 39H50L46 68Q33 80 21 68Z" fill="url(#social-2)"/><Path d="M50 43H55Q66 56 48 59" fill="none" stroke="#BA809C" strokeWidth="4"/><Path d="M25 28C19 21 30 19 25 12M37 29C32 23 42 18 38 12" fill="none" stroke="#B899A8" strokeWidth="2" strokeLinecap="round"/><Path d="M16 75H54" stroke="#A36A84" strokeWidth="3" strokeLinecap="round"/></>}
    {kind === 3 && <><Circle cx="49" cy="47" r="32" fill="#BC8C60"/><Circle cx="46" cy="43" r="32" fill="url(#social-3)"/><Circle cx="46" cy="43" r="25" fill="#FFFAF0"/><Path d="M46 22V43L61 50" stroke="#8F6245" strokeWidth="3.5" fill="none" strokeLinecap="round"/><Path d="M46 11A32 32 0 0 1 78 43" stroke="#B96A80" strokeWidth="5" fill="none" strokeLinecap="round"/><Circle cx="46" cy="43" r="3" fill="#8F6245"/></>}
    {kind === 4 && <><Path d="M15 37H83V79H15Z" fill="#ECD9C4"/><Path d="M12 22H86L91 40H8Z" fill="#CA8D9F"/><Path d="M22 22L19 40M40 22L39 40M58 22L60 40M75 22L80 40" stroke="#FFF2E8" strokeWidth="8"/><Rect x="24" y="49" width="20" height="19" rx="2" fill="#A9BEAB"/><Path d="M57 79V50H74V79" fill="#9A7680"/><Path d="M10 80H88" stroke="#B29A83" strokeWidth="3" strokeLinecap="round"/></>}
  </Svg>;
});


export function ConversationArt() {
  const rear = 'M23 12H62Q78 12 78 28V45Q78 61 62 61H34L21 72Q18 74 18 70V60Q7 58 7 45V28Q7 12 23 12Z';
  const front = 'M48 46H77Q93 46 93 62V76Q93 92 77 92H75V102Q75 105 72 103L59 92H48Q32 92 32 76V62Q32 46 48 46Z';
  return <View accessible={false} pointerEvents="none" style={{width: 80, height: 88}}>
    <Svg width="100%" height="100%" viewBox="0 0 104 112" accessible={false}>
      <Defs>
        <LinearGradient id="bioRose" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#F7D4E0"/><Stop offset="1" stopColor="#D890AC"/></LinearGradient>
        <LinearGradient id="bioPlum" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#A66586"/><Stop offset="1" stopColor="#67304F"/></LinearGradient>
      </Defs>
      <G transform="rotate(-7 43 42)">
        <Path d={rear} transform="translate(0 2)" fill="#BF7895"/>
        <Path d={rear} fill="url(#bioRose)" stroke="#D59AB1" strokeWidth="0.8"/>
        <Path d="M17 29Q17 20 27 20H59" fill="none" stroke="#FFE9F0" strokeWidth="2.5" strokeLinecap="round"/>
        <Path d="M29 37H29.1M42 37H42.1M55 37H55.1" stroke="#985775" strokeWidth="6" strokeLinecap="round"/>
      </G>
      <G transform="rotate(7 62 74)">
        <Path d={front} transform="translate(0 2)" fill="#542540"/>
        <Path d={front} fill="url(#bioPlum)" stroke="#8A4D6E" strokeWidth="0.8"/>
        <Path d="M42 62Q42 54 51 54H73" fill="none" stroke="#C58CA8" strokeWidth="2" strokeLinecap="round"/>
        <Path d="M62.5 81C59 78 49 71 49 64.5C49 56 59 55 62.5 61C66 55 76 56 76 64.5C76 71 66 78 62.5 81Z" fill="#F9DDE8"/>
      </G>
    </Svg>
  </View>;
}



export function ResidencyGraphic({hosteller}: {hosteller: boolean}) {
  return <Svg width={56} height={50} viewBox="0 0 80 72" accessible={false}>
    <G stroke="#A2657F" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {hosteller ? <>
        <Path d="M13 13V63M65 13V63M13 31H65M13 55H65" fill="none"/>
        <Rect x={16} y={20} width={46} height={10} rx={3} fill="#E6BCCB"/>
        <Rect x={16} y={44} width={46} height={10} rx={3} fill="#E6BCCB"/>
        <Rect x={18} y={17} width={13} height={7} rx={3} fill="#FAEDE5"/>
        <Rect x={18} y={41} width={13} height={7} rx={3} fill="#FAEDE5"/>
        <Path d="M13 15H65M49 18V63M59 18V63M49 35H59M49 43H59M49 51H59M49 59H59" fill="none"/>
      </> : <>
        <Path d="M31 16V11Q31 7 36 7H44Q49 7 49 11V16" fill="none"/>
        <Path d="M24 27C15 26 16 49 20 58M56 27C65 26 64 49 60 58" fill="none"/>
        <Path d="M22 28Q22 15 35 15H45Q58 15 58 28V58Q58 64 52 64H28Q22 64 22 58Z" fill="#E6BCCB"/>
        <Path d="M28 31V27Q28 21 35 21H45Q52 21 52 27V31" fill="none"/>
        <Rect x={28} y={38} width={24} height={19} rx={5} fill="#FAEDE5"/>
        <Path d="M29 44H51M47 44V48M40 21V28" fill="none"/>
      </>}
    </G>
  </Svg>;
}

