export const PROFILE_SETUP_STEPS = [
  'HouseRules', 'NameSelection', 'BirthdaySelection', 'GenderSelection',
  'CollegeSelection', 'AcademicSelection', 'SeekingSelection',
  'OrientationSelection', 'Interests', 'ShareMore', 'LifestyleHabits',
  'PersonalityTraits', 'SocialSelection', 'MatchingPreferences',
  'PhotoUpload', 'RealPersonCheck', 'OnboardingReview',
] as const;

export function nextProfileStep(route: string): string | undefined {
  const index = PROFILE_SETUP_STEPS.findIndex(step => step === route);
  return index >= 0 ? PROFILE_SETUP_STEPS[index + 1] : undefined;
}

export function previousProfileStep(route: string): string | undefined {
  const index = PROFILE_SETUP_STEPS.findIndex(step => step === route);
  return index > 0 ? PROFILE_SETUP_STEPS[index - 1] : undefined;
}
