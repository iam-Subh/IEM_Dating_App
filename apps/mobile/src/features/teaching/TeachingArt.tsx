import React from 'react';
import {Image} from 'react-native';

export const TEACHING_ART = {
  'welcome-campus': require('../../../assets/illustrations/teach-welcome-campus.png'),
  'welcome-rose': require('../../../assets/illustrations/teach-welcome-rose.png'),
  'welcome-shield': require('../../../assets/illustrations/teach-welcome-shield.png'),
  'guide-explore': require('../../../assets/illustrations/teach-guide-explore.png'),
  'guide-stories': require('../../../assets/illustrations/teach-guide-stories.png'),
  'guide-comments': require('../../../assets/illustrations/teach-guide-comments.png'),
  'guide-likes': require('../../../assets/illustrations/teach-guide-likes.png'),
  'guide-chats': require('../../../assets/illustrations/teach-guide-chats.png'),
  'guide-verify': require('../../../assets/illustrations/teach-guide-verify.png'),
  'guide-hide-place': require('../../../assets/illustrations/teach-guide-hide-place.png'),
  'guide-safety': require('../../../assets/illustrations/teach-guide-safety.png'),
  'guide-shake': require('../../../assets/illustrations/teach-guide-shake.png'),
  'guide-cover': require('../../../assets/illustrations/teach-guide-cover.png'),
} as const;

export type TeachingArtName = keyof typeof TEACHING_ART;

export const teachingArtworkCatalog: {name: TeachingArtName; title: string; group: string}[] = [
  {name: 'welcome-campus', title: 'Meet people on campus', group: 'Welcome'},
  {name: 'welcome-rose', title: 'Stand out', group: 'Welcome'},
  {name: 'welcome-shield', title: 'You are in control', group: 'Welcome'},
  {name: 'guide-explore', title: 'Swiping', group: 'Guide'},
  {name: 'guide-stories', title: 'Stories', group: 'Guide'},
  {name: 'guide-comments', title: 'Comments', group: 'Guide'},
  {name: 'guide-likes', title: 'Likes You', group: 'Guide'},
  {name: 'guide-chats', title: 'Chats', group: 'Guide'},
  {name: 'guide-verify', title: 'Verification', group: 'Guide'},
  {name: 'guide-hide-place', title: 'Hide at a place', group: 'Guide'},
  {name: 'guide-safety', title: 'Staying safe', group: 'Guide'},
  {name: 'guide-shake', title: 'Shake to report', group: 'Guide'},
  {name: 'guide-cover', title: 'How IEM Connect works', group: 'Guide cover'},
];

/** Transparent artwork for teaching screens. Motion belongs to the gesture hand. */
export function TeachingArt({name, size = 160, label}: {name: TeachingArtName; size?: number; label?: string}) {
  return <Image source={TEACHING_ART[name]} style={{width: size, height: size}} resizeMode="contain" accessible={!!label} accessibilityLabel={label}/>;
}
