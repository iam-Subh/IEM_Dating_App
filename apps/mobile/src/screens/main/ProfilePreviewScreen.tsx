import { UnverifiedNudge } from '../../features/verification/VerifyNudge';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Modal, Pressable, ScrollView, StatusBar, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import { useSelector } from 'react-redux';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { cancelAnimation, Easing, type SharedValue, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import type { RootState } from '../../store';
import { ProfileIntentionCard } from '../../components/ProfileIntentionCard';
import { ProfileContentSections } from '../../components/ProfileContentSections';
import { VerifiedBadge } from '../../features/discovery/components/VerifiedBadge';
import { CardVideo, type PlaybackState } from '../../features/discovery/media/CardVideo';
import { useProfileVideoPreview } from './profile/ProfileVideoPreview';
import { ProfileVideoPlayer } from './profile/ProfileVideoPlayer';
import { buildProfilePreview } from './profile/profilePreviewModel';

const PINK = '#F3C1CA';
const noop = () => {};
type VideoPreview = { source: string; playback: string; poster: string | null };

function PreviewGalleryVideo({ source, active, attached, muted, onMute, onPreview, onProgress, navigation }: {
  source: string; active: boolean; attached: boolean; muted: boolean; onMute: () => void;
  onPreview: (preview: VideoPreview) => void;
  onProgress: (time: number, duration: number) => void; navigation: React.ReactNode;
}) {
  const { poster, playback, onPosterError } = useProfileVideoPreview(source);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<PlaybackState>('loading');
  const [retry, setRetry] = useState(0);
  useEffect(() => setReady(false), [playback]);
  useEffect(() => { onPreview({ source, playback: playback || source, poster }); }, [source, playback, poster, onPreview]);
  return <View style={s.photoFill}>
    <CardVideo key={playback || source} uri={playback || source} active={active} foreground={active} attached={attached}
      muted={muted} loop retryToken={retry} style={StyleSheet.absoluteFill}
      onReady={() => setReady(true)} onState={setState} onProgress={onProgress} onFinish={noop} />
    {(!ready || !attached || state === 'error') && <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.videoPlaceholder]}>
      {poster && <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={onPosterError} />}
      {state !== 'error' && attached && <ActivityIndicator color="#fff" />}
    </View>}
    {navigation}
    {state === 'error' && <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, s.videoRetryOverlay]}><Pressable accessibilityRole="button" accessibilityLabel="Retry video" onPress={() => { setReady(false); setRetry(value => value + 1); }} style={s.videoRetry}><Ionicons name="refresh" size={20} color="#fff" /><Text style={s.videoRetryText}>Retry video</Text></Pressable></View>}
    {active && <Pressable accessibilityRole="button" accessibilityLabel={muted ? 'Turn video sound on' : 'Mute video'} onPress={onMute} style={s.videoSound}><Ionicons name={muted ? 'volume-mute-outline' : 'volume-high-outline'} size={20} color="#fff" /></Pressable>}
  </View>;
}

function PreviewMediaProgress({ index, video, selected, progress }: {
  index: number; video: boolean; selected: SharedValue<number>; progress: SharedValue<number>;
}) {
  const fill = useAnimatedStyle(() => ({
    width: `${index < selected.value ? 100 : index === selected.value ? (video ? progress.value * 100 : 100) : 0}%` as `${number}%`,
  }));
  return <View style={s.photoStep}><Animated.View style={[s.photoStepFill, fill]} /></View>;
}

function PreviewPhoto({ uri, label, contain = false }: { uri: string; label: string; contain?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  return <View style={[s.photoFill, contain && s.fullPhotoFill]}>
    {failed ? <View style={s.photoError}><Ionicons name="image-outline" size={32} color="#C9C2BA" /><Text style={s.muted}>Photo unavailable</Text></View>
      : <Image accessibilityLabel={label} accessible source={{ uri }} resizeMode={contain ? 'contain' : 'cover'} style={StyleSheet.absoluteFill} onError={() => setFailed(true)} />}
  </View>;
}

export function ProfilePreviewScreen() {
  const navigation = useNavigation<any>();
  const focused = useIsFocused();
  const profile = useSelector((state: RootState) => state.auth.user);
  const data = useMemo(() => profile ? buildProfilePreview(profile) : null, [profile]);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const photoWidth = Math.max(1, Math.min(width - 32, 568));
  const photoHeight = Math.min(photoWidth * 1.23, 500);
  const gallery = useRef<ScrollView>(null);
  const thumbnails = useRef<ScrollView>(null);
  const [mediaIndex, setMediaIndex] = useState(0);
  const selectedMedia = useRef(0);
  const galleryDragging = useRef(false);
  const progressIndex = useSharedValue(0);
  const videoProgress = useSharedValue(0);
  const [expanded, setExpanded] = useState(false);
  const [videoExpanded, setVideoExpanded] = useState(false);
  const [muted, setMuted] = useState(true);
  const [videoPreview, setVideoPreview] = useState<VideoPreview | null>(null);
  const [heroVisible, setHeroVisible] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const closing = useRef(false);
  useFocusEffect(useCallback(() => { closing.current = false; }, []));
  const mediaSignature = JSON.stringify(data?.media ?? []);
  const photoCount = data?.photos.length ?? 0;
  const mediaCount = data?.media.length ?? 0;
  const currentIndex = Math.min(mediaIndex, Math.max(0, mediaCount - 1));
  const currentMedia = data?.media[currentIndex];
  const fullPhotoIndex = currentMedia?.type === 'image' ? currentMedia.photoIndex : 0;
  const videoPoster = videoPreview && videoPreview.source === data?.video ? videoPreview.poster : null;
  const videoPlayback = videoPreview && videoPreview.source === data?.video ? videoPreview.playback : data?.video;
  const updateVideoPreview = useCallback((next: VideoPreview) => {
    setVideoPreview(previous => previous?.source === next.source && previous.playback === next.playback && previous.poster === next.poster ? previous : next);
  }, []);
  const updateVideoProgress = useCallback((time: number, duration: number) => {
    if (selectedMedia.current !== 0 || duration <= 0) return;
    const ratio = Math.max(0, Math.min(1, time / duration));
    videoProgress.value = ratio < videoProgress.value || reducedMotion
      ? ratio : withTiming(ratio, { duration: 100, easing: Easing.linear });
  }, [videoProgress, reducedMotion]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    selectedMedia.current = 0;
    galleryDragging.current = false;
    progressIndex.value = 0;
    cancelAnimation(videoProgress);
    videoProgress.value = 0;
    setMediaIndex(0);
    setMuted(true);
    gallery.current?.scrollTo({ x: 0, animated: false });
    thumbnails.current?.scrollTo({ x: 0, animated: false });
  }, [mediaSignature, progressIndex, videoProgress]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Main', { screen: 'Profile' });
  }, [navigation]);
  const edit = () => {
    if (closing.current || !profile) return;
    closing.current = true;
    navigation.navigate('EditProfile', { profile, section: undefined });
  };
  const selectMedia = (index: number, animate = true) => {
    const next = Math.min(Math.max(0, index), Math.max(0, mediaCount - 1));
    selectedMedia.current = next;
    progressIndex.value = next;
    galleryDragging.current = false;
    setMediaIndex(next);
    gallery.current?.scrollTo({ x: next * photoWidth, animated: animate && !reducedMotion && !expanded });
    thumbnails.current?.scrollTo({ x: Math.max(0, next * 62 - photoWidth / 2 + 31), animated: !reducedMotion && !expanded });
  };
  const selectFullPhoto = (index: number) => {
    const next = data?.media.findIndex(item => item.type === 'image' && item.photoIndex === index) ?? -1;
    if (next >= 0) selectMedia(next);
  };
  const mediaTapZones = () => mediaCount > 1 ? <View pointerEvents="box-none" style={s.mediaTapZones}>
    <Pressable accessibilityRole="button" accessibilityLabel="Previous photo or video" disabled={currentIndex === 0}
      onPress={() => selectMedia(selectedMedia.current - 1, false)} style={s.mediaTapZone} />
    <Pressable accessibilityRole="button" accessibilityLabel="Next photo or video" disabled={currentIndex === mediaCount - 1}
      onPress={() => selectMedia(selectedMedia.current + 1, false)} style={s.mediaTapZone} />
  </View> : null;

  return <SafeAreaView edges={['top']} style={s.page}>
    <StatusBar barStyle="light-content" backgroundColor="#100F0D" />
    <View style={s.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close profile preview" onPress={close} style={({ pressed }) => [s.headerClose, pressed && s.pressed]}><Ionicons name="chevron-down" size={25} color="#FFF4F6" /></Pressable>
      <View style={s.flex}><Text accessibilityRole="header" style={s.headerTitle}>Profile preview</Text><Text style={s.headerHint}>Your dating profile</Text></View>
      {profile && <Pressable accessibilityRole="button" accessibilityLabel="Edit your profile" onPress={edit} style={({ pressed }) => [s.edit, pressed && s.pressed]}><MaterialCommunityIcons accessible={false} name="account-edit-outline" size={16} color="#331C23" /><Text style={s.editText}>Edit</Text></Pressable>}
    </View>

    {!data ? <View style={s.unavailable}><Text style={s.sectionTitle}>Profile unavailable</Text><Pressable onPress={close} accessibilityRole="button"><Text style={s.link}>Back to profile</Text></Pressable></View> : <ScrollView showsVerticalScrollIndicator={false} scrollEventThrottle={100} onScroll={event => setHeroVisible(event.nativeEvent.contentOffset.y < photoHeight - 80)} contentContainerStyle={[s.content, { paddingBottom: Math.max(16, insets.bottom) + 12 }]}>
      {/* Reminder 23 (GOOGLE_SIGNUP_PLAN.md 4): how they look without the badge. */}
      <UnverifiedNudge art="badge" text="Others don't see a blue badge on your profile yet." cta="Get it" dismissKey="preview" />
      <View style={[s.hero, { height: mediaCount ? photoHeight : 220 }]}>
        {mediaCount ? <ScrollView ref={gallery} horizontal pagingEnabled directionalLockEnabled showsHorizontalScrollIndicator={false}
          onLayout={() => gallery.current?.scrollTo({ x: currentIndex * photoWidth, animated: false })}
          onScrollBeginDrag={() => { galleryDragging.current = true; }}
          onMomentumScrollEnd={event => {
            if (!galleryDragging.current) return;
            galleryDragging.current = false;
            const index = Math.min(mediaCount - 1, Math.max(0, Math.round(event.nativeEvent.contentOffset.x / photoWidth)));
            selectedMedia.current = index;
            progressIndex.value = index;
            setMediaIndex(index);
            thumbnails.current?.scrollTo({ x: Math.max(0, index * 62 - photoWidth / 2 + 31), animated: !reducedMotion });
          }}>
          {data.media.map((item, index) => <View key={`${item.type}:${item.uri}`} style={{ width: photoWidth, height: photoHeight }}>
            {item.type === 'video' ? <PreviewGalleryVideo source={item.uri} active={focused && foreground && heroVisible && currentIndex === index && !expanded && !videoExpanded} attached={!videoExpanded} muted={muted} onMute={() => setMuted(value => !value)} onPreview={updateVideoPreview} onProgress={updateVideoProgress} navigation={mediaTapZones()} />
              : <><PreviewPhoto uri={item.uri} label={`Profile photo ${item.photoIndex + 1} of ${photoCount}`} />{mediaTapZones()}</>}
          </View>)}
        </ScrollView> : <View style={s.photoError}><Ionicons name="person-outline" size={42} color={PINK} /></View>}
        <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.25)', 'rgba(0,0,0,0.88)']} style={s.heroShade} />
        {mediaCount > 0 && <>
          <View pointerEvents="none" style={s.photoSteps}>{data.media.map((item, index) => <PreviewMediaProgress key={`${item.type}:${item.uri}`} index={index} video={item.type === 'video'} selected={progressIndex} progress={videoProgress} />)}</View>
          <View pointerEvents="none" style={s.photoCount}><Ionicons name={currentMedia?.type === 'video' ? 'videocam-outline' : 'images-outline'} size={13} color="#fff" /><Text style={s.photoCountText}>{currentIndex + 1} / {mediaCount}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel={currentMedia?.type === 'video' ? 'Open video player' : 'View full photo'} onPress={() => currentMedia?.type === 'video' ? setVideoExpanded(true) : setExpanded(true)} style={({ pressed }) => [s.expand, pressed && s.pressed]}><Ionicons name="expand-outline" size={19} color="#fff" /></Pressable>
        </>}
        <View pointerEvents="none" style={s.identity}>
          <View style={s.nameRow}><Text style={s.name}>{data.name}{data.age ? `, ${data.age}` : ''}</Text>{data.verified && <VerifiedBadge size={22} />}</View>
          {data.course ? <Text style={s.heroCourse} numberOfLines={2}>{data.course}</Text> : null}
        </View>
      </View>
      {mediaCount > 1 && <ScrollView ref={thumbnails} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.thumbnails}>
        {data.media.map((item, index) => <Pressable key={`${item.type}:${item.uri}`} accessibilityRole="button" accessibilityLabel={item.type === 'video' ? 'Show profile video' : `Show photo ${item.photoIndex + 1}`} accessibilityState={{ selected: index === currentIndex }} onPress={() => selectMedia(index)} style={[s.thumbnail, index === currentIndex && s.thumbnailActive]}>
          <View style={s.thumbnailImage}>{(item.type === 'image' || videoPoster) && <Image accessible={false} source={{ uri: item.type === 'image' ? item.uri : videoPoster! }} style={StyleSheet.absoluteFill} resizeMode="cover" />}{item.type === 'video' && <View style={s.thumbnailPlay}><Ionicons name="play" size={15} color="#fff" /></View>}</View>
        </Pressable>)}
      </ScrollView>}

      <ProfileIntentionCard value={data.seeking} />
      <ProfileContentSections data={data} showInterestIcons />
      <Pressable accessibilityRole="button" onPress={close} style={({ pressed }) => [s.done, pressed && s.pressed]}><Ionicons name="chevron-down" size={17} color={PINK} /><Text style={s.doneText}>Back to my profile</Text></Pressable>
    </ScrollView>}

    <Modal visible={expanded && photoCount > 0} animationType={reducedMotion ? 'none' : 'fade'} statusBarTranslucent onRequestClose={() => setExpanded(false)}>
      <SafeAreaView style={s.fullPhotoPage}>
        <View style={s.fullPhotoHeader}><Text accessibilityLiveRegion="polite" style={s.fullPhotoCount}>Photo {fullPhotoIndex + 1} / {photoCount}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close full photo" onPress={() => setExpanded(false)} style={s.headerClose}><Ionicons name="close" size={24} color="#fff" /></Pressable></View>
        {data?.photos[fullPhotoIndex] && <PreviewPhoto uri={data.photos[fullPhotoIndex]} contain label={`Full profile photo ${fullPhotoIndex + 1}`} />}
        {photoCount > 1 && <View style={s.fullPhotoControls}><Pressable accessibilityRole="button" accessibilityLabel="Previous photo" disabled={fullPhotoIndex === 0} onPress={() => selectFullPhoto(fullPhotoIndex - 1)} style={[s.photoArrow, fullPhotoIndex === 0 && s.disabled]}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Next photo" disabled={fullPhotoIndex === photoCount - 1} onPress={() => selectFullPhoto(fullPhotoIndex + 1)} style={[s.photoArrow, fullPhotoIndex === photoCount - 1 && s.disabled]}><Ionicons name="chevron-forward" size={22} color="#fff" /></Pressable></View>}
      </SafeAreaView>
    </Modal>
    {videoExpanded && videoPlayback && <ProfileVideoPlayer url={videoPlayback} posterUrl={videoPoster} onClose={() => setVideoExpanded(false)} />}
  </SafeAreaView>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#100F0D' },
  flex: { flex: 1, minWidth: 0 },
  header: { width: '100%', maxWidth: 600, alignSelf: 'center', minHeight: 64, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 8 },
  headerClose: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#222222' },
  headerTitle: { fontFamily: 'DMSans_700Bold', fontSize: 20, lineHeight: 26, color: '#FFF4F6' },
  headerHint: { marginTop: 2, fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#C3BABD' },
  edit: { minHeight: 40, borderRadius: 21, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: PINK },
  editText: { fontFamily: 'DMSans_700Bold', fontSize: 14, color: '#331C23' },
  content: { width: '100%', maxWidth: 600, alignSelf: 'center', paddingHorizontal: 16, gap: 12 },
  hero: { borderRadius: 22, overflow: 'hidden', backgroundColor: '#222222' },
  photoFill: { flex: 1, backgroundColor: '#222222' },
  fullPhotoFill: { backgroundColor: '#100F0D' },
  videoPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#222222' },
  videoSound: { position: 'absolute', right: 10, top: 72, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  videoRetry: { minHeight: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.7)', flexDirection: 'row', alignItems: 'center', gap: 7 },
  videoRetryOverlay: { alignItems: 'center', justifyContent: 'center' },
  videoRetryText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: '#fff' },
  photoError: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  muted: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: '#C9C2BA' },
  heroShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  photoSteps: { position: 'absolute', top: 10, left: 12, right: 12, flexDirection: 'row', gap: 4 },
  photoStep: { flex: 1, height: 3, borderRadius: 2, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.35)' },
  photoStepFill: { height: '100%', backgroundColor: PINK },
  mediaTapZones: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row' },
  mediaTapZone: { flex: 1 },
  photoCount: { position: 'absolute', top: 24, left: 12, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, minHeight: 27, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.5)' },
  photoCountText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#fff' },
  expand: { position: 'absolute', right: 10, top: 20, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  identity: { position: 'absolute', left: 16, right: 16, bottom: 16, gap: 5 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flexShrink: 1, fontFamily: 'DMSans_700Bold', fontSize: 28, lineHeight: 35, color: '#fff' },
  heroCourse: { fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 21, color: '#F1E9E6' },
  thumbnails: { gap: 8 },
  thumbnail: { width: 54, height: 64, padding: 2, borderRadius: 11, borderWidth: 2, borderColor: 'transparent' },
  thumbnailActive: { borderColor: PINK },
  thumbnailImage: { width: '100%', height: '100%', borderRadius: 7, backgroundColor: '#303030', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumbnailPlay: { width: 25, height: 25, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontFamily: 'DMSans_700Bold', fontSize: 17, lineHeight: 23, color: '#FFF4F6' },
  done: { minHeight: 46, padding: 12, borderRadius: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#222222' },
  doneText: { fontFamily: 'DMSans_700Bold', fontSize: 15, color: PINK },
  unavailable: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  link: { fontFamily: 'DMSans_700Bold', fontSize: 16, color: PINK },
  fullPhotoPage: { flex: 1, backgroundColor: '#100F0D' },
  fullPhotoHeader: { paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fullPhotoCount: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#fff' },
  fullPhotoControls: { flexDirection: 'row', justifyContent: 'center', gap: 18, padding: 16 },
  photoArrow: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#303030' },
  disabled: { opacity: 0.3 },
  pressed: { opacity: 0.75 },
});
