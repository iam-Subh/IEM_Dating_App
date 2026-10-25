import React, {memo, useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Animated, AppState, Easing, Linking, StatusBar, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import {CameraView, useCameraPermissions, useMicrophonePermissions} from 'expo-camera';
import {useVideoPlayer, VideoView} from 'expo-video';
import {CameraAccessIntroduction} from './CameraAccessIntroduction';
import {TapChoice, connectionColors as c, connectionStyles as shared} from './ConnectionDesign';
import {validProfileVideoDuration} from './profileValues';
import {PROFILE_VIDEO_MAX_SECONDS, PROFILE_VIDEO_MIN_SECONDS, recordingSeconds, recordingTimeLabel} from './profileVideoRecording';

type Props = {onRecord: (uri: string) => void; onCancel: () => void; onLibrary: () => void};
type Phase = 'idle' | 'recording' | 'stopping' | 'review';

// Keep the original camera quality settings. Timer and control updates never
// re-render this surface. All UI overlays are siblings of the native camera.
const CameraSurface = memo(function CameraSurface({cameraRef, onReady, onError}: {cameraRef: React.RefObject<CameraView | null>; onReady: () => void; onError: () => void}) {
  // Save the front-camera video in the same orientation as its native preview.
  // Apply this during capture so playback and uploads keep the same left/right.
  return <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="front" mirror={true} mode="video" onCameraReady={onReady} onMountError={onError}/>;
});

const RecordingClock = memo(function RecordingClock({startedAt, stoppedAt, running, onMinimum, onLimit}: {startedAt: number | null; stoppedAt: number | null; running: boolean; onMinimum: () => void; onLimit: () => void}) {
  const [seconds, setSeconds] = useState(0);
  const [width, setWidth] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const minimumSent = useRef(false);
  const limitSent = useRef(false);
  useEffect(() => {
    minimumSent.current = false; limitSent.current = false;
  }, [startedAt]);
  useEffect(() => {
    const tick = () => setSeconds(recordingSeconds(startedAt, stoppedAt ?? Date.now()));
    tick();
    if (!running || startedAt === null) return;
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [startedAt, stoppedAt, running]);
  useEffect(() => {
    if (seconds >= PROFILE_VIDEO_MIN_SECONDS && !minimumSent.current) {minimumSent.current = true; onMinimum();}
    if (running && seconds >= PROFILE_VIDEO_MAX_SECONDS && !limitSent.current) {limitSent.current = true; onLimit();}
  }, [seconds, running, onMinimum, onLimit]);
  useEffect(() => {
    progress.stopAnimation();
    const elapsed = startedAt === null ? 0 : Math.max(0, (stoppedAt ?? Date.now()) - startedAt);
    progress.setValue(Math.min(1, elapsed / 60000));
    if (running) Animated.timing(progress, {toValue: 1, duration: Math.max(0, 60000 - elapsed), easing: Easing.linear, useNativeDriver: true}).start();
    return () => progress.stopAnimation();
  }, [startedAt, stoppedAt, running, progress]);
  return <View pointerEvents="none" style={s.clock}>
    <View style={s.timeBadge}><View style={[s.dot, running && {backgroundColor: '#EF8AA9'}]}/><Text style={s.time}>{recordingTimeLabel(seconds)}<Text style={s.timeLimit}> / 1:00</Text></Text></View>
    <View style={s.timeline}>
      <View><View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={s.track}><Animated.View style={[s.fill, {transform: [{translateX: progress.interpolate({inputRange: [0, 1], outputRange: [-width, 0]})}]}]}/></View><View style={s.minimumMarker}/></View>
      <View style={s.timeLabels}><Text style={s.timeLabel}>{startedAt === null ? '15 sec minimum' : seconds < 15 ? `${15 - seconds} sec to the minimum` : 'Minimum length reached'}</Text><Text style={s.timeLabel}>60 sec max</Text></View>
    </View>
  </View>;
});

const RecordedPreview = memo(function RecordedPreview({uri, onDuration, onError}: {uri: string; onDuration: (seconds: number) => void; onError: () => void}) {
  const player = useVideoPlayer(uri, player => {player.loop = false; player.muted = false;});
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    if (player.duration > 0) onDuration(player.duration);
    const loaded = player.addListener('sourceLoad', event => onDuration(event.duration));
    const changed = player.addListener('playingChange', event => setPlaying(event.isPlaying));
    const status = player.addListener('statusChange', event => {if (event.status === 'error') onError();});
    return () => {loaded.remove(); changed.remove(); status.remove();};
  }, [player, onDuration, onError]);
  return <>
    <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls={false} contentFit="cover" surfaceType="textureView"/>
    <TapChoice accessibilityRole="button" accessibilityLabel={playing ? 'Pause recorded video' : 'Play recorded video'} onPress={() => {
      if (player.playing) player.pause();
      else {if (player.currentTime >= player.duration - 0.1) player.currentTime = 0; player.play();}
    }} style={[StyleSheet.absoluteFill, s.previewTap]}>{!playing && <View style={s.play}><Ionicons name="play" size={30} color="#FFF"/></View>}</TapChoice>
    <TapChoice accessibilityRole="button" accessibilityLabel={muted ? 'Unmute recorded video' : 'Mute recorded video'} onPress={() => {player.muted = !muted; setMuted(!muted);}} style={s.mute}><Ionicons name={muted ? 'volume-mute-outline' : 'volume-high-outline'} size={21} color="#FFF"/></TapChoice>
  </>;
});

function VideoCapture(p: Props) {
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraView>(null);
  const alive = useRef(true);
  const recording = useRef(false);
  const interrupted = useRef(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [phase, setPhase] = useState<Phase>('idle');
  const [ready, setReady] = useState(false);
  const [guide, setGuide] = useState(true);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [stoppedAt, setStoppedAt] = useState<number | null>(null);
  const [minimumReady, setMinimumReady] = useState(false);
  const [uri, setUri] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [cameraFailed, setCameraFailed] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);
  const startRef = useRef<number | null>(null);
  const phaseRef = useRef(phase); phaseRef.current = phase;

  useEffect(() => {
    alive.current = true;
    const listener = AppState.addEventListener('change', state => {
      const active = state === 'active';
      if (!active) {
        setReady(false);
        if (recording.current) {interrupted.current = true; camera.current?.stopRecording();}
      }
      setForeground(active);
    });
    return () => {alive.current = false; if (recording.current) camera.current?.stopRecording(); listener.remove();};
  }, []);
  const cameraReady = useCallback(() => {setReady(true); setCameraFailed(false);}, []);
  const cameraError = useCallback(() => {setReady(false); setCameraFailed(true); setError('Could not start the camera. Tap Retry camera.');}, []);
  const minimum = useCallback(() => setMinimumReady(true), []);
  const stop = useCallback(() => {
    if (!recording.current || phaseRef.current === 'stopping') return;
    setStoppedAt(Date.now()); setPhase('stopping'); phaseRef.current = 'stopping';
    camera.current?.stopRecording();
  }, []);
  const start = async () => {
    if (!ready || guide || !foreground || recording.current || !camera.current) return;
    recording.current = true; interrupted.current = false;
    startRef.current = Date.now(); setStartedAt(startRef.current); setStoppedAt(null);
    setMinimumReady(false); setError(''); setPhase('recording');
    try {
      const video = await camera.current.recordAsync({maxDuration: PROFILE_VIDEO_MAX_SECONDS});
      if (!alive.current) return;
      if (interrupted.current) {setPhase('idle'); setStartedAt(null); setError('Recording stopped when you left the app. Try again.'); return;}
      if (!video?.uri) {setPhase('idle'); setStartedAt(null); setError('Could not save the recording. Try again.'); return;}
      setStoppedAt(Date.now()); setUri(video.uri); setDuration(null); setReady(false); setPhase('review');
    } catch {
      if (alive.current) {setPhase('idle'); setStartedAt(null); setError(interrupted.current ? 'Recording stopped when you left the app. Try again.' : 'Could not record the video. Try again.');}
    } finally {recording.current = false;}
  };
  const close = () => {alive.current = false; if (recording.current) camera.current?.stopRecording(); p.onCancel();};
  const retake = () => {setUri(null); setDuration(null); setError(''); setStartedAt(null); setStoppedAt(null); setMinimumReady(false); setReady(false); setPhase('idle');};
  const readDuration = useCallback((seconds: number) => {
    setDuration(seconds);
    if (!validProfileVideoDuration(Math.round(seconds * 1000))) setError(seconds < 15 ? 'This video is too short. Retake and record for at least 15 seconds.' : 'This video is too long. Retake and keep it within 60 seconds.');
  }, []);
  const reviewError = useCallback(() => {setError('Could not play this recording. Tap Retake.'); setDuration(null);}, []);
  const reviewing = phase === 'review';
  const busy = phase === 'stopping';
  const valid = duration !== null && validProfileVideoDuration(Math.round(duration * 1000));

  return <View style={s.page}>
    <StatusBar barStyle="dark-content" backgroundColor={c.canvas}/>
    <View style={{flex: 1}} accessibilityElementsHidden={guide} importantForAccessibility={guide ? 'no-hide-descendants' : 'auto'}>
    <View style={[s.header, {paddingTop: insets.top + 8}]}>
      <TapChoice accessibilityRole="button" accessibilityLabel="Close video camera" onPress={close} style={({pressed}) => [s.iconButton, pressed && shared.pressed]}><Ionicons name="close" size={23} color={c.text}/></TapChoice>
      <Text accessibilityRole="header" style={s.headerTitle}>{reviewing ? 'Your video' : 'Your introduction'}</Text>
      <TapChoice disabled={phase !== 'idle'} accessibilityRole="button" accessibilityLabel="Video recording tips" onPress={() => setGuide(true)} style={({pressed}) => [s.iconButton, phase !== 'idle' && {opacity: 0.3}, pressed && shared.pressed]}><Ionicons name="help-outline" size={22} color={c.text}/></TapChoice>
    </View>
    <View style={s.preview}>
      {reviewing && uri ? <RecordedPreview uri={uri} onDuration={readDuration} onError={reviewError}/> : <>
        {foreground && !cameraFailed && <CameraSurface key={cameraKey} cameraRef={camera} onReady={cameraReady} onError={cameraError}/>}
        {!ready && <View style={s.loading}>{cameraFailed ? <TapChoice accessibilityRole="button" accessibilityLabel="Retry camera" onPress={() => {setCameraFailed(false); setError(''); setCameraKey(value => value + 1);}} style={s.retry}><Text style={s.whiteText}>Retry camera</Text></TapChoice> : <><ActivityIndicator color="#EAB4CA"/><Text style={s.loadingText}>{foreground ? 'Opening camera…' : 'Camera paused'}</Text></>}</View>}
        <RecordingClock startedAt={startedAt} stoppedAt={stoppedAt} running={phase === 'recording'} onMinimum={minimum} onLimit={stop}/>
      </>}
      {reviewing && <View pointerEvents="none" style={s.reviewBadge}><Ionicons name="videocam-outline" size={15} color="#FFF"/><Text style={s.whiteText}>{duration === null ? 'Checking video…' : `${recordingTimeLabel(duration)} · Preview`}</Text></View>}
      {phase === 'idle' && ready && <View pointerEvents="none" style={s.framing}><Text style={s.frameText}>Keep your face in the frame.</Text></View>}
    </View>
    <View style={[s.footer, {paddingBottom: Math.max(insets.bottom, 16) + 12}]}>
      {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
      <Text accessibilityLiveRegion="polite" style={s.hint}>{reviewing ? 'Watch it back. Retake it if you want.' : busy ? 'Preparing your preview…' : phase === 'recording' ? minimumReady ? 'Tap stop when you are ready.' : 'Keep going for at least 15 seconds.' : 'Tap record when you are ready.'}</Text>
      {reviewing ? <View style={s.reviewActions}>
        <TapChoice accessibilityRole="button" accessibilityLabel="Retake video" onPress={retake} style={({pressed}) => [s.retake, pressed && shared.pressed]}><Ionicons name="refresh-outline" size={19} color={c.primary}/><Text style={[s.whiteText, {color: c.primary}]}>Retake</Text></TapChoice>
        <TapChoice disabled={!valid} accessibilityRole="button" accessibilityLabel="Use this video" accessibilityState={{disabled: !valid}} onPress={() => {if (uri && valid) p.onRecord(uri);}} style={({pressed}) => [s.use, !valid && {opacity: 0.4}, pressed && shared.pressed]}><Text style={s.useText}>Use video</Text><Ionicons name="arrow-forward" size={19} color="#FFF"/></TapChoice>
      </View> : <View style={s.recordActions}>
        <View style={{width: 60}}/>
        <TapChoice disabled={busy || !ready || guide} accessibilityRole="button" accessibilityLabel={busy ? 'Preparing video' : phase === 'recording' ? 'Stop recording' : 'Start recording'} accessibilityState={{disabled: busy || !ready || guide, busy}} onPress={phase === 'recording' ? stop : () => void start()} style={({pressed}) => [s.record, !ready && {opacity: 0.4}, pressed && shared.pressed]}>
          {busy ? <ActivityIndicator color={c.primary}/> : <View style={[s.recordInner, phase === 'recording' && s.stopInner]}/>}
        </TapChoice>
        <View style={{width: 60}}/>
      </View>}
    </View>
    </View>
    {guide && <View style={s.guideOverlay} accessibilityViewIsModal importantForAccessibility="yes">
      <View style={[s.guideCard, {paddingBottom: Math.max(insets.bottom, 16) + 18}]}>
        <View style={s.guideHeader}><View style={s.guideIcon}><Ionicons name="videocam-outline" size={25} color={c.primary}/></View><TapChoice accessibilityRole="button" accessibilityLabel="Close recording guide" onPress={() => setGuide(false)} style={({pressed}) => [s.guideClose, pressed && shared.pressed]}><Ionicons name="close" size={21} color={c.text}/></TapChoice></View>
        <Text accessibilityRole="header" style={s.guideTitle}>A short introduction.</Text>
        <Text style={s.guideSubtitle}>Say your name and share something you enjoy.</Text>
        <View style={s.guideTip}><Ionicons name="chatbubble-outline" size={18} color={c.primary}/><Text style={s.guideText}>Speak as you normally would. Be yourself.</Text></View>
        <View style={s.guideTip}><Ionicons name="refresh-outline" size={18} color={c.primary}/><Text style={s.guideText}>No pressure. Preview it and retake it if you want.</Text></View>
        <View style={s.guideTip}><Ionicons name="time-outline" size={18} color={c.primary}/><Text style={s.guideText}>Record for 15–60 seconds.</Text></View>
        <TapChoice accessibilityRole="button" accessibilityLabel="Ready to record" onPress={() => setGuide(false)} style={({pressed}) => [s.guideAction, pressed && shared.pressed]}><Text style={shared.nextText}>Ready when you are</Text></TapChoice>
        <Text style={s.guideNote}>Your video will be visible on your profile.</Text>
      </View>
    </View>}
  </View>;
}

export function NativeCameraRecorder(p: Props) {
  const [camera, askCamera, getCamera] = useCameraPermissions();
  const [microphone, askMicrophone, getMicrophone] = useMicrophonePermissions();
  const refresh = useRef({getCamera, getMicrophone}); refresh.current = {getCamera, getMicrophone};
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {if (state === 'active') {void refresh.current.getCamera(); void refresh.current.getMicrophone();}});
    return () => listener.remove();
  }, []);
  if (!camera?.granted || !microphone?.granted) return <CameraAccessIntroduction camera={camera} microphone={microphone} onBack={p.onCancel} onLibrary={p.onLibrary} onAllow={async () => {
    const blocked = (!camera?.granted && camera?.canAskAgain === false) || (!microphone?.granted && microphone?.canAskAgain === false);
    if (blocked) {await Linking.openSettings(); return;}
    const cameraAccess = camera?.granted ? camera : await askCamera();
    const microphoneAccess = microphone?.granted ? microphone : await askMicrophone();
    if (!cameraAccess.granted || !microphoneAccess.granted) return 'Allow camera and microphone access to record, or choose a video from your library.';
  }}/>;
  return <VideoCapture {...p}/>;
}

const fillStyle = {position: 'absolute' as const, top: 0, right: 0, bottom: 0, left: 0};
const s = StyleSheet.create({
  page: {flex: 1, backgroundColor: c.canvas},
  header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 12},
  iconButton: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center'},
  headerTitle: {fontFamily: 'DMSans_700Bold', fontSize: 15, color: c.text},
  preview: {flex: 1, marginHorizontal: 18, borderRadius: 26, overflow: 'hidden', backgroundColor: '#3E313C'},
  loading: {...fillStyle, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3E313C'},
  loadingText: {fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#EEDDE3', marginTop: 12},
  retry: {minHeight: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: '#712C48', justifyContent: 'center'},
  clock: {...fillStyle},
  timeBadge: {position: 'absolute', top: 14, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 20, backgroundColor: '#251C24C9'},
  dot: {width: 7, height: 7, borderRadius: 4, backgroundColor: '#EEDDE3'},
  time: {fontFamily: 'DMSans_700Bold', fontVariant: ['tabular-nums'], fontSize: 14, color: '#FFF'},
  timeLimit: {fontFamily: 'DMSans_400Regular', color: '#E3D2DD'},
  timeline: {position: 'absolute', bottom: 15, left: 14, right: 14, backgroundColor: '#251C24B5', borderRadius: 14, padding: 12},
  track: {height: 4, borderRadius: 2, backgroundColor: '#FFFFFF40', overflow: 'hidden'},
  fill: {...fillStyle, backgroundColor: '#F1B6CF'},
  minimumMarker: {position: 'absolute', left: '25%', top: -3, width: 2, height: 10, backgroundColor: '#FFF', borderRadius: 1},
  timeLabels: {flexDirection: 'row', justifyContent: 'space-between', gap: 6, marginTop: 7},
  timeLabel: {fontFamily: 'DMSans_400Regular', fontSize: 9, lineHeight: 14, color: '#F8ECF2'},
  framing: {position: 'absolute', bottom: 91, alignSelf: 'center', backgroundColor: '#251C2480', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6},
  frameText: {fontFamily: 'DMSans_400Regular', fontSize: 11, color: '#FFF'},
  footer: {paddingHorizontal: 24, paddingTop: 12},
  hint: {textAlign: 'center', fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, color: c.muted, marginBottom: 12},
  recordActions: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  record: {width: 76, height: 76, borderRadius: 38, borderWidth: 3, borderColor: '#AF6C8B', backgroundColor: c.canvas, justifyContent: 'center', alignItems: 'center'},
  recordInner: {width: 58, height: 58, borderRadius: 29, backgroundColor: '#A3416B'},
  stopInner: {width: 27, height: 27, borderRadius: 7, backgroundColor: c.primary},
  error: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, color: '#AE2646', textAlign: 'center', marginBottom: 10},
  previewTap: {justifyContent: 'center', alignItems: 'center'},
  play: {width: 64, height: 64, borderRadius: 32, backgroundColor: '#251C24A0', justifyContent: 'center', alignItems: 'center'},
  mute: {position: 'absolute', bottom: 15, right: 15, width: 42, height: 42, borderRadius: 21, backgroundColor: '#251C24B5', justifyContent: 'center', alignItems: 'center'},
  reviewBadge: {position: 'absolute', top: 14, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#251C24BF', borderRadius: 18, paddingHorizontal: 13, paddingVertical: 8},
  whiteText: {fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#FFF'},
  reviewActions: {flexDirection: 'row', gap: 12},
  retake: {flex: 1, minHeight: 50, borderRadius: 25, borderWidth: 1, borderColor: '#9D7B90', flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center'},
  use: {flex: 1, minHeight: 50, borderRadius: 25, backgroundColor: c.primary, flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center'},
  useText: {fontFamily: 'DMSans_700Bold', fontSize: 14, color: '#FFF'},
  guideOverlay: {...fillStyle, backgroundColor: '#130D169C', justifyContent: 'flex-end'},
  guideCard: {backgroundColor: c.canvas, borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 24},
  guideHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14},
  guideIcon: {width: 48, height: 48, borderRadius: 17, backgroundColor: c.wash, alignItems: 'center', justifyContent: 'center'},
  guideClose: {width: 40, height: 40, borderRadius: 20, backgroundColor: c.wash, alignItems: 'center', justifyContent: 'center'},
  guideTitle: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 32, lineHeight: 38, color: c.text},
  guideSubtitle: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 20, color: c.muted, marginTop: 5, marginBottom: 18},
  guideTip: {flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 14},
  guideText: {flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 19, color: c.text},
  guideAction: {minHeight: 50, borderRadius: 25, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', marginTop: 8},
  guideNote: {fontFamily: 'DMSans_400Regular', fontSize: 10, lineHeight: 16, color: c.muted, textAlign: 'center', marginTop: 10},
});
