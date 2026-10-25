import React, {useEffect, useRef, useState} from 'react';
import {AccessibilityInfo, Animated, Easing, Image, Platform, Pressable, StyleSheet, Text, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import Svg, {Path} from 'react-native-svg';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {VerifiedBadge} from '../features/discovery/components/VerifiedBadge';

export type ReminderConcept = 'verification' | 'map' | 'reward';
const photo = {uri: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=85'};
const ink = '#121315';
const white = '#FAF8F4';
const roseAsset = require('../../assets/illustrations/rose-cute-reward.png');
const roseSource = Platform.OS === 'web' ? {uri: roseAsset} : roseAsset;
const browseAsset = require('../../assets/illustrations/browse-kitten.png');
const browseSource = Platform.OS === 'web' ? {uri: browseAsset} : browseAsset;

function Action({label, onPress, color = '#BDD9FF'}: {label: string; onPress: () => void; color?: string}) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({pressed}) => [s.action, {backgroundColor: color, transform: [{scale: pressed ? 0.98 : 1}], opacity: pressed ? 0.85 : 1}]}><Text style={s.actionText}>{label}</Text><Ionicons name="arrow-forward" size={20} color={ink}/></Pressable>;
}

/** Preview-only compositions. Actions never grant rewards or change account state. */
export function ReminderConcepts({variant, onVerify}: {variant: ReminderConcept; onVerify?: () => void}) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(true);
  const [completed, setCompleted] = useState(false);
  const [height, setHeight] = useState(740);
  const [imageFailed, setImageFailed] = useState(false);
  const [mapRect, setMapRect] = useState({x: 0, y: 0, width: 0, height: 0});
  const fade = useRef(new Animated.Value(0)).current;
  const art = useRef(new Animated.Value(0)).current;
  const arrow = useRef(new Animated.Value(0)).current;
  const badgeTurn = useRef(new Animated.Value(0)).current;
  const compact = height < 680;
  const roseHeight = Math.max(120, Math.min(300, height - insets.top - Math.max(20, insets.bottom) - 380));
  useEffect(() => {
    let alive = true;
    let animation: Animated.CompositeAnimation | undefined;
    let rotation: Animated.CompositeAnimation | undefined;
    const run = (reduced: boolean) => {
      if (!alive) return;
      animation?.stop();
      rotation?.stop();
      badgeTurn.setValue(0);
      if (reduced || !open) {fade.setValue(1); art.setValue(1); arrow.setValue(1); return;}
      fade.setValue(0); art.setValue(0); arrow.setValue(0);
      const native = Platform.OS !== 'web';
      animation = Animated.parallel([
        Animated.timing(fade, {toValue: 1, duration: 220, useNativeDriver: native}),
        Animated.spring(art, {toValue: 1, damping: 19, stiffness: 180, mass: 0.8, useNativeDriver: native}),
        Animated.timing(arrow, {toValue: 1, duration: 380, delay: 140, useNativeDriver: native}),
      ]);
      animation.start();
      if (variant === 'verification') {
        rotation = Animated.loop(Animated.timing(badgeTurn, {
          toValue: 1, duration: 8000, easing: Easing.linear, useNativeDriver: native,
        }));
        rotation.start();
      }
    };
    AccessibilityInfo.isReduceMotionEnabled().then(run).catch(() => run(true));
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', run);
    return () => {alive = false; animation?.stop(); rotation?.stop(); listener.remove();};
  }, [open, variant, fade, art, arrow, badgeTurn]);
  const close = () => setOpen(false);
  const settle = {opacity: art, transform: [{translateY: art.interpolate({inputRange: [0, 1], outputRange: [18, 0]})}, {scale: art.interpolate({inputRange: [0, 1], outputRange: [0.95, 1]})}]};
  const renderPhoto = () => imageFailed ? <View style={[s.image, s.photoFallback]}><Ionicons name="person" size={100} color="#BDD9FF"/></View> : <Image source={photo} style={s.image} resizeMode="cover" onError={() => setImageFailed(true)}/>;
  return <View style={[s.page, variant === 'map' && {backgroundColor: '#100F0D'}]} onLayout={event => {
    const page = event.nativeEvent.layout;
    setHeight(page.height);
    if (variant === 'map') setMapRect({x: page.width - 64, y: insets.top + 12, width: 44, height: 44});
  }}>
    <View style={[s.context, {paddingTop: insets.top + 12}]} accessibilityElementsHidden={open} importantForAccessibility={open ? 'no-hide-descendants' : 'auto'}>
      {variant === 'map' ? <>
        <View style={s.header}>
          <Text style={s.brand}>Browse</Text>
          <View style={s.searchMapButton}><Ionicons name="map-outline" size={21} color={white}/></View>
        </View>
        <Text style={s.browseSubtitle}>People at your college, by what you share.</Text>
        <View style={s.searchField}><Ionicons name="search" size={18} color="#ABA5A1"/><Text style={s.searchPlaceholder}>Search by name</Text></View>
        <View style={s.searchGuide}><Image source={browseSource} resizeMode="contain" style={{width: 112, height: 168}}/><Text style={s.searchGuideTitle}>Looking for someone?</Text><Text style={s.searchGuideHint}>Try their name in the search bar above.</Text></View>
      </> : <>
        <View style={s.header}><Text style={s.brand}>Discover</Text><Ionicons name="options-outline" size={24} color={white}/></View>
        <Text style={s.campus}>YOUR CAMPUS · GURUKUL</Text>
        <View style={s.profile}>{renderPhoto()}<View style={s.profileCopy}><Text style={s.name}>Aanya, 22</Text><Text style={s.profileDetail}>IEM · Music, coffee & campus walks</Text></View></View>
        <View style={s.decisions}>{(['close', 'rose', 'heart'] as const).map((icon, i) => <View key={icon} style={[s.decision, i === 1 && {backgroundColor: '#4A2B37'}]}><Ionicons name={icon} size={26} color={i === 1 ? '#F6B5C3' : white}/></View>)}</View>
      </>}
      {!open && <View style={s.finished}><Text style={s.detail}>{completed ? variant === 'map' ? 'Map tutorial complete. This is a preview.' : 'Rose preview complete. No reward was added.' : 'Preview dismissed.'}</Text><Pressable accessibilityRole="button" onPress={() => {setCompleted(false); setOpen(true);}} style={s.replay}><Text style={s.link}>Replay this preview</Text></Pressable></View>}
    </View>
    <View accessibilityElementsHidden={open} importantForAccessibility={open ? 'no-hide-descendants' : 'auto'} style={[s.nav, {paddingBottom: Math.max(10, insets.bottom)}]}>{(['Explore', 'Search', 'Matches', 'Chats', 'Profile'] as const).map((label, i) => <View key={label} style={s.navItem}><Ionicons name={(['home-outline', 'search-outline', 'diamond-outline', 'chatbubble-outline', 'person-outline'] as const)[i]} size={23} color={i === (variant === 'map' ? 1 : 0) ? '#F1B8C6' : '#A5A3A9'}/><Text style={s.navLabel}>{label}</Text></View>)}</View>
    {open && variant === 'verification' && <Animated.View accessibilityViewIsModal style={[s.takeover, {paddingTop: insets.top + 12, paddingBottom: Math.max(16, insets.bottom), opacity: fade}]}>
      <View style={s.header}><Text style={s.kicker}>YOUR COLLEGE. CONFIRMED.</Text><Pressable accessibilityRole="button" accessibilityLabel="Close verification preview" onPress={close} style={s.close}><Ionicons name="close" size={23} color={white}/></Pressable></View>
      <View style={[s.portraitStage, {flex: compact ? 0.85 : 1}]}>
        {[[-100, -65, -15], [104, -48, 18], [-107, 84, 12], [113, 95, -12]].map(([x, y, rotate], i) => <View key={i} style={[s.pattern, {transform: [{translateX: x}, {translateY: y}, {rotate: `${rotate}deg`}]}]}><VerifiedBadge size={34}/></View>)}
        <Animated.View style={[s.portrait, {width: compact ? 170 : 204, height: compact ? 214 : 255}, settle]}>
          <View style={s.tiltedPhoto}>{renderPhoto()}</View>
          <View style={s.badgeTile}>
            <View style={s.badgeBackdrop}/>
            <View accessibilityLabel="Verified profile" style={{width: 50, height: 50, zIndex: 1}}>
              <Animated.View pointerEvents="none" style={{...StyleSheet.absoluteFill, transform: [{rotate: badgeTurn.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']})}]}}>
                <Svg width={50} height={50} viewBox="0 0 24 24"><Path fill="#3B82F6" d="M23 12l-2.44-2.79.34-3.69-3.61-.82L15.4 1.5 12 2.96 8.6 1.5 6.71 4.69 3.1 5.5l.34 3.7L1 12l2.44 2.79-.34 3.7 3.61.82L8.6 22.5l3.4-1.47 3.4 1.46 1.89-3.19 3.61-.82-.34-3.69L23 12Z"/></Svg>
              </Animated.View>
              <View pointerEvents="none" style={{zIndex: 1}}><Svg width={50} height={50} viewBox="0 0 24 24"><Path d="m7.4 12.1 3.1 3.1 6.3-6.3" fill="none" stroke="#FFFFFF" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"/></Svg></View>
            </View>
          </View>
        </Animated.View>
      </View>
      <View style={s.verificationCopy}><Text style={[s.title, {fontSize: compact ? 33 : 38, lineHeight: compact ? 37 : 43}]}>A familiar face.{'\n'}An official badge.</Text><Text style={s.detail}>Confirm your college email so people{'\n'}can see where you belong.</Text><View style={s.benefit}><VerifiedBadge size={19}/><Text style={s.benefitText}>Your college, shown on your profile</Text></View><Action label="Verify my college" onPress={onVerify ?? close}/><Pressable accessibilityRole="button" onPress={close} style={s.later}><Text style={s.link}>Maybe later</Text></Pressable></View>
    </Animated.View>}
    {open && variant === 'map' && mapRect.width > 0 && <Animated.View accessibilityViewIsModal style={[StyleSheet.absoluteFill, {opacity: fade}]}>
      <View style={s.scrim}/>
      <View style={[s.coachCopy, {top: mapRect.y + mapRect.height + 130}]}><Text style={s.mapKicker}>MAP IS HERE IN SEARCH</Text><Text style={[s.coachTitle, compact && {fontSize: 30, lineHeight: 35}]}>Your next hello{'\n'}could be nearby.</Text><Text style={[s.detail, {textAlign: 'left', maxWidth: 275, color: '#C6BBB4'}]}>Tap the Map button above to explore connections around you.</Text><Pressable accessibilityRole="button" onPress={close} style={s.skip}><Text style={s.link}>Skip for now</Text></Pressable></View>
      <Animated.View pointerEvents="none" style={{position: 'absolute', left: mapRect.x + mapRect.width / 2 - 150, top: mapRect.y + mapRect.height - 1, zIndex: 2, opacity: arrow, transform: [{translateY: arrow.interpolate({inputRange: [0, 1], outputRange: [12, 0]})}]}}>
        <Svg width={176} height={125} viewBox="0 0 176 125">
          <Path d="M18 110C18 59 150 59 150 8M140 18L150 8L160 18" fill="none" stroke="#F5A98F" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round"/>
        </Svg>
      </Animated.View>
      <Pressable accessibilityRole="button" accessibilityLabel="Open Map from Search and complete tutorial preview" onPress={() => {setCompleted(true); close();}} style={[s.mapTarget, {left: mapRect.x, top: mapRect.y, width: mapRect.width, height: mapRect.height}]}><Ionicons name="map-outline" size={23} color="#F8B99E"/></Pressable>
    </Animated.View>}
    {open && variant === 'reward' && <Animated.View accessibilityViewIsModal style={[s.rewardShade, {paddingTop: insets.top + 50, paddingBottom: Math.max(20, insets.bottom), opacity: fade}]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close Rose preview" onPress={close} style={[s.close, s.rewardClose, {top: insets.top + 10}]}><Ionicons name="close" size={23} color="#EAC8C1"/></Pressable>
      <Animated.View style={[s.rewardWrap, settle]}>
      <View style={s.roseArt}><Image source={roseSource} accessibilityLabel="Cute pink Rose with rounded petals and green leaves" resizeMode="contain" style={{width: roseHeight * 2 / 3, height: roseHeight}}/></View><View style={s.rewardCopy}><Text style={s.rewardKicker}>SOMETHING TO START WITH</Text><Text style={s.rewardTitle}>One Rose.{'\n'}A little more courage.</Text><Text style={[s.detail, {color: '#D8BDB8'}]}>For someone who makes you{'\n'}want to say hello first.</Text><View style={s.roseCount}><Text style={s.roseNumber}>1</Text><Text style={s.roseLabel}>ROSE TO SEND</Text></View><Action label="Try the Rose preview" color="#F6B8A6" onPress={() => {setCompleted(true); close();}}/><Text style={s.previewNote}>Sample reward · no account changes</Text></View>
    </Animated.View></Animated.View>}
  </View>;
}

const s = StyleSheet.create({
  badgeBackdrop: {...StyleSheet.absoluteFill, backgroundColor: '#BBD8F3', borderRadius: 25, transform: [{rotate: '7deg'}]},
  searchMapButton: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#24201F', alignItems: 'center', justifyContent: 'center'},
  browseSubtitle: {color: '#F4F0EC', fontSize: 13, lineHeight: 18, marginTop: 2, marginBottom: 14, fontFamily: 'DMSans_400Regular'},
  searchField: {height: 46, borderRadius: 16, backgroundColor: '#24201F', flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14},
  searchPlaceholder: {color: '#B9B1AA', fontSize: 14, fontFamily: 'DMSans_400Regular'},
  searchGuide: {flex: 1, alignItems: 'center', paddingTop: 28},
  searchGuideTitle: {color: '#FAF8F4', fontFamily: 'DMSans_700Bold', fontSize: 18, marginTop: 16, textAlign: 'center'},
  searchGuideHint: {color: '#B9B1AA', fontFamily: 'DMSans_400Regular', fontSize: 13, marginTop: 6, textAlign: 'center'},
  page: {flex: 1, backgroundColor: ink, overflow: 'hidden'}, context: {flex: 1, paddingHorizontal: 20}, header: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}, brand: {color: white, fontSize: 25, fontFamily: 'DMSans_700Bold'}, campus: {fontSize: 10, letterSpacing: 1.8, color: '#A8A4AE', marginVertical: 16}, profile: {flex: 1, minHeight: 120, borderRadius: 23, overflow: 'hidden', backgroundColor: '#242D37'}, image: {width: '100%', height: '100%'}, photoFallback: {alignItems: 'center', justifyContent: 'center', backgroundColor: '#26364C'}, profileCopy: {position: 'absolute', bottom: 0, left: 0, right: 0, padding: 19, backgroundColor: '#121315CC'}, name: {color: white, fontFamily: 'DMSans_700Bold', fontSize: 26}, profileDetail: {color: '#DDD9D6', fontSize: 12, marginTop: 5}, decisions: {flexDirection: 'row', justifyContent: 'center', gap: 24, paddingVertical: 15}, decision: {width: 51, height: 51, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: '#28272B'}, nav: {flexDirection: 'row', backgroundColor: ink, paddingTop: 12}, navItem: {width: '20%', alignItems: 'center', gap: 5}, navLabel: {color: '#AAA6AF', fontFamily: 'DMSans_500Medium', fontSize: 10}, takeover: {...StyleSheet.absoluteFill, backgroundColor: '#14191F', paddingHorizontal: 24}, kicker: {color: '#8FAAC8', fontFamily: 'DMSans_700Bold', fontSize: 9, letterSpacing: 2}, close: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF0C', alignItems: 'center', justifyContent: 'center'}, portraitStage: {alignItems: 'center', justifyContent: 'center', minHeight: 250}, pattern: {position: 'absolute', opacity: 0.16, left: '45%', top: '43%'}, portrait: {marginBottom: 18}, tiltedPhoto: {flex: 1, borderRadius: 28, overflow: 'hidden', transform: [{rotate: '-6deg'}], backgroundColor: '#26364C'}, badgeTile: {position: 'absolute', right: -21, bottom: -17, width: 78, height: 78, alignItems: 'center', justifyContent: 'center'}, verificationCopy: {gap: 0}, title: {fontFamily: 'CormorantGaramond_600SemiBold', color: white, textAlign: 'center', paddingBottom: 5}, detail: {fontFamily: 'DMSans_400Regular', color: '#ACB3BD', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 10}, benefit: {flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', marginVertical: 20}, benefitText: {color: '#C8D7E8', fontSize: 11, fontFamily: 'DMSans_500Medium'}, action: {minHeight: 53, borderRadius: 17, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12}, actionText: {color: ink, fontSize: 15, fontFamily: 'DMSans_700Bold'}, later: {minHeight: 45, alignItems: 'center', justifyContent: 'center'}, link: {fontFamily: 'DMSans_500Medium', color: '#C1BDC7', fontSize: 13}, scrim: {position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#080706E8'}, coachCopy: {position: 'absolute', left: 27, right: 24}, mapKicker: {color: '#F5A98F', fontSize: 9, letterSpacing: 1.8, marginBottom: 15, fontFamily: 'DMSans_700Bold'}, coachTitle: {color: white, fontSize: 35, lineHeight: 40, fontFamily: 'DMSans_700Bold'}, skip: {alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', marginTop: 10}, mapTarget: {position: 'absolute', alignItems: 'center', justifyContent: 'center', backgroundColor: '#493127', borderRadius: 22}, rewardShade: {...StyleSheet.absoluteFill, backgroundColor: '#09080CEF', justifyContent: 'center', paddingHorizontal: 28}, rewardWrap: {width: '100%', maxWidth: 360, alignSelf: 'center'}, roseArt: {alignItems: 'center', marginBottom: 12}, rewardCopy: {paddingHorizontal: 0}, rewardClose: {position: 'absolute', right: 22}, rewardKicker: {color: '#DCA994', fontSize: 8, letterSpacing: 1.8, textAlign: 'center', fontFamily: 'DMSans_700Bold'}, rewardTitle: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 34, lineHeight: 37, textAlign: 'center', color: '#FFF0E7', marginTop: 12, paddingBottom: 5}, roseCount: {flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, marginVertical: 17}, roseNumber: {fontSize: 32, color: '#F6B8A6', fontFamily: 'DMSans_700Bold'}, roseLabel: {fontSize: 9, letterSpacing: 2, color: '#DCADA7', fontFamily: 'DMSans_700Bold'}, previewNote: {fontSize: 10, textAlign: 'center', color: '#AE8D89', marginTop: 15}, finished: {paddingBottom: 10}, replay: {alignItems: 'center', padding: 12},
});
