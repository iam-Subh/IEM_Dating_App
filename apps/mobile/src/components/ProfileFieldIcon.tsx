import React from 'react';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { ABOUT_ME_ICONS, ABOUT_ME_MATERIAL_ICONS } from '../core/profile/aboutMeIcons';
import { CampusFieldIcon } from './CampusFieldIcon';

type Props = Omit<React.ComponentProps<typeof Ionicons>, 'name'> & { name: string };

export function ProfileFieldIcon({ name, ...props }: Props) {
  if (name === ABOUT_ME_ICONS.star_sign) {
    const { size = 18, color = '#FFFFFF', style } = props;
    return <Svg width={size} height={size} viewBox="0 0 24 24" style={style} accessible={false}
      fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx={12} cy={12} r={10} />
      <Circle cx={12} cy={12} r={7} />
      {Array.from({ length: 12 }, (_, index) => {
        const angle = index * Math.PI / 6;
        return <Line key={index} x1={12 + 7 * Math.cos(angle)} y1={12 + 7 * Math.sin(angle)}
          x2={12 + 10 * Math.cos(angle)} y2={12 + 10 * Math.sin(angle)} />;
      })}
      <Path d="M12 8.5 13 11 15.5 12 13 13 12 15.5 11 13 8.5 12 11 11Z" />
    </Svg>;
  }
  if (ABOUT_ME_MATERIAL_ICONS.has(name)) {
    return <MaterialCommunityIcons {...props} accessible={false} name={name as React.ComponentProps<typeof MaterialCommunityIcons>['name']} />;
  }
  return <CampusFieldIcon {...props} accessible={false} name={name} />;
}
