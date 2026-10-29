import React, { useId } from 'react';
import Svg, { Defs, Mask, Path, Rect } from 'react-native-svg';

export const STANDOUTS_HEART_PATH = 'M16.25 20.4 11.7 16c-1.9-1.9-.7-4.7 1.6-4.7 1.25 0 2.2.7 2.95 1.6.75-.9 1.7-1.6 2.95-1.6 2.3 0 3.5 2.8 1.6 4.7Z';

/** A selected profile with a heart. The same mark identifies Standouts everywhere. */
export function StandoutsIcon({ size = 24, color = '#E8C698', heartColor = color, illustrated = false }: {
  size?: number;
  color?: string;
  heartColor?: string;
  illustrated?: boolean;
}) {
  const backMask = `standouts-back-${useId().replace(/:/g, '')}`;
  return <Svg width={size} height={size} viewBox="0 0 28 28" accessible={false}>
    <Defs>
      <Mask id={backMask} x={0} y={0} width={28} height={28} maskUnits="userSpaceOnUse" maskType="luminance">
        <Rect width={28} height={28} fill="#fff" />
        <Rect x={6.5} y={6} width={19.5} height={20} rx={4.5} fill="#000" />
      </Mask>
    </Defs>
    <Rect x={2} y={3} width={18} height={18} rx={3.5} mask={`url(#${backMask})`}
      fill={illustrated ? '#38342B' : 'none'} stroke={color} strokeWidth={illustrated ? 1.1 : 1.9} opacity={0.65} />
    <Rect x={7.5} y={7} width={17.5} height={18} rx={3.5} fill={illustrated ? '#30242B' : 'none'}
      stroke={color} strokeWidth={illustrated ? 1.1 : 1.9} />
    <Path d={STANDOUTS_HEART_PATH}
      fill={heartColor} />
  </Svg>;
}
