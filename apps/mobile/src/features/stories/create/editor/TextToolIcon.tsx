import React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

type Name = 'left' | 'center' | 'right' | 'background' | 'animation' | 'done';

// Alignment paths: https://lucide.dev/icons/text-align-center.
// See StoryEditorIcon.LICENSE. Background and animation shapes are custom.
const ALIGNMENT_PATHS = {
  left: ['M21 5H3', 'M15 12H3', 'M17 19H3'],
  center: ['M21 5H3', 'M17 12H7', 'M19 19H5'],
  right: ['M21 5H3', 'M21 12H9', 'M21 19H7'],
} as const;

export function TextToolIcon({ name, size = 24, color = '#FFF4F6', fill = 'none', letters = color }: {
  name: Name; size?: number; color?: string; fill?: string; letters?: string;
}) {
  return <Svg accessible={false} width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    {(name === 'left' || name === 'center' || name === 'right') &&
      ALIGNMENT_PATHS[name].map(d => <Path key={d} d={d} />)}
    {name === 'background' && <>
      <Rect x={2} y={2} width={20} height={20} rx={4} fill={fill} />
      <Path d="m7 17 5-10 5 10M9 13h6" stroke={letters} />
    </>}
    {name === 'animation' && <>
      <Path d="m3 18 4-12 4 12M4.5 14h5M15 7h6M15 11h3" />
      <Path d="m15 15 6 3-6 3Z" fill={color} strokeWidth={1.5} />
    </>}
    {name === 'done' && <Path d="m5 12 4 4L19 6" />}
  </Svg>;
}
