import { INTEREST_CATEGORIES } from '@iem-dating/shared/interest-catalog';
import { CAMPUS_ICONS } from '../../../core/profile/campusIcons';
import { ABOUT_ME_ICONS } from '../../../core/profile/aboutMeIcons';

export type PreviewProfile = {
  id?: string; name?: string; age?: number; avatarUrl?: string; isVerified?: boolean; blueBadge?: boolean;
  photos?: { id?: string; photoUrl?: string; isPrimary?: boolean }[];
  profileVideoUrl?: string; seeking?: string; height?: number;
  gender?: string; showGender?: boolean; orientation?: string[]; showOrientation?: boolean;
  college?: string; department?: string; degree?: string; graduationYear?: number; yearOfStudy?: number;
  campus?: string; isHosteller?: boolean; attendanceMood?: string;
  clubs?: string[]; hangoutSpots?: string[];
  preferences?: { bio?: string; interests?: string[]; personality?: Record<string, unknown>; lifestyle?: Record<string, unknown> };
};

export type PreviewFact = { label: string; value: string; icon: string };
export type PreviewMedia = { type: 'video'; uri: string } | { type: 'image'; uri: string; photoIndex: number };
const labels = new Map(INTEREST_CATEGORIES.flatMap(category => category.interests.map(interest => [interest.id, interest.label] as const)));
const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const readable = (value: string) => value.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase());
const unique = (values: string[] = []) => [...new Set(values.map(clean).filter(Boolean))];
const personalityFields = [
  ['communication', 'Communication style', ABOUT_ME_ICONS.communication],
  ['love_reception', 'Love language', ABOUT_ME_ICONS.love_reception],
  ['star_sign', 'Star sign', ABOUT_ME_ICONS.star_sign],
  ['personality', 'Personality', ABOUT_ME_ICONS.personality],
  ['education', 'Education', ABOUT_ME_ICONS.education],
];
const lifestyleFields = [
  ['drink', 'Drinking', ABOUT_ME_ICONS.drink], ['smoke', 'Smoking', ABOUT_ME_ICONS.smoke],
  ['exercise', 'Exercise', ABOUT_ME_ICONS.exercise], ['pets', 'Pets', ABOUT_ME_ICONS.pets],
];
function answerFacts(fields: string[][], answers?: Record<string, unknown>): PreviewFact[] {
  return fields.flatMap(([key, label, icon]) => {
    const value = clean(answers?.[key]);
    return value ? [{ label, icon, value: readable(value) }] : [];
  });
}

export function buildProfilePreview(profile: PreviewProfile) {
  const savedPhotos = (profile.photos ?? []).filter(photo => clean(photo.photoUrl));
  const primary = savedPhotos.findIndex(photo => photo.isPrimary);
  const ordered = primary > 0 ? [savedPhotos[primary], ...savedPhotos.filter((_, index) => index !== primary)] : savedPhotos;
  const photos = unique(ordered.map(photo => clean(photo.photoUrl))).slice(0, 6);
  if (!photos.length && clean(profile.avatarUrl)) photos.push(clean(profile.avatarUrl));
  const video = clean(profile.profileVideoUrl);
  const media: PreviewMedia[] = video ? [{ type: 'video', uri: video }] : [];
  photos.forEach((uri, photoIndex) => media.push({ type: 'image', uri, photoIndex }));
  const basics: PreviewFact[] = [];
  if (profile.height && Number.isFinite(profile.height)) basics.push({ label: 'Height', value: `${profile.height} cm`, icon: ABOUT_ME_ICONS.height });
  if (profile.showGender !== false && clean(profile.gender)) basics.push({ label: 'Gender', value: clean(profile.gender), icon: ABOUT_ME_ICONS.gender });
  const orientation = unique(profile.orientation);
  if (profile.showOrientation !== false && orientation.length) basics.push({ label: 'Orientation', value: orientation.join(', '), icon: ABOUT_ME_ICONS.orientation });
  const campus: PreviewFact[] = [];
  if (clean(profile.campus)) campus.push({ label: 'Campus', value: clean(profile.campus), icon: CAMPUS_ICONS.campus });
  if (profile.graduationYear) campus.push({ label: 'Class', value: String(profile.graduationYear), icon: CAMPUS_ICONS.graduationYear });
  if (profile.yearOfStudy) campus.push({ label: 'Year of study', value: `Year ${profile.yearOfStudy}`, icon: CAMPUS_ICONS.yearOfStudy });
  if (typeof profile.isHosteller === 'boolean') campus.push({ label: 'Residency', value: profile.isHosteller ? 'Hosteller' : 'Day scholar', icon: CAMPUS_ICONS.residency });
  if (clean(profile.attendanceMood)) campus.push({ label: 'Attendance mood', value: clean(profile.attendanceMood), icon: CAMPUS_ICONS.attendanceMood });
  const interestGroups = [
    { title: 'Things I like', values: unique((profile.preferences?.interests ?? []).map(value => labels.get(value) ?? readable(value))) },
    { title: 'Clubs', icon: CAMPUS_ICONS.clubs, values: unique(profile.clubs) },
    { title: 'Favourite hangouts', icon: CAMPUS_ICONS.hangoutSpots, values: unique(profile.hangoutSpots) },
  ].filter(group => group.values.length);
  return {
    photos, media, name: clean(profile.name) || 'Your profile', age: profile.age,
    verified: profile.blueBadge === true, bio: clean(profile.preferences?.bio), seeking: clean(profile.seeking),
    video, college: clean(profile.college), department: clean(profile.department), degree: clean(profile.degree),
    course: [clean(profile.department), clean(profile.degree)].filter(Boolean).join(' · '),
    basics, campus, interestGroups,
    personality: answerFacts(personalityFields, profile.preferences?.personality),
    lifestyle: answerFacts(lifestyleFields, profile.preferences?.lifestyle),
  };
}
