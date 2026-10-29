import React from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { ProfileFieldIcon } from './ProfileFieldIcon';
import { CAMPUS_ICONS } from '../core/profile/campusIcons';
import { ABOUT_ME_ICONS } from '../core/profile/aboutMeIcons';
import { profileInterestGradient } from '../core/profile/interestGradient';
import { INTEREST_CATEGORIES } from '@iem-dating/shared/interest-catalog';
import { interestEmojis } from '../features/auth/onboarding/InterestVisuals';
import { clubArtwork } from '../core/profile/clubArtwork';
import type { buildProfilePreview, PreviewFact } from '../screens/main/profile/profilePreviewModel';

const PINK = '#F3C1CA';
const interestIcons = new Map(INTEREST_CATEGORIES.flatMap(category => category.interests.flatMap(interest => {
  const emoji = interestEmojis[interest.id] ?? category.emoji;
  return [[interest.id.toLowerCase(), emoji], [interest.label.toLowerCase(), emoji]] as [string, string][];
})));
export function profileInterestEmoji(value: string) {
  return interestIcons.get(value.trim().toLowerCase()) ?? '✨';
}
const sectionColors: Record<string, readonly [string, string]> = {
  Bio: ['#292325', '#222222'],
  'About me': ['#272724', '#222222'],
  'Campus life': ['#23292D', '#222222'],
  Interests: ['#2B2723', '#222222'],
  Clubs: ['#232C28', '#222222'],
  'Favourite places': ['#2C2923', '#222222'],
  Personality: ['#29252B', '#222222'],
  Lifestyle: ['#232B28', '#222222'],
};
const interestColors: Record<string, { colors: readonly [string, string]; text: string }> = {
  'Things I like': { colors: ['#F8E3E7', '#EDCDD5'], text: '#492B36' },
  Clubs: { colors: ['#E4F2EC', '#C9E3D8'], text: '#29483C' },
  'Favourite hangouts': { colors: ['#F8EDDA', '#EBD8BC'], text: '#493A27' },
};
export function ProfileContentCard({ title, icon, children, action }: { title: string; icon: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <LinearGradient colors={sectionColors[title] ?? ['#282828', '#222222']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.section}>
    <View style={s.sectionHeading}><ProfileFieldIcon name={icon} size={18} color={PINK} /><Text style={s.sectionTitle}>{title}</Text>{action ? <View style={s.sectionAction}>{action}</View> : null}</View>
    {children}
  </LinearGradient>;
}

export function ProfileInterestPills({ values, group = 'Things I like', showIcons = false, showClubArtwork = false }: { values: string[]; group?: string; showIcons?: boolean; showClubArtwork?: boolean }) {
  const palette = interestColors[group] ?? interestColors['Things I like'];
  return <View style={s.chips}>{values.map(value => {
    const chipPalette = group === 'Things I like' ? profileInterestGradient(value) : { colors: palette.colors, color: palette.text };
    const artwork = showClubArtwork ? clubArtwork[value] : undefined;
    const hasIcon = showIcons || showClubArtwork;
    return <LinearGradient key={value} colors={chipPalette.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.chip, hasIcon && s.chipWithIcon, showClubArtwork && s.clubChip]}>
      {artwork ? <Image accessible={false} source={Platform.OS === 'web' && typeof artwork === 'string' ? {uri: artwork as unknown as string} : artwork}
        resizeMode="contain" resizeMethod="resize" fadeDuration={0} style={s.clubImage}/>
        : showClubArtwork ? <Ionicons accessible={false} name="people-outline" size={18} color={chipPalette.color}/>
        : showIcons && <Text accessible={false} style={s.chipIcon}>{profileInterestEmoji(value)}</Text>}
      <Text style={[s.chipText, { color: chipPalette.color }, hasIcon && s.chipLabel, showClubArtwork && s.clubLabel]}>{value}</Text>
    </LinearGradient>;
  })}</View>;
}

function Facts({ values }: { values: PreviewFact[] }) {
  return <View style={s.facts}>{values.map(fact => <View key={fact.label} style={s.fact}>
    <ProfileFieldIcon name={fact.icon} size={16} color="#D9C9B8" />
    <View style={s.flex}><Text style={s.factLabel}>{fact.label}</Text><Text style={s.factValue}>{fact.value}</Text></View>
  </View>)}</View>;
}

export function ProfileContentSections({ data, afterSection, showInterestIcons = true, bioAction }: {
  data: ReturnType<typeof buildProfilePreview>;
  afterSection?: (section: 'bio' | 'campus' | 'interests' | 'lifestyle') => React.ReactNode;
  showInterestIcons?: boolean;
  /** Beside the Bio title: the open profile's comment button. */
  bioAction?: React.ReactNode;
}) {
  const interestGroups = data.interestGroups.filter(group => group.title === 'Things I like');
  const communityGroups = data.interestGroups.filter(group => group.title !== 'Things I like');
  return <>
      {!!data.bio && <ProfileContentCard title="Bio" icon="create-outline" action={bioAction}><Text style={s.bio}>{data.bio}</Text></ProfileContentCard>}
      {afterSection?.('bio')}
      {data.basics.length > 0 && <ProfileContentCard title="About me" icon={ABOUT_ME_ICONS.section}><Facts values={data.basics} /></ProfileContentCard>}
      {(data.college || data.course || data.campus.length > 0) && <ProfileContentCard title="Campus life" icon={CAMPUS_ICONS.section}>
        {data.college && <View style={s.education}>
          <View style={s.collegeIcon}><Ionicons name={CAMPUS_ICONS.college} size={22} color="#E5D7C6" /></View>
          <View style={s.flex}>
            <Text style={s.college}>{data.college}</Text>
          </View>
        </View>}
        {(data.department || data.degree) && <View style={s.academicDetails}>
          {[
            { label: 'Department', value: data.department, icon: CAMPUS_ICONS.department },
            { label: 'Degree', value: data.degree, icon: CAMPUS_ICONS.degree },
          ].filter(field => field.value).map((field, index) => <View key={field.label} style={[s.academicRow, index > 0 && s.academicDivider]}>
            <View style={s.academicHeading}><ProfileFieldIcon name={field.icon} size={16} color="#CABBAB" /><Text style={s.academicLabel}>{field.label}</Text></View>
            <Text style={s.academicValue}>{field.value}</Text>
          </View>)}
        </View>}
        {data.campus.length > 0 && <View style={s.campusGrid}>
          {data.campus.map(fact => <View key={fact.label} style={s.campusTile}>
            <View style={s.campusTileHeading}><ProfileFieldIcon name={fact.icon} size={16} color="#D9C9B8" /><Text style={s.campusLabel}>{fact.label}</Text></View>
            <Text style={s.campusValue}>{fact.value}</Text>
          </View>)}
        </View>}
      </ProfileContentCard>}
      {afterSection?.('campus')}
      {interestGroups.length > 0 && <ProfileContentCard title="Interests" icon={ABOUT_ME_ICONS.interests}>
        {interestGroups.map(group => <View key={group.title} style={s.interestGroup}>
          <View style={s.groupHeading}>{group.icon && <Ionicons name={group.icon} size={14} color="#D9C9B8" />}<Text style={s.groupLabel}>{group.title}</Text></View>
          <ProfileInterestPills values={group.values} group={group.title} showIcons={showInterestIcons} />
        </View>)}
      </ProfileContentCard>}
      {communityGroups.map(group => <ProfileContentCard key={group.title}
        title={group.title === 'Favourite hangouts' ? 'Favourite places' : group.title}
        icon={group.icon ?? ABOUT_ME_ICONS.interests}>
        <ProfileInterestPills values={group.values} group={group.title} showClubArtwork={group.title === 'Clubs'} />
      </ProfileContentCard>)}
      {afterSection?.('interests')}
      {data.personality.length > 0 && <ProfileContentCard title="Personality" icon={ABOUT_ME_ICONS.personality}><Facts values={data.personality} /></ProfileContentCard>}
      {data.lifestyle.length > 0 && <ProfileContentCard title="Lifestyle" icon={ABOUT_ME_ICONS.lifestyle}><Facts values={data.lifestyle} /></ProfileContentCard>}
      {afterSection?.('lifestyle')}
  </>;
}

const s = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  section: { padding: 14, borderRadius: 18, backgroundColor: '#222222', gap: 12 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionAction: { marginLeft: 'auto', marginVertical: -8 },
  sectionTitle: { fontFamily: 'DMSans_700Bold', fontSize: 17, lineHeight: 23, color: '#FFF4F6' },
  bio: { fontFamily: 'DMSans_400Regular', fontSize: 16, lineHeight: 25, color: '#E0DAD5' },
  facts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 16 },
  fact: { flexBasis: '45%', flexGrow: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  factLabel: { fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19, color: '#BBB2AB' },
  factValue: { marginTop: 3, fontFamily: 'DMSans_500Medium', fontSize: 15, lineHeight: 22, color: '#F7F3ED' },
  education: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  collegeIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#36332E', alignItems: 'center', justifyContent: 'center' },
  college: { fontFamily: 'DMSans_700Bold', fontSize: 16, lineHeight: 23, color: '#F7F3ED' },
  academicDetails: { paddingHorizontal: 2 },
  academicRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  academicDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#3A3C3C' },
  academicHeading: { width: 110, flexDirection: 'row', alignItems: 'center', gap: 7 },
  academicLabel: { flexShrink: 1, fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19, color: '#C0B8AF' },
  academicValue: { flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 15, lineHeight: 22, color: '#F7F3ED' },
  campusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  campusTile: { flexBasis: '45%', flexGrow: 1, backgroundColor: '#2D3030', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 9, gap: 4 },
  campusTileHeading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  campusLabel: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19, color: '#C0B8AF' },
  campusValue: { fontFamily: 'DMSans_500Medium', fontSize: 15, lineHeight: 22, color: '#F7F3ED' },
  groupHeading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  interestGroup: { gap: 9 },
  groupLabel: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: '#D6CDC7' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { maxWidth: '100%', minHeight: 36, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 24, justifyContent: 'center', overflow: 'hidden' },
  chipText: { fontFamily: 'DMSans_500Medium', fontSize: 15, lineHeight: 23 },
  chipWithIcon: {flexDirection: 'row', alignItems: 'center', gap: 7},
  chipIcon: {fontSize: 17, lineHeight: 24},
  clubChip: {flexBasis: '45%', flexGrow: 1, minWidth: 0, minHeight: 42, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, justifyContent: 'flex-start', gap: 6},
  clubImage: {width: 24, height: 24},
  clubLabel: {flex: 1, fontSize: 14, lineHeight: 20},
  chipLabel: {flexShrink: 1},
});
