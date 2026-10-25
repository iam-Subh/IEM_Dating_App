export type StudiesInput = {degree: string; yearOfStudy: string; graduationYear: string};
export type StudiesErrors = Partial<Record<keyof StudiesInput, string>>;

/**
 * The same rules as onboarding's "What do you study?" (AcademicIntroduction):
 * a degree, a graduation year from 2020 to 2100, and - optionally - the
 * current year of study, 1 to 10.
 */
export function parseStudies(input: StudiesInput) {
  const errors: StudiesErrors = {};
  const degree = input.degree.trim();
  const year = input.yearOfStudy.trim();
  const graduation = input.graduationYear.trim();
  if (!degree) errors.degree = 'Choose your degree.';
  else if (degree.length > 255) errors.degree = 'Use 255 characters or fewer.';
  if (year && (!/^\d+$/.test(year) || Number(year) < 1 || Number(year) > 10)) {
    errors.yearOfStudy = 'Use a number from 1 to 10.';
  }
  if (!graduation) errors.graduationYear = 'Enter your graduation year.';
  else if (!/^\d{4}$/.test(graduation) || Number(graduation) < 2020 || Number(graduation) > 2100) {
    errors.graduationYear = 'Use a year from 2020 to 2100.';
  }
  return {errors, values: {
    degree,
    ...(year ? {yearOfStudy: Number(year)} : {}),
    graduationYear: Number(graduation),
  }};
}

export function formatStudyYear(year?: number | null) {
  if (!year || !Number.isInteger(year) || year < 1) return '';
  const lastTwo = year % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? 'th' : ({1: 'st', 2: 'nd', 3: 'rd'} as Record<number, string>)[year % 10] || 'th';
  return `${year}${suffix} year`;
}

export function studiesSummary(studies: {degree?: string | null; yearOfStudy?: number | null; graduationYear?: number | null}) {
  return [studies.degree?.trim(), formatStudyYear(studies.yearOfStudy), studies.graduationYear?.toString()].filter(Boolean).join(' · ');
}
