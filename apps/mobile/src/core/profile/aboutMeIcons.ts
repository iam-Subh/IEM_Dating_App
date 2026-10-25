/** Shared symbols for profile details, editors, setup, and preferences. */
export const ABOUT_ME_ICONS = Object.freeze({
  section: 'account-details-outline',
  lifestyle: 'heart-pulse',
  personality: 'head-cog-outline',
  interests: 'shape-outline',
  height: 'human-male-height',
  gender: 'gender-male-female',
  orientation: 'heart-multiple-outline',
  communication: 'message-text-outline',
  love_reception: 'hand-heart-outline',
  education: 'school-outline',
  star_sign: 'zodiac-wheel',
  drink: 'glass-wine',
  smoke: 'smoking',
  exercise: 'dumbbell',
  pets: 'paw-outline',
} as const);

export const ABOUT_ME_MATERIAL_ICONS = new Set<string>([
  ABOUT_ME_ICONS.section, ABOUT_ME_ICONS.lifestyle, ABOUT_ME_ICONS.personality,
  ABOUT_ME_ICONS.interests, ABOUT_ME_ICONS.height, ABOUT_ME_ICONS.gender,
  ABOUT_ME_ICONS.orientation, ABOUT_ME_ICONS.communication, ABOUT_ME_ICONS.love_reception,
  ABOUT_ME_ICONS.drink, ABOUT_ME_ICONS.smoke, ABOUT_ME_ICONS.exercise,
  'handshake-outline',
]);

export function aboutMeFieldIcon(field: string): string {
  return Object.prototype.hasOwnProperty.call(ABOUT_ME_ICONS, field)
    ? ABOUT_ME_ICONS[field as keyof typeof ABOUT_ME_ICONS] : ABOUT_ME_ICONS.section;
}
