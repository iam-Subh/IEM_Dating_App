import React from 'react';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { CAMPUS_ICONS } from '../core/profile/campusIcons';

type Props = Omit<React.ComponentProps<typeof Ionicons>, 'name'> & { name: string };

/** The numbered list identifies academic years without reusing another field's icon. */
export function CampusFieldIcon({ name, ...props }: Props) {
  if (name === CAMPUS_ICONS.yearOfStudy) {
    return <MaterialCommunityIcons {...props} name={CAMPUS_ICONS.yearOfStudy} />;
  }
  return <Ionicons {...props} name={name as React.ComponentProps<typeof Ionicons>['name']} />;
}
