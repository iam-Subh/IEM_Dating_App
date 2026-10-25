import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Alert, BackHandler, Image, Keyboard, Modal, Pressable, ScrollView, StatusBar, StyleSheet, Text, View} from 'react-native';
import {NavigationContext, NavigationRouteContext, useNavigation} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import {previewInstitutions, previewUser} from './onboardingPreviewRuntime';
import {VerificationPreviewContext} from '../features/verification/VerificationPreviewContext';
import {VerifyRulesScreen, type VerifyReason} from '../features/verification/VerifyRulesScreen';
import {StoryShareVerifyLine, UnverifiedNudge} from '../features/verification/VerifyNudge';
import {BlueBadgeRow, FaceMediaNote, type FaceStatus} from '../features/verification/RealPerson';
import {ChatVerificationReminder, ChatVerificationWaiting} from '../features/verification/ChatVerificationReminder';
import {DeckReminderCard, DeckVerifyBanner, type DeckCardKind} from '../features/verification/DeckVerifyBanner';
import {ReminderRow, reminderColors} from '../features/verification/ReminderParts';
import {ReminderArt} from '../features/verification/ReminderArt';
import type {VerificationStatus} from '../features/verification/useVerificationStatus';
import {StudentVerificationEntry} from '../features/auth/onboarding/StudentVerificationEntry';
import {FaceCheckIntroduction} from '../features/verification/FaceCheckIntroduction';
import {FaceCheckResult} from '../features/verification/FaceCheckResult';
import {VerifiedBadge} from '../features/discovery/components/VerifiedBadge';
import {PhotoReorderGrid} from '../screens/main/profile/PhotoReorderGrid';
import {ReminderConcepts, type ReminderConcept} from './ReminderConcepts';
import {MatchSheet} from '../features/discovery/components/MatchSheet';

/**
 * Reminders demo (REMINDER_DESIGN.md): every verify reminder, Next by Next,
 * drawn by the app's own components inside a sketch of the screen it lives
 * on. Sample data only - nothing is sent and the account does not change.
 */

const portrait = Image.resolveAssetSource(require('../../assets/illustrations/face-front-3d-mobile.png')).uri;
const man = Image.resolveAssetSource(require('../../assets/illustrations/face-man-3d-mobile.png')).uri;

const x = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#100F0D'},
  screen: {flex: 1, backgroundColor: '#100F0D'},
  header: {height: 54, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  headerTitle: {fontFamily: 'DMSans_700Bold', fontSize: 21, color: '#F6F4F6'},
  stories: {flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingBottom: 6},
  story: {width: 54, height: 54, borderRadius: 27, borderWidth: 2, borderColor: '#F3C1CA', backgroundColor: '#2A2528'},
  deck: {flex: 1, marginTop: 8, marginBottom: 96},
  card: {position: 'absolute', top: 0, left: 10, right: 10, bottom: 0, borderRadius: 24, overflow: 'hidden', backgroundColor: '#2A2528'},
  cardCaption: {position: 'absolute', left: 0, right: 0, bottom: 0, padding: 18, backgroundColor: 'rgba(16,15,13,0.6)'},
  cardName: {fontFamily: 'DMSans_700Bold', fontSize: 22, color: '#F6F4F6'},
  actions: {position: 'absolute', bottom: 20, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 28},
  round: {width: 60, height: 60, borderRadius: 30, backgroundColor: '#2A2528', alignItems: 'center', justifyContent: 'center'},
  like: {backgroundColor: '#FF5A5F'},
  person: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10},
  avatar: {width: 48, height: 48, borderRadius: 24, backgroundColor: '#2A2528'},
  nameRow: {flexDirection: 'row', alignItems: 'center', gap: 5},
  name: {fontFamily: 'DMSans_700Bold', fontSize: 15, color: '#F6F4F6'},
  line: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 18, color: '#9A949C'},
  chatHeader: {height: 58, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12},
  chatAvatar: {width: 36, height: 36, borderRadius: 18},
  messages: {flex: 1, justifyContent: 'flex-end', padding: 14, gap: 8},
  in: {alignSelf: 'flex-start', backgroundColor: '#2A2729', borderRadius: 18, borderBottomLeftRadius: 4, paddingHorizontal: 14, paddingVertical: 9, maxWidth: '80%'},
  out: {alignSelf: 'flex-end', backgroundColor: '#5A2F3E', borderRadius: 18, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 9, maxWidth: '80%'},
  bubbleText: {fontFamily: 'DMSans_400Regular', fontSize: 15, color: '#F6F4F6'},
  composer: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingTop: 4, paddingBottom: 10},
  field: {flex: 1, minHeight: 48, borderRadius: 24, backgroundColor: '#1D1B1E', justifyContent: 'center', paddingHorizontal: 18},
  send: {width: 48, height: 48, borderRadius: 24, backgroundColor: '#F3C1CA', alignItems: 'center', justifyContent: 'center'},
  shade: {flex: 1, backgroundColor: '#0B0B0D', padding: 16, paddingTop: 30},
  clock: {fontFamily: 'DMSans_500Medium', fontSize: 48, color: '#F6F4F6', textAlign: 'center', marginBottom: 24},
  notification: {backgroundColor: '#24222A', borderRadius: 24, padding: 16},
  notificationTop: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8},
  appIcon: {width: 20, height: 20, borderRadius: 10, backgroundColor: '#F3C1CA', alignItems: 'center', justifyContent: 'center'},
  notificationApp: {fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#B8B2BC'},
  notificationTitle: {fontFamily: 'DMSans_700Bold', fontSize: 15, color: '#F6F4F6'},
  notificationBody: {fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 20, color: '#CFC9D2', marginTop: 2},
  notificationButton: {fontFamily: 'DMSans_700Bold', fontSize: 13, color: '#F3C1CA', marginTop: 14, letterSpacing: 0.6},
  caption: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 17, color: '#8E8A90', textAlign: 'center', marginTop: 16, paddingHorizontal: 20},
  videoRow: {flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 14, borderWidth: 1.5, borderColor: '#FF9AA2'},
  section: {fontFamily: 'DMSans_700Bold', fontSize: 16, color: '#F6F4F6'},
  map: {height: 380, borderRadius: 20, backgroundColor: '#1A1D19', marginTop: 8},
  setting: {fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#F6F4F6', paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)'},
  previewPhoto: {width: '100%', height: 420, borderRadius: 24, marginTop: 8},
  storyScreen: {flex: 1, borderRadius: 18, overflow: 'hidden', margin: 8},
  shareRow: {position: 'absolute', bottom: 20, left: 16, right: 16, flexDirection: 'row', gap: 10},
  shareButton: {flex: 1, height: 48, borderRadius: 24, backgroundColor: '#F6F4F6', alignItems: 'center', justifyContent: 'center'},
  shareText: {fontFamily: 'DMSans_700Bold', fontSize: 14, color: '#141215'},
  profileHero: {alignItems: 'center', gap: 4, marginTop: 24},
  profilePhoto: {width: 120, height: 120, borderRadius: 60, marginBottom: 8},
  center: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center'},
  demoButton: {backgroundColor: '#F3C1CA', borderRadius: 24, paddingHorizontal: 22, height: 48, justifyContent: 'center'},
  demoButtonText: {fontFamily: 'DMSans_700Bold', fontSize: 14, color: '#331C23'},
  closed: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8},
  closedTitle: {fontFamily: 'DMSans_700Bold', fontSize: 18, color: '#F6F4F6'},
  toolbar: {backgroundColor: '#1D1A1E', paddingHorizontal: 12, paddingTop: 6, gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)'},
  toolbarTop: {flexDirection: 'row', alignItems: 'center', gap: 8},
  toolIcon: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center'},
  small: {fontFamily: 'DMSans_500Medium', fontSize: 10, lineHeight: 15, color: '#AE96A7', letterSpacing: 0.4},
  label: {fontFamily: 'DMSans_500Medium', fontSize: 14, lineHeight: 19, color: '#F7EFF4'},
  when: {fontFamily: 'DMSans_400Regular', fontSize: 11.5, lineHeight: 16, color: '#9A949C'},
  controls: {flexDirection: 'row', gap: 8},
  toolButton: {flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, backgroundColor: '#2C282D'},
  next: {backgroundColor: '#F3C1CA'},
  nextText: {fontFamily: 'DMSans_700Bold', fontSize: 14, color: '#331C23'},
  menuShade: {flex: 1, backgroundColor: '#000B', justifyContent: 'center', paddingHorizontal: 16},
  menu: {maxHeight: '100%', padding: 14, borderRadius: 24, backgroundColor: '#1D1A1E'},
  menuGroup: {fontFamily: 'DMSans_700Bold', fontSize: 10.5, letterSpacing: 0.8, color: '#AE96A7', marginTop: 14, marginBottom: 4, marginLeft: 6},
  menuItem: {flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12},
  selected: {backgroundColor: '#3A2D35'},
  number: {color: '#F3C1CA', fontFamily: 'DMSans_700Bold', width: 24, fontSize: 12},
});

type Fixture = {status: VerificationStatus; face: FaceStatus};
const baseStatus: VerificationStatus = {
  verified: false, expired: false, limited: true, likesLeft: 25, dailyLikeLimit: 25, chatLeft: 30, chatLimit: 30,
  roseTrialAvailable: false, paused: false, graceEndsAt: null, graceDaysLeft: 8, expiresAt: null, daysUntilExpiry: null,
  signedUpWithGoogle: true, campusName: 'Gurukul', realPersonVerified: false, realPersonRequired: true, owesRealPerson: true, collegeShortName: 'IEM',
};
const baseFace: FaceStatus = {status: 'none', reason: null, required: true, attemptsLeft: 3, media: []};
const verifiedStatus: Partial<VerificationStatus> = {verified: true, limited: false, likesLeft: null, chatLeft: null};

type Step = {
  group: string; title: string; where: string; when: string;
  status?: Partial<VerificationStatus>; face?: Partial<FaceStatus>;
  render: (ctx: {close: () => void}) => React.ReactNode;
};

// --- Sketches of the screens a reminder lives on --------------------------------

function Screen({title, children, right}: {title: string; children: React.ReactNode; right?: React.ReactNode}) {
  return <View style={x.screen}>
    <View style={x.header}><Text style={x.headerTitle}>{title}</Text>{right}</View>
    {children}
  </View>;
}

function Person({name, line, verified}: {name: string; line: string; verified?: boolean}) {
  return <View style={x.person}>
    <Image source={{uri: name.length % 2 ? portrait : man}} style={x.avatar}/>
    <View style={{flex: 1}}><View style={x.nameRow}><Text style={x.name}>{name}</Text>{verified && <VerifiedBadge size={16}/>}</View><Text style={x.line} numberOfLines={1}>{line}</Text></View>
  </View>;
}
const people = <><Person name="Aanya" line="Coffee after class?" verified/><Person name="Rohan" line="Sent a photo"/><Person name="Meera" line="See you at the fest!" verified/></>;

function Deck({children, banner}: {children?: React.ReactNode; banner?: React.ReactNode}) {
  return <Screen title="Explore" right={<Ionicons name="options-outline" size={22} color="#F5F5F5"/>}>
    <View style={x.stories}>{[0, 1, 2, 3, 4].map(i => <View key={i} style={x.story}/>)}</View>
    {banner}
    <View style={x.deck}>
      {children ?? <View style={x.card}><Image source={{uri: portrait}} style={StyleSheet.absoluteFill} resizeMode="cover"/>
        <View style={x.cardCaption}><Text style={x.cardName}>Aanya, 21</Text><Text style={x.line}>IEM · Gurukul</Text></View></View>}
    </View>
    {!children && <View style={x.actions}><View style={x.round}><Ionicons name="close" size={26} color="#fff"/></View><View style={[x.round, x.like]}><Ionicons name="heart" size={28} color="#fff"/></View></View>}
  </Screen>;
}

function Chat({children, composer = true, name = 'Aanya'}: {children?: React.ReactNode; composer?: boolean; name?: string}) {
  return <View style={x.screen}>
    <View style={x.chatHeader}><Ionicons name="chevron-back" size={24} color="#fff"/><Image source={{uri: portrait}} style={x.chatAvatar}/><Text style={x.headerTitle}>{name}</Text></View>
    <View style={x.messages}>
      <View style={x.in}><Text style={x.bubbleText}>Coffee after class?</Text></View>
      <View style={x.out}><Text style={x.bubbleText}>Yes! The place near campus?</Text></View>
      <View style={x.in}><Text style={x.bubbleText}>That’s the one ☕</Text></View>
    </View>
    {children}
    {composer && <View style={x.composer}><View style={x.field}><Text style={x.line}>Message</Text></View><View style={x.send}><Ionicons name="mic" size={20} color="#331C23"/></View></View>}
  </View>;
}

function Sheet({reason}: {reason: VerifyReason}) {
  return <View style={StyleSheet.absoluteFill}>
    <NavigationRouteContext.Provider value={{key: `rules-${reason}`, name: 'VerifyRules', params: {reason}}}><VerifyRulesScreen/></NavigationRouteContext.Provider>
  </View>;
}

function Notification({title, body, button = 'Verify now'}: {title: string; body: string; button?: string}) {
  return <View style={x.shade}>
    <Text style={x.clock}>9:41</Text>
    <View style={x.notification}>
      <View style={x.notificationTop}><View style={x.appIcon}><Ionicons name="heart" size={12} color="#331C23"/></View><Text style={x.notificationApp}>IEM Connect · Verification · now</Text></View>
      <Text style={x.notificationTitle}>{title}</Text>
      <Text style={x.notificationBody}>{body}</Text>
      <Text style={x.notificationButton}>{button.toUpperCase()}</Text>
    </View>
    <Text style={x.caption}>Android draws the final notification. Tapping it, or the button, opens the college email step.</Text>
  </View>;
}

function Photos({issues, video}: {issues: Record<string, 'mismatch' | 'no_face' | 'unsure'>; video?: boolean}) {
  const scrollRef = useRef<any>(null);
  const [photos, setPhotos] = useState<{id: string; photoUrl: string}[]>([{id: 'a', photoUrl: portrait}, {id: 'b', photoUrl: man}, {id: 'c', photoUrl: portrait + '#3'}]);
  return <Screen title="Edit profile">
    <ScrollView ref={scrollRef} contentContainerStyle={{padding: 16, gap: 10}}>
      {video && <View style={x.videoRow}><Ionicons name="videocam" size={18} color={reminderColors.danger}/><Text style={x.line}>Your profile video</Text></View>}
      <Text style={x.section}>Your photos</Text>
      <FaceMediaNote/>
      <PhotoReorderGrid embedded photos={photos} onPhotosChange={next => setPhotos(next as {id: string; photoUrl: string}[])} issues={issues} scrollRef={scrollRef}
        onAddPress={() => {}} onScrollLock={() => {}} onCropProfile={() => {}}
        onReplacePress={() => Alert.alert('Replace photo', 'In the app, this opens your gallery to choose another photo.')}/>
    </ScrollView>
  </Screen>;
}

function College({codePage, onBack}: {codePage?: boolean; onBack: () => void}) {
  const [college, setCollege] = useState('IEM-KOLKATA');
  const [email, setEmail] = useState(previewUser.email);
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState(!!codePage);
  const [error, setError] = useState('');
  return <StudentVerificationEntry institutions={previewInstitutions} institutionCode={college} onCollege={setCollege}
    email={email} onEmail={setEmail} code={code} onCode={setCode} hasChallenge={challenge} needsPassword={false}
    password="" onPassword={() => {}} loading={false} busy={false} resending={false} error={error} loadError="" timer={0}
    onRetry={() => {}} onBack={() => challenge && !codePage ? setChallenge(false) : onBack()}
    onSend={() => {Keyboard.dismiss(); setChallenge(true); setError('');}}
    onVerify={() => {
      if (code !== '123456') {setError('Demo code: 123456'); return;}
      Keyboard.dismiss(); Alert.alert('Demo complete', 'No email was sent. Your account has not changed.', [{text: 'OK', onPress: onBack}]);
    }} onResend={() => {setCode(''); setError('Demo code: 123456');}} onLater={onBack}/>;
}

function Selfie({onBack}: {onBack: () => void}) {
  const [done, setDone] = useState(false);
  return done ? <FaceCheckResult status="verified" onboarding={false} onContinue={onBack} rows={[
    {name: 'Main photo', url: portrait, kind: 'photo', text: 'Matches you', ok: true},
  ]}/> : <FaceCheckIntroduction onboarding={false} onBack={onBack} onStart={async () => {setDone(true);}}/>;
}

// --- The steps --------------------------------------------------------------

const sheet = (reason: VerifyReason, title: string, where: string, when: string, status?: Partial<VerificationStatus>): Step => ({
  group: 'Limit sheets', title, where, when, status,
  render: () => <><Deck/><Sheet reason={reason}/></>,
});
const deckCard = (kind: DeckCardKind, title: string, when: string, status: Partial<VerificationStatus>): Step => ({
  group: 'Discovery deck', title, where: 'Explore', when, status,
  render: ({close}) => <Deck><DeckReminderCard kind={kind} onKeepBrowsing={kind === 'likes' ? close : undefined}/></Deck>,
});
const deckBanner = (title: string, when: string, status: Partial<VerificationStatus>, props: {swipes?: number; topCardUnverified?: boolean} = {}): Step => ({
  group: 'Discovery deck', title, where: 'Explore', when, status,
  render: () => <Deck banner={<DeckVerifyBanner swipes={props.swipes ?? 0} topCardUnverified={props.topCardUnverified}/>}/>,
});
const listBanner = (title: string, where: string, when: string, banner: React.ReactNode, body: React.ReactNode = people): Step => ({
  group: 'Banners', title, where, when,
  render: () => <Screen title={where}>{banner}<View style={{paddingHorizontal: 16}}>{body}</View></Screen>,
});
const row = (title: string, when: string, status: Partial<VerificationStatus>, face?: Partial<FaceStatus>): Step => ({
  group: 'Profile row', title, where: 'Profile', when, status, face,
  render: () => <Screen title="Profile" right={<Ionicons name="settings-outline" size={22} color="#fff"/>}>
    <View style={{paddingHorizontal: 16}}><BlueBadgeRow flush/></View>
    <View style={x.profileHero}><Image source={{uri: portrait}} style={x.profilePhoto}/><Text style={x.cardName}>Aanya, 21</Text><Text style={x.line}>IEM · Gurukul</Text></View>
  </Screen>,
});
const push = (title: string, when: string, body: string, button?: string): Step => ({
  group: 'Push notifications', title, where: 'Notification shade', when,
  render: () => <Notification title={title} body={body} button={button}/>,
});
const concept = (variant: ReminderConcept, title: string, where: string, when: string): Step => ({
  group: 'Promotions (not redesigned)', title, where, when, render: () => <ReminderConcepts variant={variant}/>,
});

const STEPS: Step[] = [
  sheet('welcome', 'Welcome', 'Explore', 'Once, on the first visit to Explore after sign-up, before verifying.'),
  sheet('likes', 'Out of likes', 'Explore', 'A Like after the 25 daily likes. Counts down to midnight.'),
  sheet('chat', 'Message limit', 'Chat', 'Sending after 30 messages.'),
  sheet('media', 'Chat attachments', 'Chat', 'Opening attachments before verifying.'),
  sheet('rose', 'Trial Rose used', 'Explore / Standouts', 'Another Rose after the trial Rose.'),
  sheet('roseSent', 'Trial Rose sent', 'Explore / Standouts', 'Right after the trial Rose is sent.'),
  sheet('paused', 'Profile paused', 'Explore', 'A Like or Rose after the 14 days to verify.', {paused: true, graceDaysLeft: 0}),
  sheet('paused', 'Profile paused (selfie owed)', 'Explore', 'Same, when the college is verified and the selfie check is owed.', {...verifiedStatus, paused: true, graceDaysLeft: 0}),
  sheet('follows', 'Follow request limit', 'Search', '10 follow requests in a day.'),
  sheet('mention', 'Story mentions', 'Story editor', 'Mentioning someone who is not a match.'),
  sheet('standouts', 'Standouts', 'Standouts', 'Trying to appear in Standouts before verifying.'),
  sheet('area', 'Other campuses', 'My preferences', 'Choosing an area that needs verifying.'),
  sheet('search', 'Daily search limit', 'Search', '30 different people in Search today.'),

  {group: 'Chat', title: 'Messages running out', where: 'Chat', when: '5 or fewer of the 30 messages left.', status: {chatLeft: 3},
    render: () => <Chat><ChatVerificationReminder remaining={3} onVerify={() => {}}/></Chat>},
  {group: 'Chat', title: 'Message box locked', where: 'Chat', when: 'All 30 messages used: the bar takes the composer’s place.', status: {chatLeft: 0},
    render: () => <Chat composer={false}><ChatVerificationReminder remaining={0} onVerify={() => Alert.alert('Verify', 'Opens the college email step.')}/></Chat>},
  {group: 'Chat', title: 'Waiting for them', where: 'Chat', when: 'The other person has used their 30 messages.', status: verifiedStatus,
    render: () => <Chat name="Ankit"><ChatVerificationWaiting name="Ankit"/></Chat>},

  deckCard('likes', 'Out of likes (deck card)', 'All 25 likes used today. “Keep browsing” hides it until tomorrow.', {likesLeft: 0}),
  deckCard('paused', 'Profile paused (deck card)', 'The 14 days to verify have ended. Stays until verified.', {paused: true, graceDaysLeft: 0}),
  deckCard('selfiePaused', 'Paused for selfie (deck card)', 'College verified, selfie check not done after 14 days.', {...verifiedStatus, paused: true, graceDaysLeft: 0}),
  deckBanner('Profile pauses soon', '4 days or fewer left to verify.', {graceDaysLeft: 2}),
  deckBanner('Selfie due soon', 'College verified, selfie check due in 4 days or fewer.', {...verifiedStatus, graceDaysLeft: 2}),
  deckBanner('Likes running low', '5 or fewer likes left today.', {likesLeft: 3}),
  deckBanner('Out of likes (after Keep browsing)', 'Likes used, deck card closed for today.', {likesLeft: 0, graceDaysLeft: 8}),
  deckBanner('Verification ended', 'A college verification has run out.', {...verifiedStatus, verified: false, expired: true}),
  deckBanner('Verified-only tip', 'A verified student’s first unverified card. Once.', {...verifiedStatus, realPersonVerified: true, owesRealPerson: false}, {topCardUnverified: true}),
  deckBanner('After 20 swipes', 'About 20 swipes in one sitting. At most once a day.', {}, {swipes: 20}),

  listBanner('Likes You', 'Likes You', 'Before verifying.', <UnverifiedNudge art="badge" text="Verify your college to show the blue badge in Likes." dismissKey="likes-you"/>),
  listBanner('Search', 'Search', 'Before verifying.', <UnverifiedNudge art="search" icon="search-outline" text="Verify your college to search every campus." dismissKey="search-campus"/>),
  listBanner('Standouts', 'Standouts', 'Before verifying.', <UnverifiedNudge art="standouts" icon="sparkles-outline" text="Verify to appear in Standouts and get 5 Roses a week." dismissKey="standouts"/>),
  listBanner('Standouts (few picks)', 'Standouts', 'Fewer than 8 Standouts before verifying.', <UnverifiedNudge art="standouts" icon="sparkles-outline" text="You see people from Gurukul. Verify to see every campus."/>),
  listBanner('Map', 'Map', 'Before verifying, after the Map introduction.', <UnverifiedNudge art="map" icon="map-outline" text="You're not on the map yet. Verify your college to appear." dismissKey="map"/>, <View style={x.map}/>),
  listBanner('My preferences', 'My preferences', 'Before verifying.', <UnverifiedNudge art="campus" icon="globe-outline" text="You meet students from your campus. Verify to see every campus."/>, <View>{['Age 19 - 24', 'My campus', 'Interested in'].map(label => <Text key={label} style={x.setting}>{label}</Text>)}</View>),
  listBanner('Matches', 'Matches', 'Before verifying.', <UnverifiedNudge art="match" icon="chatbubbles-outline" text="Verify your college for unlimited chat and photos." dismissKey="matches-header"/>),
  listBanner('Chats', 'Chats', 'Before verifying.', <UnverifiedNudge art="chat" icon="chatbubbles-outline" text="Verify your college for unlimited chat and photos." dismissKey="chats-header"/>),
  listBanner('Profile preview', 'Profile preview', 'Before verifying.', <UnverifiedNudge art="badge" text="Others don't see a blue badge on your profile yet." cta="Get it" dismissKey="preview"/>,
    <Image source={{uri: portrait}} style={x.previewPhoto}/>),
  {group: 'Banners', title: 'Story sharing', where: 'Story editor', when: 'Before verifying, over the share buttons. Not a button.',
    render: () => <View style={x.storyScreen}><Image source={{uri: portrait}} style={StyleSheet.absoluteFill} resizeMode="cover"/><StoryShareVerifyLine bottom={84}/>
      <View style={x.shareRow}><View style={x.shareButton}><Text style={x.shareText}>Your story</Text></View><View style={x.shareButton}><Text style={x.shareText}>Close friends</Text></View></View></View>},

  row('Blue badge: start', 'Google account, nothing verified yet, 8 days left.', {}),
  row('Blue badge: deadline', 'Google account, 2 days left.', {graceDaysLeft: 2}),
  row('Blue badge: selfie next', 'College verified, selfie check not done.', verifiedStatus),
  row('Blue badge: selfie due', 'College verified, selfie due in 2 days.', {...verifiedStatus, graceDaysLeft: 2}),
  row('Blue badge: selfie in review', 'College verified, selfie with the review team.', verifiedStatus, {status: 'pending_review'}),
  row('Blue badge: selfie done', 'Selfie matched, college email not yet verified.', {realPersonVerified: true, owesRealPerson: false}, {status: 'verified'}),
  row('Blue badge: optional selfie', 'College-email account: the selfie is optional.', {...verifiedStatus, signedUpWithGoogle: false, realPersonRequired: false, owesRealPerson: false}, {required: false}),
  row('Blue badge: paused', 'The 14 days have ended.', {paused: true, graceDaysLeft: 0}),
  row('Re-verify', 'College verification has run out.', {...verifiedStatus, verified: false, expired: true, realPersonVerified: true}, {status: 'verified'}),
  row('Fix your media', 'The selfie check could not match a photo or the video.', verifiedStatus, {status: 'needs_fix', media: [{url: man, kind: 'photo', status: 'mismatch'}]}),
  {group: 'Profile row', title: 'Edit college', where: 'Edit profile → College', when: 'College not verified.',
    render: () => <Screen title="College"><View style={{padding: 16}}><Text style={x.setting}>IEM Kolkata</Text>
      <ReminderRow flush leading={<ReminderArt name="badge" size={42}/>} title="Verify your college email" subtitle="Step 1 of your blue badge." value="Verify" onPress={() => {}}/></View></Screen>},
  {group: 'Profile row', title: 'Edit college (ended)', where: 'Edit profile → College', when: 'College verification has run out.',
    render: () => <Screen title="College"><View style={{padding: 16}}><Text style={x.setting}>IEM Kolkata</Text>
      <ReminderRow flush tone="warn" leading={<ReminderArt name="renew" size={42}/>} title="Renew your college verification" subtitle="Your verification has ended." value="Re-verify" onPress={() => {}}/></View></Screen>},

  {group: 'Photo problems', title: 'Photo doesn’t match', where: 'Edit profile', when: 'The selfie check could not match a photo.', status: verifiedStatus,
    face: {status: 'needs_fix', media: [{url: man, kind: 'photo', status: 'mismatch'}]}, render: () => <Photos issues={{[man]: 'mismatch'}}/>},
  {group: 'Photo problems', title: 'Main photo has no face', where: 'Edit profile', when: 'No face found in the main photo.', status: verifiedStatus,
    face: {status: 'needs_fix', media: [{url: portrait, kind: 'photo', status: 'no_face'}]}, render: () => <Photos issues={{[portrait]: 'no_face'}}/>},
  {group: 'Photo problems', title: 'Video doesn’t match', where: 'Edit profile', when: 'The profile video could not be matched.', status: verifiedStatus,
    face: {status: 'needs_fix', media: [{url: 'video', kind: 'video', status: 'mismatch'}]}, render: () => <Photos issues={{}} video/>},
  {group: 'Photo problems', title: 'Photo in review', where: 'Edit profile', when: 'A photo needs a person to check it.', status: verifiedStatus,
    face: {status: 'pending_review', media: [{url: man, kind: 'photo', status: 'unsure'}]}, render: () => <Photos issues={{[man]: 'unsure'}}/>},

  push('Start your blue badge', 'Day 1 after a Google sign-up, unverified.', 'Verify your college email - step 1 of the blue badge. Unlock unlimited chat and get 5 Roses each week.'),
  push('One step closer to your blue badge', 'Day 5, still unverified. The last of the two.', 'Verify your college email to unlock photos, unlimited chat and your Roses.'),
  push('Your profile pauses in 4 days', 'Day 10, still unverified.', 'Open the app to finish verifying and stay visible. It takes a minute.'),
  push('Your profile pauses in 1 day', 'Day 13.', 'Open the app to finish verifying and stay visible. It takes a minute.'),
  push('Your profile is paused', 'Day 14. Always sent: it is news, not a reminder.', "Others can't see you right now. Open the app to finish verifying and it unpauses at once - your matches and chats are still here."),
  push('Your college verification ends in 30 days', '30, 7 and 1 day before a verification ends.', 'Re-verify with your college email to keep your blue badge.'),
  push('A verified student liked you', 'An unverified person gets a Like from a verified student.', 'Open Likes You to see who - and get your blue badge so they see it.', 'See who'),
  push('A verified student sent you a Rose', 'The same, for a Rose.', 'Open Likes You to see who - and get your blue badge so they see it.', 'See who'),

  {group: 'Match', title: 'Verified match', where: 'After a match', when: 'A match. The verify line shows only when they are verified and you are not.',
    render: ({close}) => <Deck><MatchSheet match={{name: 'Rohan', verifyNudge: true}} onClose={close} onSayHi={() => Alert.alert('Say hi', 'Opens the chat with Rohan.')} onVerify={() => Alert.alert('Verify', 'Opens the college email step.')}/></Deck>},
  {group: 'Match', title: 'Match', where: 'After a match', when: 'Any other match.',
    render: ({close}) => <Deck><MatchSheet match={{name: 'Aanya', verifyNudge: false}} onClose={close} onSayHi={() => Alert.alert('Say hi', 'Opens the chat with Aanya.')} onVerify={() => {}}/></Deck>},

  {group: 'Verification screens', title: 'College email', where: 'Verify', when: 'Every Verify button opens this. Demo code: 123456.', render: ({close}) => <College onBack={close}/>},
  {group: 'Verification screens', title: 'Code', where: 'Verify', when: 'After Send code. The sixth digit sends it. Demo code: 123456.', render: ({close}) => <College codePage onBack={close}/>},

  concept('verification', 'Your college, confirmed', 'Explore', 'Promotion screen - kept as it was.'),
  concept('map', 'A nearby hello', 'Search', 'Map introduction - kept as it was.'),
  concept('reward', 'One Rose', 'Explore', 'Reward screen - kept as it was.'),
];

export function ReminderPreview() {
  const parent = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const [replay, setReplay] = useState(0);
  const [menu, setMenu] = useState(false);
  const [closed, setClosed] = useState(false);
  const [destination, setDestination] = useState<'college' | 'selfie' | null>(null);
  const step = STEPS[index];
  const fixture: Fixture = useMemo(() => ({
    status: {...baseStatus, ...step.status},
    face: {...baseFace, ...step.face, media: step.face?.media ?? []},
  }), [step]);
  const show = (next: number) => {Keyboard.dismiss(); setIndex(Math.max(0, Math.min(STEPS.length - 1, next))); setMenu(false); setClosed(false); setDestination(null); setReplay(value => value + 1);};
  const back = () => {Keyboard.dismiss(); setDestination(null); setClosed(false); setReplay(value => value + 1);};
  const open = (route: string) => {
    if (route === 'VerifyCollege' || route === 'StudentVerification') setDestination('college');
    else if (route === 'RealPersonCheck') setDestination('selfie');
    else Alert.alert('Demo', `${route === 'EditProfile' ? 'Edit profile' : route} would open here.`);
  };
  const navigation = useMemo(() => ({...parent, navigate: open, replace: open, push: open, goBack: () => setClosed(true)}), [parent]);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (menu) setMenu(false); else if (destination || closed) back(); else parent.goBack();
      return true;
    });
    return () => listener.remove();
  }, [menu, destination, closed, parent]);

  return <View style={x.page}>
    <StatusBar barStyle="light-content" backgroundColor="#100F0D"/>
    <View style={{flex: 1, paddingTop: destination ? 0 : insets.top}}>
      <VerificationPreviewContext.Provider value={fixture}>
        <NavigationContext.Provider value={navigation}>
          <NavigationRouteContext.Provider value={{key: `reminder-${index}`, name: 'ReminderDemo', params: {}}}>
            <View key={`${index}-${replay}-${destination}`} style={{flex: 1}}>
              {destination === 'college' ? <College onBack={back}/>
                : destination === 'selfie' ? <Selfie onBack={back}/>
                : closed ? <View style={x.closed}><Ionicons name="checkmark-circle-outline" size={40} color={reminderColors.success}/><Text style={x.closedTitle}>Closed</Text><Text style={x.line}>Tap Replay to see it again.</Text></View>
                : step.render({close: () => setClosed(true)})}
            </View>
          </NavigationRouteContext.Provider>
        </NavigationContext.Provider>
      </VerificationPreviewContext.Provider>
    </View>
    <View style={[x.toolbar, {paddingBottom: Math.max(insets.bottom, 10)}]}>
      <View style={x.toolbarTop}>
        <Pressable accessibilityRole="button" accessibilityLabel="Exit reminders demo" onPress={() => parent.goBack()} style={x.toolIcon}><Ionicons name="close" size={21} color="#D6C7D2"/></Pressable>
        <View style={{flex: 1}}>
          <Text style={x.small} numberOfLines={1}>{step.group.toUpperCase()} · {index + 1}/{STEPS.length}</Text>
          <Text style={x.label} numberOfLines={1}>{step.title}</Text>
          <Text style={x.when} numberOfLines={2}>{step.where} · {step.when}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Choose a reminder" onPress={() => setMenu(true)} style={x.toolIcon}><Ionicons name="list" size={21} color={reminderColors.accent}/></Pressable>
      </View>
      <View style={x.controls}>
        <Pressable accessibilityRole="button" disabled={index === 0} onPress={() => show(index - 1)} style={[x.toolButton, index === 0 && {opacity: 0.3}]}><Ionicons name="arrow-back" size={17} color="#D6C7D2"/><Text style={x.label}>Back</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => show(index)} style={x.toolButton}><Ionicons name="refresh" size={17} color={reminderColors.accent}/><Text style={x.label}>Replay</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={index === STEPS.length - 1} onPress={() => show(index + 1)} style={[x.toolButton, x.next, index === STEPS.length - 1 && {opacity: 0.3}]}><Text style={x.nextText}>Next</Text><Ionicons name="arrow-forward" size={17} color="#331C23"/></Pressable>
      </View>
    </View>
    <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
      <View style={[x.menuShade, {paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16}]}><View style={x.menu}>
        <View style={x.toolbarTop}><Text style={[x.closedTitle, {flex: 1}]}>All reminders</Text><Pressable accessibilityRole="button" accessibilityLabel="Close list" onPress={() => setMenu(false)} style={x.toolIcon}><Ionicons name="close" size={22} color="#D6C7D2"/></Pressable></View>
        <ScrollView>{STEPS.map((item, i) => <React.Fragment key={i}>
          {(i === 0 || STEPS[i - 1].group !== item.group) && <Text style={x.menuGroup}>{item.group.toUpperCase()}</Text>}
          <Pressable accessibilityRole="button" onPress={() => show(i)} style={[x.menuItem, i === index && x.selected]}>
            <Text style={x.number}>{i + 1}</Text><View style={{flex: 1}}><Text style={x.label}>{item.title}</Text><Text style={x.small}>{item.where}</Text></View>
          </Pressable>
        </React.Fragment>)}</ScrollView>
      </View></View>
    </Modal>
  </View>;
}
