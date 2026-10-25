import React from 'react';
import Svg, { Path } from 'react-native-svg';
import type { BrushId } from '../composition/types';

export type DrawToolIconName = Exclude<BrushId, 'fill'> | 'undo' | 'pipette';

// Lucide shapes: https://lucide.dev/icons/. See DrawToolIcon.LICENSE.
// Marker and neon are custom shapes on the same 24 px grid.
export const DRAW_TOOL_ICON_PATHS: Record<DrawToolIconName, readonly string[]> = {
  pen: [
    'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
    'm15 5 4 4',
  ],
  arrow: ['M13 5H19V11', 'M19 5L5 19'],
  marker: [
    'm14 3 7 7-9 9-7-7Z',
    'm5 12-2 6 3 3 6-2',
    'm3 18 3-3 3 3-3 3',
    'm12 5 7 7',
  ],
  neon: [
    'M3 18c2-6 4-8 6-6s1 7 4 7 5-3 6-6',
    'M14 3v3M19 5l-2 2M21 10h-3',
  ],
  highlighter: ['m9 11-6 6v3h9l3-3', 'm22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4'],
  eraser: [
    'M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21',
    'm5.082 11.09 8.828 8.828',
  ],
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11'],
  pipette: [
    'm12 9-8.414 8.414A2 2 0 0 0 3 18.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 3.828 21h1.344a2 2 0 0 0 1.414-.586L15 12',
    'm18 9 .4.4a1 1 0 1 1-3 3l-3.8-3.8a1 1 0 1 1 3-3l.4.4 3.4-3.4a1 1 0 1 1 3 3z',
    'm2 22 .414-.414',
  ],
};

export function DrawToolIcon({ name, size = 24, color = '#FFFFFF' }: {
  name: DrawToolIconName; size?: number; color?: string;
}) {
  return <Svg accessible={false} width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    {name === 'neon' && <Path d={DRAW_TOOL_ICON_PATHS.neon[0]} strokeWidth={5} opacity={0.22} />}
    {DRAW_TOOL_ICON_PATHS[name].map((d, index) => <Path key={index} d={d} />)}
  </Svg>;
}
