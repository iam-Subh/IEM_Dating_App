import React from 'react';
import {G, Path} from 'react-native-svg';

const HAND = 'M46 140L46 129C39 126 34 120 31 113C28 107 25 102 25 96C25 91 29 87 33 83C36 80 39 81 41 85C42 88 40 91 39 94C38 97 40 99 43 100C44 71 41 45 43 27C43 16 46 8 53 8C60 8 63 15 63 25C62 40 62 51 64 66C67 60 73 57 78 60C83 62 85 67 86 73C90 69 96 70 100 75C103 79 103 83 103 87C108 85 112 89 114 94C117 101 116 110 113 118C110 126 104 131 96 134L94 144Z';

/** Shared back-of-hand artwork. The parent controls gesture motion. */
export function TeachingHandArt() {
  return <G strokeLinecap="round" strokeLinejoin="round">
    <Path d={HAND} fill="#F6E7D6" stroke="#F6E7D6" strokeWidth={4}/>
            <Path d={HAND} fill="#F6E7D6" stroke="#7A4A44" strokeWidth={1.6}/>
            <Path d="M64 66L65 81M86 73L87 91M103 87L103 102M68 77C72 74 78 75 81 79M90 85C93 82 98 84 100 87M106 97L111 98" fill="none" stroke="#7A4A44" strokeWidth={1.4}/>
            <Path d="M34 103C35 109 40 114 47 118" fill="none" stroke="#7A4A44" strokeWidth={1.5}/>
            <Path d="M48 26C47 20 49 14 53 14C57 14 59 20 58 26L57 30C54 31 51 31 49 29Z" fill="#F2DCCB" stroke="#7A4A44" strokeWidth={1}/>
            <Path d="M33 86C35 83 38 84 39 87L37 92C35 93 32 91 32 89Z" fill="#F2DCCB" stroke="#7A4A44" strokeWidth={0.9}/>
            <Path d="M28 98C30 97 32 98 33 99" fill="none" stroke="#7A4A44" strokeWidth={0.9}/>
            <Path d="M49 44C52 43 56 43 59 44M49 59C52 58 56 58 59 59M49 82C52 80 57 80 60 83M55 94C56 105 58 115 61 124M76 94C77 104 78 113 78 122" fill="none" stroke="#7A4A44" strokeWidth={1}/>
            <Path d="M43 138C59 143 80 145 98 141L102 166C82 171 60 170 40 165Z" fill="#8A809E" stroke="#F6E7D6" strokeWidth={4}/>
            <Path d="M43 138C59 143 80 145 98 141L102 166C82 171 60 170 40 165Z" fill="#8A809E" stroke="#7A4A44" strokeWidth={1.6}/>
            <Path d="M45 144C61 148 80 150 96 146M87 150L90 163" fill="none" stroke="#7A4A44" strokeWidth={1.1}/>
  </G>;
}
