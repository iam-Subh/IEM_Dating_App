import {
  ACADEMIC_COURSES, ATTENDANCE_STYLES, DATING_INTENTIONS, LIFESTYLE_SECTIONS,
  ORIENTATION_OPTIONS, PERSONALITY_SECTIONS, PROFILE_CLUBS, GENDER_OPTIONS, GENDER_DETAILS, GRADUATION_YEARS, DEGREE_OPTIONS,
} from '../../core/profile/profileOptions';
import { INTEREST_CATEGORIES, normalizeInterests } from '@iem-dating/shared/interest-catalog';
import { CAMPUS_ICONS } from '../../core/profile/campusIcons';
import { ABOUT_ME_ICONS, aboutMeFieldIcon } from '../../core/profile/aboutMeIcons';

export const PREFERENCE_COLORS = {
  accent: '#F3C1CA', accentText: '#331C23', background: '#100F0D', surface: '#242427',
  selected: '#3F2B33', secondary: '#B8BDC2', muted: '#3A3D41',
};
export type PreferenceOption = { value: string; label: string; detail?: string; section?: string };
export type PreferenceCriterion = {
  id: string; label: string; icon: string; group: 'Connection' | 'Lifestyle' | 'Personality' | 'College';
  options: PreferenceOption[]; profileValues: (user: any) => string[];
  searchable?: boolean; range?: { minimum: number; maximum: number; unit: string };
};
const values = (value: unknown): string[] => typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
const named = (items: { id: string; label: string }[]): PreferenceOption[] => items.map((item) => ({ value: item.id, label: item.label }));

export const PREFERENCE_CRITERIA: PreferenceCriterion[] = [
  { id: 'gender', label: 'Gender', icon: ABOUT_ME_ICONS.gender, group: 'Connection', searchable: true,
    options: GENDER_OPTIONS.flatMap((gender) => [
      { value: gender.id, label: gender.label, section: gender.label },
      ...GENDER_DETAILS[gender.id].map((item) => ({ value: item.label, label: item.label, section: gender.label })),
    ]), profileValues: (user) => values(user?.gender) },
  { id: 'intention', label: 'Dating intention', icon: 'heart-outline', group: 'Connection',
    options: DATING_INTENTIONS.map((item) => ({ value: item.id, label: item.title })), profileValues: (user) => values(user?.seeking) },
  { id: 'interests', label: 'Shared interests', icon: ABOUT_ME_ICONS.interests, group: 'Connection', searchable: true,
    options: INTEREST_CATEGORIES.flatMap((category) => named(category.interests).map((option) => ({ ...option, section: category.title }))), profileValues: (user) => normalizeInterests(user?.preferences?.interests) },
  { id: 'orientation', label: 'Orientation', icon: ABOUT_ME_ICONS.orientation, group: 'Connection',
    options: named(ORIENTATION_OPTIONS), profileValues: (user) => values(user?.orientation) },
  { id: 'height', label: 'Height', icon: ABOUT_ME_ICONS.height, group: 'Connection', options: [], range: { minimum: 91, maximum: 244, unit: 'cm' },
    profileValues: (user) => user?.height >= 91 && user.height <= 244 ? [String(user.height), String(user.height)] : [] },
  ...LIFESTYLE_SECTIONS.map((section): PreferenceCriterion => ({
    id: section.id, label: ({ drink: 'Drinking', smoke: 'Smoking', exercise: 'Exercise', pets: 'Pets' } as Record<string, string>)[section.id],
    icon: aboutMeFieldIcon(section.id),
    group: 'Lifestyle', options: named(section.options), profileValues: (user) => values(user?.preferences?.lifestyle?.[section.id]),
  })),
  ...PERSONALITY_SECTIONS.map((section): PreferenceCriterion => ({
    id: section.id, label: ({ communication: 'Communication style', love_reception: 'Love language', education: 'Education level', star_sign: 'Star sign', personality: 'Personality' } as Record<string, string>)[section.id],
    icon: aboutMeFieldIcon(section.id),
    group: 'Personality', options: named(section.options), profileValues: (user) => values(user?.preferences?.personality?.[section.id]),
  })),
  { id: 'degree', label: 'Degree', icon: CAMPUS_ICONS.degree, group: 'College',
    options: [...DEGREE_OPTIONS.map(value => ({ value, label: value })), ...ACADEMIC_COURSES.map((course) => ({ value: course.title, label: course.title }))], profileValues: (user) => values(user?.degree) },
  { id: 'department', label: 'Department', icon: CAMPUS_ICONS.department, group: 'College', searchable: true,
    options: ACADEMIC_COURSES.flatMap((course) => course.courses.map((name) => ({ value: name, label: name, section: course.title }))), profileValues: (user) => values(user?.department) },
  { id: 'year', label: 'Year of study', icon: CAMPUS_ICONS.yearOfStudy, group: 'College',
    options: [1, 2, 3, 4].map((year) => ({ value: String(year), label: `${year}${['st', 'nd', 'rd', 'th'][year - 1]} year` })),
    profileValues: (user) => user?.yearOfStudy ? [String(user.yearOfStudy)] : [] },
  { id: 'graduation', label: 'Graduation year', icon: CAMPUS_ICONS.graduationYear, group: 'College', searchable: true,
    options: GRADUATION_YEARS.map((year) => ({ value: String(year), label: `Class of ${year}` })),
    profileValues: (user) => user?.graduationYear ? [String(user.graduationYear)] : [] },
  { id: 'residency', label: 'Residency', icon: CAMPUS_ICONS.residency, group: 'College',
    options: [{ value: 'hosteller', label: 'Hosteller' }, { value: 'day_scholar', label: 'Day scholar' }],
    profileValues: (user) => typeof user?.isHosteller === 'boolean' ? [user.isHosteller ? 'hosteller' : 'day_scholar'] : [] },
  { id: 'clubs', label: 'Clubs', icon: CAMPUS_ICONS.clubs, group: 'College',
    options: PROFILE_CLUBS.map((club) => ({ value: club, label: club })), profileValues: (user) => values(user?.clubs) },
  { id: 'attendance', label: 'Attendance style', icon: CAMPUS_ICONS.attendanceMood, group: 'College',
    options: ATTENDANCE_STYLES.map((style) => ({ value: style, label: style })), profileValues: (user) => values(user?.attendanceMood) },
];

export function criterionProfileAnswer(criterion: PreferenceCriterion, user: any) {
  const stored = criterion.profileValues(user);
  if (criterion.range) return stored;
  return stored.filter((value) => criterion.options.some((option) => option.value === value));
}

export function criterionValueLabel(criterion: PreferenceCriterion, selected: string[]) {
  if (!selected.length) return 'Open to all';
  if (criterion.range) return `${selected[0]}–${selected[1]} ${criterion.range.unit}`;
  const first = criterion.options.find((option) => option.value === selected[0])?.label ?? 'Selected';
  return selected.length > 1 ? `${first} +${selected.length - 1}` : first;
}
