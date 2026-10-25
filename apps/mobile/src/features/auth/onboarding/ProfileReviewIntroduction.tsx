import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Image, ScrollView, StatusBar, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import {LinearGradient} from 'expo-linear-gradient';
import {INTEREST_CATEGORIES} from '@iem-dating/shared/interest-catalog';
import {completeOnboarding} from '../../../store/authSlice';
import {VerifiedBadge} from '../../discovery/components/VerifiedBadge';
import {useFaceStatus} from '../../verification/RealPerson';
import {useVerificationStatus} from '../../verification/useVerificationStatus';
import {LIFESTYLE_SECTIONS, PERSONALITY_SECTIONS} from '../../../core/profile/profileOptions';
import {useOnboarding} from './useOnboarding';
import {profilePhotoUrls} from './profileValues';
import {VideoPoster, useVideoPoster} from './VideoPoster';
import {ProfileVideoPreview} from './ProfileVideoPreview';
import {ProfilePhotoPreview} from './ProfilePhotoPreview';
import {rememberPreviewPhoto} from './photoPreviewCache';
import {interestEmojis, interestGradient} from './InterestVisuals';
import {TapChoice, connectionColors as c} from './ConnectionDesign';
import {loadCollegeOptions} from './collegeOptions';
import {startDiscoveryArrival} from '../../discovery/discoveryArrival';

const interestLabels = new Map(INTEREST_CATEGORIES.flatMap(group => group.interests.map(item => [item.id, item.label] as const)));
const readable = (value: unknown): string => typeof value === 'string' ? value.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase()) : typeof value === 'number' ? String(value) : '';
const list = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item) : [];
function answers(sections: readonly {id: string; options: readonly {id: string; label: string}[]}[], values: Record<string, string> = {}) {
  return sections.map(section => section.options.find(option => option.id === values[section.id])?.label ?? readable(values[section.id])).filter(Boolean).join(' · ');
}
type Row = {label: string; value: string; screen: string};
type Edit = (screen: string) => void;
function Pencil({label, onPress}: {label: string; onPress: () => void}) {
  return <TapChoice accessibilityRole="button" accessibilityLabel={`Edit ${label}`} hitSlop={6} onPress={onPress} style={({pressed}) => [s.editButton, pressed && s.pressed]}><Ionicons name="create-outline" size={16} color={c.primary}/><Text style={s.editText}>Edit</Text></TapChoice>;
}
function EditRow({label, value, screen, edit, last = false}: Row & {edit: Edit; last?: boolean}) {
  return <TapChoice accessibilityRole="button" accessibilityLabel={`Edit ${label}: ${value || 'Not added'}`} onPress={() => edit(screen)} style={({pressed}) => [s.editRow, last && s.lastRow, pressed && s.pressed]}>
    <View style={s.flex}><Text style={s.label}>{label}</Text><Text style={s.body}>{value || 'Add an answer'}</Text></View><View pointerEvents="none" style={s.editButton}><Ionicons name="create-outline" size={16} color={c.primary}/><Text style={s.editText}>Edit</Text></View>
  </TapChoice>;
}
const DetailSection = memo(function DetailSection({title, summary, rows, edit}: {title: string; summary: string; rows: Row[]; edit: Edit}) {
  const [open, setOpen] = useState(false);
  return <View style={s.sectionCard}><TapChoice accessibilityRole="button" accessibilityState={{expanded: open}} onPress={() => setOpen(!open)} style={({pressed}) => [s.accordion, pressed && s.pressed]}><View style={s.flex}><Text style={s.sectionTitle}>{title}</Text><Text numberOfLines={1} style={s.small}>{summary}</Text></View><Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={c.primary}/></TapChoice>{open && rows.map((row, index) => <EditRow key={row.label} {...row} last={index === rows.length - 1} edit={edit}/>)}</View>;
});
const Interests = memo(function Interests({interests, clubs, edit}: {interests: string[]; clubs: string[]; edit: Edit}) {
  const [all, setAll] = useState(false);
  const tags = [...interests.map(id => ({id, key: `interest-${id}`, label: interestLabels.get(id) ?? readable(id)})), ...clubs.map(id => ({id, key: `club-${id}`, label: readable(id)}))];
  return <View style={s.sectionCard}><View style={s.sectionHeader}><Text style={s.sectionTitle}>Interests & clubs <Text style={s.small}>{tags.length || ''}</Text></Text><Pencil label="interests and clubs" onPress={() => edit('Interests')}/></View>
    <View style={s.tags}>{(all ? tags : tags.slice(0, 6)).map(tag => <View key={tag.key} style={s.tag}><LinearGradient colors={interestGradient(tag.id)} start={{x: 0, y: 0}} end={{x: 1, y: 1}} style={StyleSheet.absoluteFill}/><Text style={s.emoji}>{interestEmojis[tag.id] ?? '✨'}</Text><Text style={s.tagText}>{tag.label}</Text></View>)}</View>
    {!tags.length && <Text style={s.body}>Add a few things you enjoy.</Text>}
    {tags.length > 6 && <TapChoice accessibilityRole="button" onPress={() => setAll(!all)} style={s.viewAll}><Text style={s.link}>{all ? 'Show less' : `View all ${tags.length}`}</Text><Ionicons name={all ? 'chevron-up' : 'chevron-down'} size={13} color={c.primary}/></TapChoice>}
  </View>;
});
const Media = memo(function Media({photos, video, name, age, verified, edit}: {photos: string[]; video?: string; name: string; age?: number; verified: boolean; edit: Edit}) {
  const [width, setWidth] = useState(0); const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false); const [opened, setOpened] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<number | null>(null);
  const {height} = useWindowDimensions(); const mediaHeight = Math.min(205, Math.max(170, height * .235));
  useFocusEffect(useCallback(() => () => {setPlaying(false); setPhotoPreview(null);}, []));
  return <View style={s.mediaCard}>
    <View style={s.mediaToolbar}><Text style={s.sectionTitle}>Photos & video</Text><Pencil label="photos and video" onPress={() => edit('PhotoUpload')}/></View>
    <View style={[s.mediaRow, {height: mediaHeight}]}>
      <View style={s.photoTile} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
        {photos.length && width ? <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={e => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}>{photos.map((uri, i) => <TapChoice key={`${uri}-${i}`} accessibilityRole="button" accessibilityLabel={`View photo ${i+1} full screen`} onPress={() => setPhotoPreview(i)} style={{width, height: mediaHeight}}><Image source={{uri}} style={[StyleSheet.absoluteFill, {opacity: .35}]} resizeMode="cover" blurRadius={16} fadeDuration={0}/><Image source={{uri}} onLoad={event => rememberPreviewPhoto(uri, event.nativeEvent.source)} style={{width, height: mediaHeight}} resizeMode="contain" fadeDuration={0}/></TapChoice>)}</ScrollView> : <TapChoice onPress={() => edit('PhotoUpload')} style={s.mediaEmpty}><Ionicons name="camera-outline" size={28} color={c.primary}/><Text style={s.emptyLabel}>Add photo</Text></TapChoice>}
        {!!photos.length && <View pointerEvents="none" style={s.tileCaption}><LinearGradient colors={['#35233500', '#352335C9']} style={StyleSheet.absoluteFill}/><Text style={s.tileLabel}>Photos <Text style={s.tileCount}>{Math.min(index + 1, photos.length)}/{photos.length}</Text></Text><Ionicons name="expand-outline" size={16} color="#FFF"/></View>}
      </View>
      <View style={s.videoTile}>{video ? <VideoTile uri={video} onPlay={() => {setOpened(true); setPlaying(true);}}/> : <TapChoice onPress={() => edit('PhotoUpload')} style={s.mediaEmpty}><Ionicons name="videocam-outline" size={28} color={c.primary}/><Text style={s.emptyLabel}>Add video</Text></TapChoice>}</View>
    </View>
    <View style={s.identity}><View style={s.identityName}><TapChoice accessibilityRole="button" accessibilityLabel="Edit name" onPress={() => edit('NameSelection')} style={s.nameTouch}><Text style={s.name} numberOfLines={1}>{name || 'Your name'}</Text></TapChoice>{!!age && <TapChoice accessibilityRole="button" accessibilityLabel="Edit birthday" onPress={() => edit('BirthdaySelection')} style={s.ageTouch}><Text style={s.name}>, {age}</Text></TapChoice>}{verified && <View style={s.badge}><VerifiedBadge size={20}/></View>}</View><Pencil label="name" onPress={() => edit('NameSelection')}/></View>
    {opened && !!video && <ProfileVideoPreview key={video} uri={video} visible={playing} onClose={() => setPlaying(false)}/>}
    {photoPreview !== null && <ProfilePhotoPreview photos={photos} index={photoPreview} onIndex={setPhotoPreview} onClose={() => setPhotoPreview(null)}/>}
  </View>;
});
function VideoTile({uri, onPlay}: {uri: string; onPlay: () => void}) {
  const poster = useVideoPoster(uri);
  return <TapChoice accessibilityRole="button" accessibilityLabel="Play your introduction video" onPress={onPlay} style={s.mediaEmpty}>
    <VideoPoster uri={poster?.uri ?? ''} fit="contain"/><View style={s.playCircle}><Ionicons name="play" size={23} color="#FFF" style={{marginLeft:2}}/></View><View pointerEvents="none" style={s.tileCaption}><LinearGradient colors={['#35233500', '#352335C9']} style={StyleSheet.absoluteFill}/><Text style={s.tileLabel}>Introduction</Text>{!!poster?.duration && <Text style={s.tileCount}>{Math.floor(poster.duration)}s</Text>}</View>
  </TapChoice>;
}
export function ProfileReviewIntroduction() {
  const o = useOnboarding(); const user = o.auth.user ?? {}; const insets = useSafeAreaInsets();
  const {face} = useFaceStatus(); const verification = useVerificationStatus(); const opening = useRef(false);
  useEffect(() => {void loadCollegeOptions().catch(() => {});}, []);
  useFocusEffect(useCallback(() => {
    opening.current = false;
  }, [o.navigation]));
  const edit = useCallback((screen: string) => {
    if (opening.current) return;
    opening.current = true;
    o.navigation.navigate(screen, {reviewEdit: true});
  }, [o.navigation]);
  const photos = useMemo(() => profilePhotoUrls(user.photos), [user.photos]);
  const pref = user.preferences ?? {};
  const interests = useMemo(() => list(pref.interests), [pref.interests]); const clubs = useMemo(() => list(user.clubs), [user.clubs]);
  const details: Row[] = useMemo(() => [
    {label: 'Birthday', value: user.age ? `${user.age} years` : '', screen: 'BirthdaySelection'},
    {label: 'Gender', value: [readable(user.gender), user.showGender === false ? 'Hidden on profile' : ''].filter(Boolean).join(' · '), screen: 'GenderSelection'},
    {label: 'Orientation', value: [list(user.orientation).map(readable).join(', '), user.orientation?.length && user.showOrientation === false ? 'Hidden on profile' : ''].filter(Boolean).join(' · '), screen: 'OrientationSelection'},
    {label: 'Lifestyle', value: answers(LIFESTYLE_SECTIONS, pref.lifestyle), screen: 'LifestyleHabits'},
    {label: 'Connection style', value: answers(PERSONALITY_SECTIONS, pref.personality), screen: 'PersonalityTraits'},
    {label: 'Life at college', value: [readable(user.attendanceMood), list(user.hangoutSpots).join(', ')].filter(Boolean).join(' · '), screen: 'SocialSelection'},
  ], [user.age, user.gender, user.showGender, user.orientation, user.showOrientation, pref.lifestyle, pref.personality, user.attendanceMood, user.hangoutSpots]);
  const preferences: Row[] = useMemo(() => [{label: 'Looking for', value: readable(user.seeking), screen: 'SeekingSelection'}, {label: 'Who and where you meet', value: user.preferencesConfirmedAt ? 'Review your saved preferences' : 'Set matching preferences', screen: 'MatchingPreferences'}], [user.seeking, user.preferencesConfirmedAt]);
  const missing = [!photos.length && {label: 'Add your main photo', screen: 'PhotoUpload'}, !user.profileVideoUrl && {label: 'Add your profile video', screen: 'PhotoUpload'}, (!user.department || !user.graduationYear) && {label: 'Complete your studies', screen: 'AcademicSelection'}, !user.preferencesConfirmedAt && {label: 'Set matching preferences', screen: 'MatchingPreferences'}].filter((item): item is {label: string; screen: string} => !!item);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [verificationOpen, setVerificationOpen] = useState(false);
  const faceLabel = face?.status === 'verified' ? 'Verified' : face?.status === 'pending_review' ? 'Under review' : face?.status === 'none' ? 'Not completed' : face?.status === 'needs_fix' ? 'Update your profile media' : face?.status === 'failed' ? 'Try again' : face?.status === 'removed' ? 'Check required' : 'Checking status…';
  return <View style={[s.page, {paddingTop: insets.top}]}><StatusBar barStyle="dark-content" backgroundColor={c.canvas}/>
    <View style={s.nav}><TapChoice accessibilityRole="button" accessibilityLabel="Back" onPress={o.back} style={s.back}><Ionicons name="arrow-back" size={21} color={c.text}/></TapChoice><View accessibilityLabel="Final onboarding step" style={s.progress}>{[0,1,2,3].map(i => <View key={i} style={s.segment}/>)}</View><View style={{width:44}}/></View>
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={s.heading}><Text accessibilityRole="header" style={s.title}>Take a look. This is you.</Text><Text style={s.small}>Check your profile before you start.</Text></View>
      <Media photos={photos} video={user.profileVideoUrl} name={user.name} age={user.age} verified={!!verification?.verified && face?.status === 'verified'} edit={edit}/>
      <View style={s.sectionCard}><View style={s.collegeHeading}><Text accessibilityRole="header" style={s.sectionTitle}>College, campus & studies</Text></View><EditRow label="College & campus" value={[user.college, user.campus].filter(Boolean).join(' · ')} screen="CollegeSelection" edit={edit}/><EditRow last label="Studies" value={[user.degree, user.department, user.graduationYear].filter(Boolean).join(' · ')} screen="AcademicSelection" edit={edit}/></View>
      <Interests interests={interests} clubs={clubs} edit={edit}/>
      <View style={s.sectionCard}><View style={s.sectionHeader}><Text style={s.sectionTitle}>About me</Text><Pencil label="about me" onPress={() => edit('ShareMore')}/></View><Text numberOfLines={bioExpanded ? undefined : 2} style={s.body}>{pref.bio || 'Add a little about yourself.'}</Text>{pref.bio?.length > 90 && <TapChoice accessibilityRole="button" onPress={() => setBioExpanded(!bioExpanded)} style={s.viewAll}><Text style={s.link}>{bioExpanded ? 'Show less' : 'Read more'}</Text></TapChoice>}</View>
      <DetailSection title="More about you" summary="Gender, orientation, lifestyle & college life" rows={details} edit={edit}/>
      <DetailSection title="Matching preferences" summary={readable(user.seeking) || 'Who and where you want to meet'} rows={preferences} edit={edit}/>
      <View style={s.sectionCard}><TapChoice accessibilityRole="button" accessibilityState={{expanded:verificationOpen}} onPress={() => setVerificationOpen(!verificationOpen)} style={s.accordion}><Ionicons name="shield-checkmark-outline" size={21} color={c.primary}/><View style={s.flex}><Text style={s.sectionTitle}>Verification</Text><Text style={s.small}>{verification?.verified ? 'College verified' : 'College email'} · Face: {faceLabel}</Text></View><Ionicons name={verificationOpen?'chevron-up':'chevron-down'} size={17} color={c.primary}/></TapChoice>{verificationOpen && <><View style={s.statusRow}>{verification?.verified && <Ionicons name="checkmark-circle" size={19} color="#40778A"/>}<Text style={s.body}>Step 1 · College email: {verification ? verification.verified ? 'Verified' : 'Not verified' : 'Checking status…'}</Text></View><TapChoice accessibilityRole="button" onPress={() => o.navigation.navigate('RealPersonCheck', {onboarding:true,returnToReview:true})} style={s.editRow}><View style={s.flex}><Text style={s.body}>Step 2 · Face check: {faceLabel}</Text><Text style={s.small}>Both steps give you the blue badge · Your selfie is never shown</Text></View><Ionicons name="chevron-forward" size={18} color={c.primary}/></TapChoice></>}</View>
      {!!missing.length && <View style={s.missing}><Text style={s.sectionTitle}>Before you start</Text>{missing.map(item => <TapChoice key={item.label} accessibilityRole="button" onPress={() => edit(item.screen)} style={s.missingRow}><Text style={[s.link,s.flex]}>{item.label}</Text><Ionicons name="arrow-forward" size={17} color={c.primary}/></TapChoice>)}</View>}
    </ScrollView>
    <View style={[s.footer,{paddingBottom:Math.max(insets.bottom,12)}]}><TapChoice accessibilityRole="button" accessibilityState={{disabled:!!missing.length}} disabled={!!missing.length} onPress={() => {if (!missing.length) {startDiscoveryArrival(); o.dispatch(completeOnboarding());}}} style={({pressed}) => [s.next, !!missing.length && {opacity:.4}, pressed && s.pressed]}><Text style={s.nextText}>Start discovering</Text><Ionicons name="arrow-forward" size={19} color="#FFF"/></TapChoice></View>
  </View>;
}
const s = StyleSheet.create({
  page:{flex:1,backgroundColor:c.canvas},flex:{flex:1},pressed:{opacity:.55},nav:{paddingHorizontal:22,paddingVertical:6,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},back:{width:44,height:44,borderRadius:22,backgroundColor:'#FFF',alignItems:'center',justifyContent:'center'},progress:{flexDirection:'row',gap:4},segment:{width:22,height:3,borderRadius:2,backgroundColor:c.primary},
  content:{paddingHorizontal:20,paddingBottom:12,gap:6,width:'100%',maxWidth:520,alignSelf:'center'},heading:{paddingTop:6,paddingBottom:5},title:{fontFamily:'CormorantGaramond_600SemiBold',fontSize:31,lineHeight:38,paddingBottom:3,color:c.text,includeFontPadding:true},small:{fontFamily:'DMSans_400Regular',fontSize:13,lineHeight:19,color:c.muted},label:{fontFamily:'DMSans_400Regular',fontSize:13,lineHeight:19,color:c.muted},body:{fontFamily:'DMSans_400Regular',fontSize:15,lineHeight:22,color:c.text},sectionTitle:{fontFamily:'DMSans_700Bold',fontSize:16,lineHeight:23,color:c.text},link:{fontFamily:'DMSans_500Medium',fontSize:14,lineHeight:20,color:c.primary},
  mediaCard:{backgroundColor:'#FFF',borderRadius:20,paddingHorizontal:10,paddingBottom:10},
  mediaToolbar:{paddingVertical:7,paddingLeft:2,flexDirection:'row',alignItems:'center',justifyContent:'space-between',minHeight:46},
  mediaRow:{flexDirection:'row',gap:8},
  photoTile:{flex:1.08,borderRadius:14,overflow:'hidden',backgroundColor:'#EADFE3'},
  videoTile:{flex:1,borderRadius:14,overflow:'hidden',backgroundColor:c.wash},
  mediaEmpty:{flex:1,alignItems:'center',justifyContent:'center',gap:8,backgroundColor:c.wash},
  emptyLabel:{fontFamily:'DMSans_500Medium',fontSize:14,color:c.primary},
  tileCaption:{position:'absolute',left:0,right:0,bottom:0,flexDirection:'row',alignItems:'flex-end',justifyContent:'space-between',gap:5,paddingHorizontal:10,paddingTop:22,paddingBottom:14},
  tileLabel:{fontFamily:'DMSans_700Bold',fontSize:14,lineHeight:21,color:'#FFF',flexShrink:1},
  tileCount:{fontFamily:'DMSans_500Medium',fontSize:12,lineHeight:21,color:'#FFF'},
  identity:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8,paddingLeft:2,paddingTop:4,minHeight:50},
  identityName:{flex:1,flexDirection:'row',alignItems:'center'},
  nameTouch:{flexShrink:1,minHeight:44,justifyContent:'center'},ageTouch:{minHeight:44,justifyContent:'center'},
  name:{fontFamily:'DMSans_700Bold',fontSize:20,lineHeight:28,color:c.text},badge:{marginLeft:6},
  editButton:{height:32,paddingHorizontal:9,borderRadius:16,backgroundColor:'#F4E9EE',flexDirection:'row',alignItems:'center',justifyContent:'center',gap:4},
  editText:{fontFamily:'DMSans_500Medium',fontSize:13,lineHeight:19,color:c.primary},
  sectionCard:{paddingHorizontal:14,paddingTop:10,paddingBottom:14,borderRadius:17,backgroundColor:'#FFF'},
  sectionHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',minHeight:38,paddingBottom:6,gap:8},
  collegeHeading:{paddingBottom:2},
  editRow:{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:8,minHeight:48,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#EEE8EB'},
  lastRow:{borderBottomWidth:0},
  accordion:{flexDirection:'row',alignItems:'center',gap:10,minHeight:48,paddingVertical:3},
  tags:{flexDirection:'row',flexWrap:'wrap',gap:6,paddingBottom:2},tag:{flexDirection:'row',alignItems:'center',gap:5,borderRadius:20,overflow:'hidden',paddingHorizontal:10,minHeight:36,paddingVertical:6,maxWidth:'100%'},tagText:{fontFamily:'DMSans_500Medium',fontSize:13,lineHeight:20,color:c.text,flexShrink:1},emoji:{fontSize:16,lineHeight:22},viewAll:{alignSelf:'flex-start',flexDirection:'row',alignItems:'center',gap:5,minHeight:36},statusRow:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:7},missing:{borderRadius:17,paddingHorizontal:14,paddingTop:10,paddingBottom:14,backgroundColor:c.wash},missingRow:{minHeight:44,flexDirection:'row',alignItems:'center',gap:10},footer:{paddingTop:8,paddingHorizontal:22,borderTopWidth:StyleSheet.hairlineWidth,borderColor:'#E4DCDF',backgroundColor:c.canvas},next:{minHeight:49,borderRadius:25,backgroundColor:c.primary,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10},nextText:{fontFamily:'DMSans_700Bold',fontSize:15,color:'#FFF'},playCircle:{width:44,height:44,borderRadius:22,backgroundColor:'#712C48D9',alignItems:'center',justifyContent:'center'}
});
