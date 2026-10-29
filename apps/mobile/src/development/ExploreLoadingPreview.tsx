import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Animated, Image, Pressable, ScrollView, StatusBar, StyleSheet, Text, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {LinearGradient} from 'expo-linear-gradient';
import {loadingDemoMessage, loadingDemoPlan, loadingDemoScenarios, type LoadingDemoPhase, type LoadingDemoScenario} from './exploreLoadingDemoModel';
import {SearchAvatar as Avatar, SearchPulse, useSearchMotion} from '../features/discovery/components/ProfileSearchLoading';
import {ExploreEmptyPreview} from './ExploreEmptyPreview';

type Props = {
  avatarUri?: string | null;
  profileUri?: string;
  topInset?: number;
  bottomInset?: number;
  onClose: () => void;
  reduceMotionOverride?: boolean;
  initialScenario?: LoadingDemoScenario;
};
const SAMPLE_PROFILE = 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=900&q=85';
const INK = '#100F0D';

/** Isolated review screen. It imports no API, location, preference, or swipe service. */
export function ExploreLoadingDemo({avatarUri, profileUri = SAMPLE_PROFILE, topInset = 0, bottomInset = 0, onClose, reduceMotionOverride, initialScenario = 'open'}: Props) {
  const [scenario, setScenario] = useState<LoadingDemoScenario>(initialScenario);
  const [phase, setPhase] = useState<LoadingDemoPhase>(loadingDemoPlan(initialScenario)[0].phase);
  const [standoutsPreview, setStandoutsPreview] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [photoAttempt, setPhotoAttempt] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const generation = useRef(0);
  const fade = useRef(new Animated.Value(0)).current;
  const motion = useSearchMotion(reduceMotionOverride);
  const cancel = useCallback(() => {
    generation.current++;
    timers.current.forEach(clearTimeout); timers.current = [];
  }, []);
  const run = useCallback((next: LoadingDemoScenario, retry = false) => {
    cancel();
    const token = generation.current;
    const plan = loadingDemoPlan(next, retry);
    setStandoutsPreview(false);
    setScenario(next); setPhase(plan[0].phase); fade.stopAnimation(); fade.setValue(0);
    timers.current = plan.slice(1).map(step => setTimeout(() => {
      if (generation.current === token) setPhase(step.phase);
    }, step.at));
  }, [cancel, fade]);
  useEffect(() => {run(initialScenario); return cancel;}, [cancel, initialScenario, run]);
  useEffect(() => {setImageReady(false); setImageFailed(false);}, [profileUri]);
  const waitingForImage = phase === 'ready' && !imageReady && !imageFailed;
  const failed = phase === 'error' || phase === 'ready' && imageFailed;
  const ready = phase === 'ready' && imageReady && !imageFailed;
  const activeSearch = !failed && !ready && phase !== 'empty' && phase !== 'warmup';
  useEffect(() => {
    fade.stopAnimation();
    if (!ready) {fade.setValue(0); return;}
    const animation = Animated.timing(fade, {toValue: 1, duration: motion.reduced || scenario === 'instant' ? 0 : 180, useNativeDriver: true, isInteraction: false});
    animation.start();
    return () => animation.stop();
  }, [fade, motion.reduced, ready, scenario]);
  const showResult = () => {cancel(); setPhase('ready');};
  const returnToEmpty = () => {cancel(); setStandoutsPreview(false); setPhase('empty');};
  const retry = () => {
    if (imageFailed) {setImageFailed(false); setImageReady(false); setPhotoAttempt(value => value + 1);}
    run(scenario, true);
  };
  const message = waitingForImage
    ? {title: 'Loading the first profile…', detail: 'Preparing the photo.'}
    : loadingDemoMessage(scenario, phase);
  return <View style={[styles.page, {paddingTop: topInset, paddingBottom: bottomInset}]}>
    <StatusBar barStyle="light-content" backgroundColor={INK}/>
    <View style={styles.header}>
      {standoutsPreview ? <Pressable accessibilityRole="button" accessibilityLabel="Back to Explore empty state" onPress={returnToEmpty} style={styles.headerButton}><Ionicons name="chevron-back" size={23} color="#E6DEDA"/></Pressable> : <Avatar uri={avatarUri} size={32}/>}
      <Text style={styles.heading}>{standoutsPreview ? 'Standouts' : 'Explore'}</Text><Text style={styles.demoBadge}>Demo</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Replay loading demo" onPress={() => run(scenario)} style={styles.headerButton}><Ionicons name="refresh-outline" size={21} color="#E6DEDA"/></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Close loading demo" onPress={onClose} style={styles.headerButton}><Ionicons name="close" size={23} color="#E6DEDA"/></Pressable>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.controls} contentContainerStyle={styles.controlsContent} accessibilityLabel="Loading demo scenarios">
      {loadingDemoScenarios.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{selected: scenario === item.id}}
        onPress={() => run(item.id)} style={[styles.chip, scenario === item.id && styles.chipOn]}><Text style={[styles.chipText, scenario === item.id && styles.chipTextOn]}>{item.label}</Text></Pressable>)}
    </ScrollView>
    <View style={styles.deck}>
      <Animated.View pointerEvents={ready ? 'auto' : 'none'} testID="loaded-demo-profile" accessibilityElementsHidden={!ready} importantForAccessibility={ready ? 'auto' : 'no-hide-descendants'}
        style={[styles.card, {opacity: fade}]}>
        <Image key={`${profileUri}:${photoAttempt}`} source={{uri: profileUri}} style={StyleSheet.absoluteFill} resizeMode="cover"
          onLoad={() => {setImageReady(true); setImageFailed(false);}} onError={() => setImageFailed(true)} accessible={false}/>
        <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.2)', 'rgba(0,0,0,0.9)']} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill}/>
        <View style={styles.activePill}><View style={styles.greenDot}/><Text style={styles.activeText}>Active now</Text></View>
        <View style={styles.profileCopy}><Text style={styles.name}>Aanya, 22</Text><Text style={styles.department}>Computer Science</Text><Text style={styles.intent}>Long-term partner</Text></View>
        <View style={styles.cardActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Pass demo profile" onPress={() => run('open')} style={[styles.cardButton, styles.pass]}><Ionicons name="close" size={32} color="#FFF"/></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Like demo profile" onPress={() => run('open')} style={[styles.cardButton, styles.like]}><Ionicons name="heart" size={32} color="#FFF"/></Pressable>
        </View>
      </Animated.View>
      {phase === 'empty' ? <ExploreEmptyPreview onPreferences={() => run('preferences')}
        onStandouts={() => {showResult(); setStandoutsPreview(true);}} onRetry={() => run('open')}/> : null}
      {!ready && phase !== 'empty' && <View style={styles.status} accessibilityLiveRegion="polite" testID="search-status">
        {failed ? <View style={styles.stateIcon}><Ionicons name="cloud-offline-outline" size={36} color="#CFC2BF"/></View>
          : <SearchPulse avatarUri={avatarUri} animate={activeSearch && motion.active} reduced={motion.reduced}/>}
        <Text style={styles.statusTitle}>{failed ? 'Couldn’t load profiles' : message.title}</Text>
        <Text style={styles.statusDetail}>{failed ? 'Check your connection and try again.' : message.detail}</Text>
        {failed ? <Pressable accessibilityRole="button" onPress={retry} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable> : null}
      </View>}
    </View>
    {phase !== 'empty' && <View style={styles.demoFooter}>
      <Text style={styles.demoNote}>Preview only · preferences and location stay unchanged</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Show demo profiles now" onPress={showResult} style={styles.showResult}><Text style={styles.showResultText}>Show result now</Text></Pressable>
    </View>}
    <View style={styles.navigation} accessibilityLabel="Navigation preview" accessible>
      {([
        ['home', 'Explore'], ['search-outline', 'Search'], ['heart-outline', 'Connections'], ['chatbubble-outline', 'Chats'], ['person-outline', 'Profile'],
      ] as const).map(([icon, label], i) => <View key={label} style={styles.navItem}>
        <View style={i === 2 ? styles.connectionButton : undefined}><Ionicons name={icon} size={i === 2 ? 26 : 23} color={i === 0 || i === 2 ? '#F4EEEE' : '#9E999C'}/></View>
        {i !== 2 ? <Text style={[styles.navText, i === 0 && styles.navActive]}>{label}</Text> : null}
      </View>)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: INK},
  header: {height: 56, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 9},
  heading: {fontFamily: 'DMSans_700Bold', fontSize: 20, color: '#F5EFEA', flex: 1},
  demoBadge: {fontFamily: 'DMSans_500Medium', fontSize: 10, color: '#C2B5B7', marginRight: 2},
  headerButton: {width: 40, height: 44, justifyContent: 'center', alignItems: 'center'},
  controls: {height: 46, flexGrow: 0},
  controlsContent: {paddingHorizontal: 16, gap: 7, alignItems: 'center'},
  chip: {height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center', backgroundColor: '#23201F'},
  chipOn: {backgroundColor: '#EAC4C8'},
  chipText: {fontFamily: 'DMSans_500Medium', fontSize: 11, color: '#BBB2AF'},
  chipTextOn: {color: '#35272C'},
  deck: {flex: 1, marginHorizontal: 14, marginTop: 10, minHeight: 270},
  status: {...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12},
  statusTitle: {fontFamily: 'DMSans_700Bold', fontSize: 19, lineHeight: 26, color: '#F4EEEA', textAlign: 'center', marginTop: 4},
  statusDetail: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 19, color: '#ACA3A1', textAlign: 'center', marginTop: 8},
  stateIcon: {width: 88, height: 88, borderRadius: 44, backgroundColor: '#242020', alignItems: 'center', justifyContent: 'center', marginBottom: 22},
  retry: {minHeight: 46, paddingHorizontal: 25, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EAC4C8', marginTop: 24},
  retryText: {fontFamily: 'DMSans_700Bold', fontSize: 13, color: '#35272C'},
  card: {...StyleSheet.absoluteFill, overflow: 'hidden', borderRadius: 26, backgroundColor: '#272322'},
  activePill: {position: 'absolute', top: 16, left: 16, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1B2522', borderRadius: 16, paddingHorizontal: 11, paddingVertical: 7},
  greenDot: {width: 5, height: 5, borderRadius: 3, backgroundColor: '#71D8A6'},
  activeText: {fontFamily: 'DMSans_500Medium', fontSize: 10, color: '#F1F2ED'},
  profileCopy: {position: 'absolute', bottom: 110, left: 20, right: 20, gap: 7},
  name: {fontFamily: 'DMSans_700Bold', fontSize: 28, color: '#FFF'},
  department: {fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#E0D5D4'},
  intent: {fontFamily: 'DMSans_500Medium', fontSize: 11, color: '#F3CFD6', marginTop: 5},
  cardActions: {position: 'absolute', bottom: 22, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 18},
  cardButton: {width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center'},
  pass: {backgroundColor: '#24211F', borderWidth: 1, borderColor: '#FFFFFF29'},
  like: {backgroundColor: '#FF5A5F'},
  demoFooter: {alignItems: 'center', paddingTop: 14, paddingHorizontal: 12},
  demoNote: {fontFamily: 'DMSans_400Regular', fontSize: 9, lineHeight: 15, color: '#867B7E', textAlign: 'center'},
  showResult: {minHeight: 40, justifyContent: 'center', paddingHorizontal: 16},
  showResultText: {fontFamily: 'DMSans_500Medium', fontSize: 11, color: '#C9AFB5'},
  navigation: {height: 62, marginHorizontal: 14, marginBottom: 8, borderRadius: 31, backgroundColor: '#1C1A1A', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around'},
  navItem: {width: 58, height: 58, alignItems: 'center', justifyContent: 'center', gap: 4},
  navText: {fontFamily: 'DMSans_500Medium', fontSize: 8, color: '#9E999C'},
  navActive: {color: '#F4EEEE'},
  connectionButton: {width: 50, height: 50, borderRadius: 25, backgroundColor: '#FF5A5F', alignItems: 'center', justifyContent: 'center', marginTop: -18},
});
