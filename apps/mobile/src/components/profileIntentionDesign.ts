type IntentionIcon = 'heart' | 'heart-outline' | 'time-outline' | 'calendar-outline' | 'star' | 'chatbubble' | 'chatbubbles' | 'chatbubble-ellipses-outline' | 'help-circle-outline' | 'help';

export type IntentionDesign = {
  id: 'partner' | 'long-flexible' | 'short-flexible' | 'fun' | 'friends' | 'figuring' | 'unknown';
  colors: readonly [string, string, string];
  accent: string;
  label: string;
  icon: IntentionIcon;
  largeIcon: IntentionIcon;
  smallIcon: IntentionIcon;
};

const DESIGNS: Record<string, IntentionDesign> = {
  'long-term partner': {
    id: 'partner', colors: ['#292428', '#462B35', '#663044'], accent: '#F5BACB', label: '#DFB4C2',
    icon: 'heart', largeIcon: 'heart', smallIcon: 'heart',
  },
  'long-term, but short-term ok': {
    id: 'long-flexible', colors: ['#292529', '#453039', '#655044'], accent: '#F4C6B5', label: '#E0C0B6',
    icon: 'heart', largeIcon: 'heart', smallIcon: 'time-outline',
  },
  'short-term, but long-term ok': {
    id: 'short-flexible', colors: ['#2C2725', '#49362D', '#60414B'], accent: '#FFC6B4', label: '#E5BEB7',
    icon: 'calendar-outline', largeIcon: 'calendar-outline', smallIcon: 'heart',
  },
  'short-term fun': {
    id: 'fun', colors: ['#2C2624', '#493130', '#655039'], accent: '#FFD2A0', label: '#E5C3A8',
    icon: 'star', largeIcon: 'star', smallIcon: 'star',
  },
  'new friends': {
    id: 'friends', colors: ['#24292B', '#2C4042', '#334D60'], accent: '#B9DFDC', label: '#BAD2D5',
    icon: 'chatbubbles', largeIcon: 'chatbubble', smallIcon: 'chatbubble',
  },
  'still figuring it out': {
    id: 'figuring', colors: ['#25282D', '#303844', '#3C4B5C'], accent: '#C5D3E3', label: '#C0CBDB',
    icon: 'help-circle-outline', largeIcon: 'chatbubble-ellipses-outline', smallIcon: 'help',
  },
};

const UNKNOWN: IntentionDesign = {
  id: 'unknown', colors: ['#28262A', '#343037', '#403B44'], accent: '#D7CDD5', label: '#C9BCC6',
  icon: 'heart-outline', largeIcon: 'heart-outline', smallIcon: 'help',
};

/** Match stored answers without changing the text shown on the profile. */
export function profileIntentionDesign(value: string): IntentionDesign {
  const key = value.trim().toLowerCase().replace(/\s+/g, ' ');
  // Older demo profiles and stored answers used this label.
  if (key === 'a long-term relationship') return DESIGNS['long-term partner'];
  return Object.prototype.hasOwnProperty.call(DESIGNS, key) ? DESIGNS[key] : UNKNOWN;
}
