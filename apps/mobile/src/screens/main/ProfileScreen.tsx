import { BlueBadgeRow, RealPersonProfileBadge } from '../../features/verification/RealPerson';
import { useSocketEvent } from '../../services/useSocketEvent';
import {useVerificationStatus} from '../../features/verification/useVerificationStatus';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { INTEREST_CATEGORIES } from '@iem-dating/shared/interest-catalog';
import { colors } from '../../core/theme/colors';
import { CAMPUS_ICONS } from '../../core/profile/campusIcons';
import { CampusFieldIcon } from '../../components/CampusFieldIcon';
import { ProfileFieldIcon } from '../../components/ProfileFieldIcon';
import { ABOUT_ME_ICONS } from '../../core/profile/aboutMeIcons';
import { api } from '../../services/api';
import { RootState, store } from '../../store';
import { updateUser } from '../../store/authSlice';
import { VerifiedBadge } from '../../features/discovery/components/VerifiedBadge';
import { loadProfileForSession } from './profile/loadProfileForSession';
import { ProfileVideoPreview } from './profile/ProfileVideoPreview';
import { ProfileAchievementCard, type ProfileTask } from './profile/ProfileAchievementCard';
import { profileEditorParams, type ProfileEditorSection } from './profile/profileEditNavigation';
import {studiesSummary} from './edit/studiesModel';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type Photo = { id: string; photoUrl: string; isPrimary: boolean };
type Profile = {
  id: string; name: string; age?: number; gender?: string; showGender: boolean;
  orientation: string[]; showOrientation: boolean; seeking?: string; college?: string;
  department?: string; graduationYear?: number; yearOfStudy?: number; campus?: string; degree?: string;
  isHosteller?: boolean; clubs: string[]; hangoutSpots: string[]; attendanceMood?: string;
  preferences?: { bio?: string; interests?: string[]; [key: string]: unknown };
  isVerified: boolean; blueBadge?: boolean; avatarUrl?: string; profileVideoUrl?: string; photos: Photo[];
};

/** How long someone stays on Profile before the editor is built in the background. */
const EDITOR_PRELOAD_DELAY_MS = 1200;
const labelMap = new Map(INTEREST_CATEGORIES.flatMap(c => c.interests.map(i => [i.id, i.label] as const)));
const interestLabel = (value: string) => labelMap.get(value) ?? value.replace(/_/g, ' ').replace(/\b\w/g, x => x.toUpperCase());
const PROFILE_TEXT_SECONDARY = '#D1CEC8';
const PROFILE_TEXT_SUBTLE = '#AEA9A2';
const PROFILE_CARD_SURFACE = '#222222';
const PROFILE_ACCENT = '#F3C1CA';
const PROFILE_ITEM_TEXT = '#332D26';
const PROFILE_CARD_TRANSITION = LinearTransition.duration(360).easing(Easing.inOut(Easing.cubic));
const INTEREST_ITEM_TRANSITION = LinearTransition.duration(240).easing(Easing.inOut(Easing.cubic));

const Section = ({ title, icon, onEdit, children, count, accent = '#DDD9D1', boxed = true }: {
  title: string; icon: string; onEdit: () => void; children: React.ReactNode; count?: string; accent?: string; boxed?: boolean;
}) => (
  <Animated.View layout={PROFILE_CARD_TRANSITION} style={[s.section, boxed && s.sectionBox]}>
    <View style={s.sectionHead}>
      <View style={s.titleRow}><View style={s.sectionIcon}><ProfileFieldIcon name={icon} size={16} color={accent} /></View><Text style={s.sectionTitle}>{title}</Text>{count && <Text style={s.sectionCount}>{count}</Text>}</View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Edit ${title}`} activeOpacity={0.8} hitSlop={6} onPress={onEdit} style={s.myPhotosEditBtn}><Text style={s.myPhotosEditText}>Edit</Text></TouchableOpacity>
    </View>
    {children}
  </Animated.View>
);

const Empty = ({ icon, title, body, onPress }: { icon: string; title: string; body: string; onPress: () => void }) => (
  <TouchableOpacity accessibilityRole="button" activeOpacity={0.88} onPress={onPress} style={s.empty}>
    <View style={s.emptyIcon}><ProfileFieldIcon name={icon} size={21} color={PROFILE_ACCENT} /></View>
    <View style={s.emptyCopy}><Text style={s.emptyTitle}>{title}</Text><Text style={s.emptyBody}>{body}</Text></View>
    <View style={s.addCircle}><Ionicons name="add" size={20} color="#fff" /></View>
  </TouchableOpacity>
);

const CampusFact = ({ icon, label, value }: { icon: IconName; label: string; value: string }) => (
  <View style={s.campusFact}>
    <CampusFieldIcon name={icon} size={17} color="#D8C8B5" />
    <View style={s.flex}><Text style={s.infoLabel}>{label}</Text><Text style={s.infoValue}>{value}</Text></View>
  </View>
);

const VisibilityRow = ({ label, icon, shown, onPress, last }: { label: string; icon: string; shown: boolean; onPress: () => void; last?: boolean }) => (
  <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${label}, ${shown ? 'shown' : 'hidden'}. Edit visibility.`}
    activeOpacity={0.85} onPress={onPress} style={[s.visibilityRow, last && s.noBorder]}>
    <ProfileFieldIcon name={icon} size={18} color="#BCE5D0" />
    <Text style={s.visibilityLabel}>{label}</Text>
    <View style={[s.visibilityStatus, !shown && s.visibilityHidden]}><Text style={[s.visibilityStatusText, !shown && s.visibilityHiddenText]}>{shown ? 'Shown' : 'Hidden'}</Text></View>
    <Ionicons name="chevron-forward" size={17} color={PROFILE_TEXT_SUBTLE} />
  </TouchableOpacity>
);

export const ProfileScreen = () => {
  const dispatch = useDispatch();
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const storedUser = useSelector((state: RootState) => state.auth.user);
  const verification = useVerificationStatus();
  const hasToken = useSelector((state: RootState) => !!state.auth.token);
  const accountId = storedUser?.id as string | undefined;
  const profile = storedUser as Profile | null;
  const [loading, setLoading] = useState(!storedUser);
  const [refreshing, setRefreshing] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [interestsExpanded, setInterestsExpanded] = useState(false);
  const profileRequest = useRef<AbortController | null>(null);

  const fetchProfile = useCallback(async () => {
    profileRequest.current?.abort();
    const controller = new AbortController();
    profileRequest.current = controller;
    try {
      if (!accountId || !hasToken) return;
      await loadProfileForSession({
        accountId,
        signal: controller.signal,
        getSession: () => store.getState().auth,
        fetchProfile: signal => api.get('/profile', { signal }),
        applyProfile: profile => dispatch(updateUser(profile)),
      });
    } catch (error) {
      if (!controller.signal.aborted) console.warn('[Profile] Could not refresh profile:', error);
    } finally {
      if (profileRequest.current === controller && !controller.signal.aborted) {
        profileRequest.current = null;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [dispatch, accountId, hasToken]);

  useEffect(() => {
    void fetchProfile();
    return () => {
      profileRequest.current?.abort();
      profileRequest.current = null;
    };
  }, [fetchProfile]);
  // Live: an edit from another phone, a photo the team removed, a birthday
  // approved - and after a reconnect, whatever changed meanwhile.
  useSocketEvent<{ userId?: string }>('profile_changed', (data) => {
    if (!data?.userId || data.userId === accountId) void fetchProfile();
  }, { enabled: !!accountId, onReconnect: true });

  const hasPreparedEditor = useRef(false);
  // JS idle time can occur during a native Back animation. On return, wait
  // for transitionEnd before rebuilding the editor that the stack removed.
  // Building the editor blocks JS for ~400 ms, and "idle" comes before this
  // screen has even painted - so it waits until the screen is up and the
  // person has stayed on it a moment; leaving first cancels it.
  useFocusEffect(useCallback(() => {
    if (!profile) return;
    const stack = navigation.getParent();
    let idle: ReturnType<typeof requestIdleCallback> | undefined;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const prepare = (delay: number) => {
      if (idle !== undefined) cancelIdleCallback(idle);
      if (settle !== undefined) clearTimeout(settle);
      settle = setTimeout(() => {
        settle = undefined;
        idle = requestIdleCallback(() => {
          idle = undefined;
          if (navigation.isFocused()) {
            hasPreparedEditor.current = true;
            stack?.preload('EditProfile', { profile });
          }
        });
      }, delay);
    };
    const unsubscribe = stack?.addListener('transitionEnd', () => prepare(0));
    if (!hasPreparedEditor.current) prepare(EDITOR_PRELOAD_DELAY_MS);
    return () => {
      if (idle !== undefined) cancelIdleCallback(idle);
      if (settle !== undefined) clearTimeout(settle);
      unsubscribe?.();
    };
  }, [navigation, profile]));

  const data = useMemo(() => {
    if (!profile) return null;
    const photos = profile.photos ?? [];
    const avatar = profile.avatarUrl || photos.find(p => p.isPrimary)?.photoUrl || photos[0]?.photoUrl;
    const bio = profile.preferences?.bio?.trim() ?? '';
    const raw = Array.isArray(profile.preferences?.interests) ? profile.preferences.interests : [];
    const personalInterests = raw.map(interestLabel).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
    const clubs = (profile.clubs ?? []).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
    const hangoutSpots = (profile.hangoutSpots ?? []).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
    const interests = [...personalInterests, ...clubs, ...hangoutSpots]
      .filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
    const interestGroups = [
      { label: 'Things I like', items: personalInterests, color: '#D0C6B9', gradient: ['#EEE5D8', '#DCCDB9'] as const, icon: 'heart-outline' as IconName },
      { label: 'Clubs', items: clubs, color: '#D0C6B9', gradient: ['#ECE9E3', '#D9D5CD'] as const, icon: CAMPUS_ICONS.clubs },
      { label: 'Favorite hangouts', items: hangoutSpots, color: '#D0C6B9', gradient: ['#F0E9DC', '#DED2BC'] as const, icon: CAMPUS_ICONS.hangoutSpots },
    ].filter(group => group.items.length > 0);
    const checks = [
      { ok: Boolean(avatar), title: 'Profile photo', label: 'Add your first photo', route: 'EditProfile', section: 'photos' as const },
      { ok: photos.length >= 6, title: 'Photo collection', label: 'Add all six photos', route: 'EditProfile', section: 'photos' as const },
      { ok: bio.length >= 20, title: 'About me', label: 'Write a short bio', route: 'EditBio' },
      { ok: Boolean(profile.seeking), title: 'Dating intention', label: 'Choose what you are looking for', route: 'EditSeeking' },
      { ok: Boolean(profile.college && profile.department && profile.graduationYear), title: 'College details', label: 'Complete your college details', route: 'EditProfile', section: 'campus' as const },
      { ok: interests.length >= 3, title: 'Interests', label: 'Add at least three interests', route: 'EditInterests' },
      { ok: Boolean(profile.campus && profile.degree), title: 'Campus and degree', label: 'Add your campus and degree', route: 'EditProfile', section: 'campus' as const },
      { ok: Boolean(profile.gender && profile.orientation?.length), title: 'Identity details', label: 'Complete your identity details', route: 'EditProfile', section: 'about' as const },
    ];
    return { photos, avatar, bio, interests, interestGroups, checks };
  }, [profile]);

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
  if (!profile || !data) return <View style={s.center}><Ionicons name="alert-circle-outline" size={42} color={colors.text.tertiary} /><Text style={s.error}>Could not load your profile.</Text><TouchableOpacity activeOpacity={0.88} onPress={fetchProfile} style={s.retry}><Text style={s.retryText}>Try again</Text></TouchableOpacity></View>;

  const photoWidth = (width - 72) / 3;
  const hasBlueBadge = verification ? verification.verified && verification.realPersonVerified : profile.blueBadge;
  const photoHeight = Math.min(140, photoWidth * 1.12);
  const mainPhotoIndex = Math.max(0, data.photos.findIndex(photo => photo.isPrimary));
  const galleryPhotos = data.photos.length
    ? [data.photos[mainPhotoIndex], ...data.photos.filter((_, index) => index !== mainPhotoIndex)].slice(0, 6)
    : [];
  const course = [profile.department, profile.degree].filter(Boolean).join(' · ');
  const schoolRows = [
    profile.campus ? { icon: CAMPUS_ICONS.campus, label: 'Campus', value: profile.campus } : null,
    profile.graduationYear ? { icon: CAMPUS_ICONS.graduationYear, label: 'Class', value: String(profile.graduationYear) } : null,
    typeof profile.isHosteller === 'boolean' ? { icon: CAMPUS_ICONS.residency, label: 'Residency', value: profile.isHosteller ? 'Hosteller' : 'Day scholar' } : null,
    profile.attendanceMood ? { icon: CAMPUS_ICONS.attendanceMood, label: 'Attendance mood', value: profile.attendanceMood } : null,
  ].filter((x): x is NonNullable<typeof x> => Boolean(x));
  const openEditor = (route: string, section?: ProfileEditorSection) => navigation.navigate(route, profileEditorParams(route, profile, section));
  const editProfile = () => openEditor('EditProfile');
  const editPhotos = () => openEditor('EditProfile', 'photos');
  const editVideo = () => openEditor('EditProfile', 'video');
  const editCampus = () => openEditor('EditProfile', 'campus');
  const openProfileTask = (task: ProfileTask) => openEditor(task.route, task.section);
  const toggleInterests = () => setInterestsExpanded(value => !value);
  const interestItemCount = data.interestGroups.reduce((count, group) => count + group.items.length, 0);
  const collapsedInterestGroups = data.interestGroups.map(group => ({
    ...group,
    items: group.items.slice(0, group.label === 'Things I like' ? 6 : 2),
  }));
  const collapsedInterestCount = collapsedInterestGroups.reduce((count, group) => count + group.items.length, 0);
  const interestsCollapsible = collapsedInterestCount < interestItemCount;
  const visibleInterestGroups = interestsCollapsible && !interestsExpanded
    ? collapsedInterestGroups
    : data.interestGroups;

  return (
    <SafeAreaView edges={['top']} style={s.safe}>
      <ScrollView style={s.scroll} contentContainerStyle={[s.content, { paddingBottom: 140 + insets.bottom }]} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void fetchProfile(); }} tintColor={PROFILE_ACCENT} colors={[PROFILE_ACCENT]} progressBackgroundColor={colors.surface} />}>
        <View style={s.top}><Text style={s.screenTitle}>Profile</Text><TouchableOpacity accessibilityLabel="Open settings" activeOpacity={0.88} onPress={() => navigation.navigate('Settings')} style={s.settings}><Ionicons name="settings-outline" size={22} color="#fff" /></TouchableOpacity></View>
        {/* The blue badge's two steps, until both are done; "Re-verify" once it ends. Only the owner sees it. */}
        <BlueBadgeRow flush />

        <View style={s.hero}>
          <View style={s.avatarWrap}>
          <TouchableOpacity disabled={!data.avatar} activeOpacity={0.88} onPress={() => data.avatar && setImage(data.avatar)} style={s.avatarWrap}>
            <LinearGradient colors={['#F94E27', '#FF7E82', PROFILE_ACCENT]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.avatarRing}>
              <View style={s.avatarRingInset}>
                {data.avatar ? <Image source={{ uri: data.avatar }} style={s.avatar} /> : <View style={[s.avatar, s.avatarEmpty]}><Ionicons name="person" size={38} color={colors.text.tertiary} /></View>}
              </View>
            </LinearGradient>
          </TouchableOpacity>
          <View style={[s.badge, !hasBlueBadge && s.greyBadge]}>{hasBlueBadge ? <VerifiedBadge size={22}/> : <RealPersonProfileBadge/>}</View>
          </View>
          <View style={s.heroCopy}>
          <Text style={s.name} numberOfLines={3}>{profile.name}{profile.age ? `, ${profile.age}` : ''}</Text>
          <Text style={s.meta} numberOfLines={2}>{[profile.department, profile.graduationYear ? `Class of ${profile.graduationYear}` : null, profile.campus].filter(Boolean).join(' · ') || 'Complete your college details'}</Text>
          </View>
        </View>

        <View style={s.actions}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Edit profile" activeOpacity={0.85} onPress={editProfile} style={s.primary}>
            <MaterialCommunityIcons accessible={false} name="account-edit-outline" size={20} color="#331C23" />
            <Text style={s.primaryText}>Edit profile</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Preview your dating profile" activeOpacity={0.85} onPress={() => navigation.navigate('ProfilePreview')} style={s.secondary}>
            <Ionicons name="eye-outline" size={19} color={PROFILE_ACCENT} />
            <Text style={s.secondaryText}>Preview</Text>
          </TouchableOpacity>
        </View>

        <ProfileAchievementCard accountId={profile.id} tasks={data.checks} onOpen={() => navigation.navigate('ProfileProgress', { tasks: data.checks })} onNext={openProfileTask} />

        <Section title="Your photos" icon="images-outline" count={`${Math.min(data.photos.length, 6)} / 6`} onEdit={editPhotos}>
          <View style={s.photoGrid}>
            {Array.from({ length: 6 }).map((_, index) => {
              const photo = galleryPhotos[index];
              const photoUrl = photo?.photoUrl?.trim();
              return (
                <TouchableOpacity
                  key={photo?.id ?? `add-photo-${index}`}
                  accessibilityRole="button"
                  accessibilityLabel={photoUrl ? `View photo ${index + 1}${index === 0 ? ', main photo' : ''}` : 'Add a photo'}
                  activeOpacity={0.85}
                  onPress={() => photoUrl ? setImage(photoUrl) : editPhotos()}
                  style={[s.photoSlot, { width: photoWidth, height: photoHeight }]}
                >
                  {photoUrl ? <>
                    <Image source={{ uri: photoUrl }} style={s.photoSlotImage} resizeMode="cover" />
                    {index === 0 && <View style={s.mainPhoto}><Ionicons name="star" size={9} color="#331C23" /><Text style={s.mainPhotoText}>Main</Text></View>}
                  </> : <View style={s.photoSlotEmpty}>
                    <Ionicons name="add" size={22} color={PROFILE_ACCENT} />
                    <Text style={s.addPhotoText}>Add photo</Text>
                  </View>}
                </TouchableOpacity>
              );
            })}
          </View>
        </Section>

        <Section title="Your video" icon="videocam-outline" onEdit={editVideo}>
          <ProfileVideoPreview key={`${accountId}:${profile.profileVideoUrl ?? 'none'}`} source={profile.profileVideoUrl} onEdit={editVideo} />
        </Section>

        <Section title="About me" icon="chatbubble-ellipses-outline" onEdit={() => openEditor('EditBio')}>
          {data.bio ? <View style={s.bioCopy}><Text accessible={false} style={s.bioQuote}>“</Text><Text style={s.bio}>{data.bio}</Text></View> : <Empty icon="create-outline" title="Add a short bio" body="Give people a reason to start a conversation." onPress={() => openEditor('EditBio')} />}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Edit dating intention, ${profile.seeking || 'not set'}`} activeOpacity={0.88} onPress={() => openEditor('EditSeeking')} style={s.intent}>
            <LinearGradient colors={['#2E2429', '#492631', '#733245']} locations={[0, 0.6, 1]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={s.intentFill}>
              <View pointerEvents="none" accessible={false} style={s.intentHearts}>
                <Ionicons name="heart" size={44} color="rgba(255,178,195,0.10)" style={s.intentHeartLarge} />
                <Ionicons name="heart" size={25} color="rgba(255,178,195,0.18)" style={s.intentHeartSmall} />
              </View>
              <View style={s.intentCopy}><Text style={s.smallLabel}>Looking for</Text><Text style={s.intentValue}>{profile.seeking || 'Add your dating intention'}</Text></View>
              <Ionicons name="chevron-forward" size={18} color="#F4DCE2" />
            </LinearGradient>
          </TouchableOpacity>
        </Section>

        <Section title="Interests" icon={ABOUT_ME_ICONS.interests} onEdit={() => openEditor('EditInterests')}>
          {data.interestGroups.length ? (
            <View style={s.interestGroups}>
              {visibleInterestGroups.map(group => (
                <View key={group.label}>
                  <View style={s.interestGroupHeading}><Ionicons name={group.icon} size={14} color={group.color} /><Text style={[s.interestGroupLabel, { color: group.color }]}>{group.label}</Text><Text style={s.interestGroupCount}>{group.items.length}</Text></View>
                  <View style={s.chips}>
                    {group.items.map(x => (
                      <Animated.View
                        key={`${group.label}-${x}`}
                        entering={FadeIn.duration(180)}
                        exiting={FadeOut.duration(140)}
                        layout={INTEREST_ITEM_TRANSITION}
                        style={s.chip}
                      >
                        <LinearGradient colors={group.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.chipFill}>
                          <Text style={s.chipText}>{x}</Text>
                        </LinearGradient>
                      </Animated.View>
                    ))}
                  </View>
                </View>
              ))}
              {interestsCollapsible && (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityState={{ expanded: interestsExpanded }}
                  activeOpacity={0.88}
                  onPress={toggleInterests}
                  style={s.interestToggle}
                >
                  <Text style={s.interestToggleText}>{interestsExpanded ? 'Show less' : `Show all ${interestItemCount}`}</Text>
                  <Ionicons name={interestsExpanded ? 'chevron-up' : 'chevron-down'} size={17} color={PROFILE_ACCENT} />
                </TouchableOpacity>
              )}
            </View>
          ) : <Empty icon={ABOUT_ME_ICONS.interests} title="Add your interests" body="Show topics that can start a conversation." onPress={() => openEditor('EditInterests')} />}
        </Section>

        <Section title="Campus life" icon={CAMPUS_ICONS.section} accent="#D0C6B9" onEdit={editCampus}>
          {profile.college && <View style={s.education}>
            <View style={s.collegeIcon}><Ionicons name={CAMPUS_ICONS.college} size={21} color="#E5D7C6" /></View>
            <View style={s.flex}>
              <Text style={s.educationTitle}>{profile.college}</Text>
            </View>
          </View>}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Edit Department, ${profile.department || 'Not added'}`}
            activeOpacity={0.8} onPress={() => navigation.navigate('EditDepartment', { currentDepartment: profile.department })}
            style={s.academicRow}>
            <CampusFieldIcon name={CAMPUS_ICONS.department} size={17} color="#D8C8B5" />
            <View style={s.flex}><Text style={s.infoLabel}>Department</Text><Text style={s.infoValue}>{profile.department || 'Add your department'}</Text></View>
            <Ionicons name="chevron-forward" size={16} color={PROFILE_TEXT_SUBTLE} />
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Edit studies, ${studiesSummary(profile) || 'Not added'}`}
            activeOpacity={0.8} onPress={() => openEditor('EditStudies')} style={s.academicRow}>
            <CampusFieldIcon name={CAMPUS_ICONS.degree} size={17} color="#D8C8B5" />
            <View style={s.flex}><Text style={s.infoLabel}>Studies</Text><Text style={s.infoValue}>{studiesSummary(profile) || 'Add your studies'}</Text></View>
            <Ionicons name="chevron-forward" size={16} color={PROFILE_TEXT_SUBTLE} />
          </TouchableOpacity>
          {schoolRows.length > 0 && <View style={s.campusGrid}>{schoolRows.map(row => <CampusFact key={row.label} {...row} />)}</View>}
          {!profile.college && !course && !schoolRows.length && <Empty icon={CAMPUS_ICONS.college} title="Add your college details" body="Show your course, campus, and graduation year." onPress={editCampus} />}
        </Section>

        <Section title="Profile visibility" icon="eye-outline" accent="#BCE5D0" onEdit={() => openEditor('EditProfile', 'visibility')}>
          <View style={s.visibilityGroup}>
          <VisibilityRow label="Gender" icon={ABOUT_ME_ICONS.gender} shown={profile.showGender} onPress={() => openEditor('EditGender')} />
          <VisibilityRow label="Orientation" icon={ABOUT_ME_ICONS.orientation} shown={profile.showOrientation} onPress={() => openEditor('EditOrientation')} last />
          </View>
        </Section>
      </ScrollView>

      <Modal visible={Boolean(image)} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setImage(null)}><View style={s.viewer}><TouchableOpacity accessibilityLabel="Close image" activeOpacity={0.88} onPress={() => setImage(null)} style={s.close}><Ionicons name="close" size={27} color="#fff" /></TouchableOpacity><Image source={{ uri: image || '' }} style={[s.fullImage, { width }]} resizeMode="contain" /></View></Modal>
    </SafeAreaView>
  );
};

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#100F0D' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16 },
  flex: { flex: 1, minWidth: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#100F0D' },
  error: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: PROFILE_TEXT_SECONDARY },
  retry: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 22, backgroundColor: PROFILE_CARD_SURFACE },
  retryText: { fontFamily: 'DMSans_700Bold', color: PROFILE_ACCENT },
  top: { minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  screenTitle: { fontFamily: 'DMSans_700Bold', fontSize: 26, color: '#FFF4F6', letterSpacing: -0.5 },
  settings: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: PROFILE_CARD_SURFACE },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 8, marginBottom: 16 },
  heroCopy: { flex: 1, minWidth: 0 },
  avatarWrap: { width: 86, height: 86, borderRadius: 43, alignItems: 'center', justifyContent: 'center' },
  avatarRing: { width: 86, height: 86, borderRadius: 43, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  avatarRingInset: { width: 82, height: 82, borderRadius: 41, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 76, height: 76, borderRadius: 38, overflow: 'hidden', backgroundColor: PROFILE_CARD_SURFACE },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', right: -3, bottom: 0, padding: 2, alignItems: 'center', justifyContent: 'center' },
  greyBadge: {right: -8},
  name: { fontFamily: 'DMSans_700Bold', fontSize: 23, lineHeight: 29, color: '#FFF4F6', letterSpacing: -0.5 },
  meta: { marginTop: 4, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, color: PROFILE_TEXT_SECONDARY },
  actions: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  primary: { flex: 1, minHeight: 44, borderRadius: 24, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: PROFILE_ACCENT, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  primaryText: { fontFamily: 'DMSans_700Bold', fontSize: 13, lineHeight: 18, color: '#331C23', flexShrink: 1 },
  secondary: { flex: 1, minHeight: 44, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: PROFILE_CARD_SURFACE, borderWidth: 1, borderColor: '#875866' },
  secondaryText: { fontFamily: 'DMSans_700Bold', fontSize: 13, lineHeight: 18, color: PROFILE_ACCENT, flexShrink: 1 },
  section: { marginBottom: 12 },
  sectionBox: { padding: 12, borderRadius: 16, backgroundColor: PROFILE_CARD_SURFACE },
  sectionHead: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 },
  titleRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionIcon: { width: 20, height: 24, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { flex: 1, fontFamily: 'DMSans_700Bold', fontSize: 15, lineHeight: 20, color: '#FFF4F6' },
  sectionCount: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: PROFILE_TEXT_SECONDARY },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoSlot: { borderRadius: 10, overflow: 'hidden', backgroundColor: '#30312F' },
  photoSlotImage: { width: '100%', height: '100%' },
  photoSlotEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5 },
  addPhotoText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: PROFILE_TEXT_SECONDARY },
  mainPhoto: { position: 'absolute', left: 5, bottom: 5, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: PROFILE_ACCENT },
  mainPhotoText: { fontFamily: 'DMSans_700Bold', fontSize: 10, color: '#331C23' },
  myPhotosEditBtn: { minWidth: 58, minHeight: 36, paddingHorizontal: 16, paddingVertical: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: '#FFFFFF' },
  myPhotosEditText: { fontFamily: 'DMSans_700Bold', fontSize: 12, color: '#231A20' },
  bioCopy: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 2 },
  bioQuote: { fontFamily: 'DMSans_700Bold', fontSize: 30, lineHeight: 30, color: '#C693A1' },
  bio: { flex: 1, paddingTop: 3, fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 21, color: '#F5F0EC' },
  intent: { marginTop: 14, borderRadius: 12, overflow: 'hidden' },
  intentFill: { paddingHorizontal: 12, paddingVertical: 10, minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10 },
  intentCopy: { flex: 1, minWidth: 0, zIndex: 1 },
  intentHearts: { position: 'absolute', top: 0, bottom: 0, right: 23, width: 76 },
  intentHeartLarge: { position: 'absolute', right: 0, top: -9, transform: [{ rotate: '-18deg' }] },
  intentHeartSmall: { position: 'absolute', left: 0, bottom: 1, transform: [{ rotate: '15deg' }] },
  smallLabel: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: '#E0B9C4' },
  intentValue: { marginTop: 3, fontFamily: 'DMSans_700Bold', fontSize: 14, lineHeight: 20, color: '#FFF3F6' },
  education: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingBottom: 4 },
  collegeIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#36332E', alignItems: 'center', justifyContent: 'center' },
  educationTitle: { fontFamily: 'DMSans_700Bold', fontSize: 14, lineHeight: 20, color: '#F7F5F1' },
  academicRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingVertical: 6 },
  campusGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 16, paddingTop: 14 },
  campusFact: { flexBasis: '45%', flexGrow: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  infoLabel: { fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 16, color: PROFILE_TEXT_SUBTLE },
  infoValue: { marginTop: 2, fontFamily: 'DMSans_500Medium', fontSize: 13, lineHeight: 18, color: '#F7F5F1' },
  interestGroups: { gap: 12 },
  interestGroupHeading: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  interestGroupLabel: { flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 12 },
  interestGroupCount: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: PROFILE_TEXT_SUBTLE },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { maxWidth: '100%', borderRadius: 8, overflow: 'hidden' },
  chipFill: { paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 17, color: PROFILE_ITEM_TEXT },
  interestToggle: { minHeight: 44, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#3B3D39', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  interestToggleText: { fontFamily: 'DMSans_700Bold', fontSize: 12, color: PROFILE_ACCENT },
  visibilityGroup: { paddingHorizontal: 0 },
  visibilityRow: { minHeight: 48, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#3B3D39' },
  visibilityLabel: { flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 14, color: '#FFF4F6' },
  visibilityStatus: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10, backgroundColor: '#26362E' },
  visibilityStatusText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: '#BCE5D0' },
  visibilityHidden: { backgroundColor: '#30312E' },
  visibilityHiddenText: { color: PROFILE_TEXT_SECONDARY },
  noBorder: { borderBottomWidth: 0 },
  empty: { minHeight: 72, flexDirection: 'row', alignItems: 'center' },
  emptyIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2B2D2A' },
  emptyCopy: { flex: 1, marginHorizontal: 10 },
  emptyTitle: { fontFamily: 'DMSans_700Bold', fontSize: 13, color: '#FFF4F6' },
  emptyBody: { marginTop: 3, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 17, color: PROFILE_TEXT_SECONDARY },
  addCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2B2D2A' },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.96)', alignItems: 'center', justifyContent: 'center' },
  fullImage: { height: '82%' },
  close: { position: 'absolute', top: 54, right: 18, zIndex: 2, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
});
