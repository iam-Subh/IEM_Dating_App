import React, {memo, useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, AppState, Modal, StatusBar, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Ionicons, MaterialCommunityIcons} from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import {useVideoPlayer, VideoView, type VideoPlayer} from 'expo-video';
import {TapChoice, connectionColors as c, connectionStyles as shared} from './ConnectionDesign';
import {recordingTimeLabel} from './profileVideoRecording';
import {VideoPreviewGlow, useVideoGlowFrames} from './VideoPreviewGlow';

// Time updates must not rebuild the native video surface.
const PreviewSurface = memo(function PreviewSurface({player, onFrame, width, height}: {player: VideoPlayer; onFrame: () => void; width: number; height: number}) {
  return <VideoView player={player} style={{width, height, backgroundColor: 'transparent'}} nativeControls={false}
    contentFit="contain" surfaceType="textureView" useExoShutter={false} onFirstFrameRender={onFrame}/>;
});

export function ProfileVideoPreview({uri, visible, onClose}: {uri: string; visible: boolean; onClose: () => void}) {
  // Keep this owner mounted while the source stays selected. Closing the modal
  // releases its surface, but keeps the paused player and its buffer.
  const player = useVideoPlayer({uri, useCaching: /^https?:/.test(uri)}, player => {
    player.loop = false;
    player.muted = true;
    player.timeUpdateEventInterval = 0.2;
    player.bufferOptions = {preferredForwardBufferDuration: 15, minBufferForPlayback: 0.15,
      maxBufferBytes: 64 * 1024 * 1024, prioritizeTimeOverSizeThreshold: false, waitsToMinimizeStalling: false};
    player.seekTolerance = {toleranceBefore: 0.1, toleranceAfter: 0.1};
  });
  const [playing, setPlaying] = useState(player.playing);
  const [muted, setMuted] = useState(player.muted);
  const [ended, setEnded] = useState(false);
  const [time, setTime] = useState(player.currentTime || 0);
  const [duration, setDuration] = useState(player.duration || 0);
  const [status, setStatus] = useState(player.status);
  const [videoSize, setVideoSize] = useState(player.videoTrack?.size || {width: 0, height: 0});
  const [stageSize, setStageSize] = useState({width: 0, height: 0});
  const seeking = useRef(false);
  const resumeAfterSeek = useRef(false);
  const active = useRef(true);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const opened = useRef(false);
  const position = useRef(player.currentTime || 0);
  const pendingSeek = useRef<{time: number; at: number} | null>(null);
  const scrubTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrubTarget = useRef<number | null>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const glowFrames = useVideoGlowFrames(player, duration, hasFrame);
  const [buffering, setBuffering] = useState(false);
  const onFrame = useCallback(() => setHasFrame(true), []);
  const ready = status !== 'error' && duration > 0;

  const cancelScrub = () => {
    if (scrubTimer.current) clearTimeout(scrubTimer.current);
    scrubTimer.current = null;
    scrubTarget.current = null;
  };

  useEffect(() => {
    if (visible && !opened.current) {opened.current = true; player.play();}
    if (!visible) {
      player.pause();
      cancelScrub();
      seeking.current = false;
      resumeAfterSeek.current = false;
      player.scrubbingModeOptions = {scrubbingModeEnabled: false};
    }
  }, [visible, player]);

  useEffect(() => {
    setBuffering(false);
    if (!visible || status !== 'loading') return;
    // Brief decoder seeks retain the visible frame without flashing a loader.
    const timer = setTimeout(() => setBuffering(true), 350);
    return () => clearTimeout(timer);
  }, [visible, status]);

  useEffect(() => {
    active.current = true;
    setStatus(player.status);
    setDuration(player.duration || 0);
    setPlaying(player.playing);
    const subscriptions = [
      player.addListener('playingChange', event => {
        setPlaying(event.isPlaying);
        if (event.isPlaying) setEnded(false);
      }),
      player.addListener('statusChange', event => setStatus(event.status)),
      player.addListener('sourceLoad', event => {
        setDuration(event.duration);
        const size = player.videoTrack?.size || event.availableVideoTracks[0]?.size;
        if (size) setVideoSize(size);
      }),
      player.addListener('videoTrackChange', event => {if (event.videoTrack) setVideoSize(event.videoTrack.size);}),
      player.addListener('timeUpdate', event => {
        if (seeking.current) return;
        const pending = pendingSeek.current;
        if (pending && Math.abs(event.currentTime - pending.time) > 0.5 && Date.now() - pending.at < 1500) return;
        pendingSeek.current = null;
        position.current = event.currentTime;
        setTime(event.currentTime);
      }),
      player.addListener('playToEnd', () => {
        if (seeking.current) return;
        // An end event queued before a backward seek must not reset that seek.
        const pending = pendingSeek.current;
        if (pending && pending.time < player.duration - 0.5 && player.currentTime < player.duration - 0.5 && Date.now() - pending.at < 1500) return;
        player.pause();
        player.currentTime = 0;
        position.current = 0;
        pendingSeek.current = {time: 0, at: Date.now()};
        setPlaying(false);
        setEnded(true);
        setTime(0);
      }),
    ];
    const appState = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        resumeAfterSeek.current = false;
        cancelScrub();
        seeking.current = false;
        player.scrubbingModeOptions = {scrubbingModeEnabled: false};
        player.pause();
      }
    });
    return () => {
      active.current = false;
      cancelScrub();
      subscriptions.forEach(subscription => subscription.remove());
      appState.remove();
    };
  }, [player]);

  const close = () => {
    cancelScrub();
    seeking.current = false;
    resumeAfterSeek.current = false;
    player.scrubbingModeOptions = {scrubbingModeEnabled: false};
    player.pause();
    onClose();
  };
  const togglePlay = () => {
    if (!ready || !visibleRef.current) return;
    if (player.playing) player.pause();
    else {
      if (duration > 0 && position.current >= duration) {
        player.currentTime = 0;
        position.current = 0;
        pendingSeek.current = {time: 0, at: Date.now()};
        setTime(0);
        setEnded(false);
      }
      player.play();
    }
  };
  const seek = (value: number) => {
    const target = Math.max(0, Math.min(value, duration));
    player.currentTime = target;
    position.current = target;
    pendingSeek.current = {time: target, at: Date.now()};
    setTime(target);
    setEnded(false);
  };
  const skip = (seconds: number) => {if (ready) seek(position.current + seconds);};
  const scrub = (value: number) => {
    if (!seeking.current) return;
    position.current = value;
    setTime(value);
    scrubTarget.current = value;
    if (scrubTimer.current) return;
    // Coalesce rapid drag events. Decode the latest requested frame every 80 ms.
    scrubTimer.current = setTimeout(() => {
      scrubTimer.current = null;
      const target = scrubTarget.current;
      scrubTarget.current = null;
      if (target !== null && seeking.current) seek(target);
    }, 80);
  };
  const retry = async () => {
    setStatus('loading');
    try {
      await player.replaceAsync(uri);
      if (active.current) {setEnded(false); setTime(0); position.current = 0; if (visibleRef.current) player.play();}
    } catch {if (active.current) setStatus('error');}
  };

  const ratio = videoSize.width > 0 && videoSize.height > 0 ? videoSize.width / videoSize.height : 9 / 16;
  const videoWidth = Math.min(stageSize.width, stageSize.height * ratio);
  const videoHeight = videoWidth / ratio;

  return <Modal visible={visible} animationType="slide" onRequestClose={close}>
    <SafeAreaView style={s.page} edges={['top', 'bottom']}>
    <StatusBar barStyle="dark-content" backgroundColor={c.canvas}/>
    <View style={s.header}>
      <View style={s.heading}>
        <Text style={s.eyebrow}>Profile preview</Text>
        <Text accessibilityRole="header" style={s.title}>Your introduction</Text>
      </View>
      <TapChoice accessibilityRole="button" accessibilityLabel="Close video preview" onPress={close}
        style={({pressed}) => [s.close, pressed && shared.pressed]}><Ionicons name="close" size={22} color={c.text}/></TapChoice>
    </View>
    <View style={s.stage} onLayout={event => {
      const {width, height} = event.nativeEvent.layout;
      setStageSize(current => current.width === width && current.height === height ? current : {width, height});
    }}>
      <VideoPreviewGlow frames={glowFrames} duration={duration} time={time}/>
      <PreviewSurface player={player} onFrame={onFrame} width={videoWidth} height={videoHeight}/>
      <TapChoice accessibilityRole="button" accessibilityLabel={ended ? 'Replay video' : playing ? 'Pause video' : 'Play video'}
        disabled={!ready} onPress={togglePlay} style={StyleSheet.absoluteFill}>
        {ready && !playing && !seeking.current && <View pointerEvents="none" style={s.centerControl}>
          <View style={s.centerPlay}><Ionicons name={ended ? 'refresh' : 'play'} size={28} color="#FFF"/></View>
          <Text style={s.centerLabel}>{ended ? 'Watch again' : 'Play video'}</Text>
        </View>}
      </TapChoice>
      {!hasFrame && (status === 'idle' || status === 'loading') && <View style={s.loading} pointerEvents="none">
        <ActivityIndicator color="#EEDDE3"/><Text style={s.loadingText}>Loading video…</Text>
      </View>}
      {hasFrame && buffering && <View style={s.bufferBadge} pointerEvents="none"><ActivityIndicator size="small" color="#FFF"/><Text style={s.bufferText}>Buffering…</Text></View>}
      {status === 'error' && <View style={s.loading}>
        <Ionicons name="videocam-outline" size={30} color="#EEDDE3"/>
        <Text style={s.loadingText}>Could not play this video.</Text>
        <TapChoice accessibilityRole="button" accessibilityLabel="Retry video playback" onPress={() => void retry()}
          style={({pressed}) => [s.retry, pressed && shared.pressed]}><Text style={s.whiteText}>Try again</Text></TapChoice>
      </View>}
    </View>
    <View style={s.controls}>
      <View style={s.timeRow}>
        <Text style={s.time}>{recordingTimeLabel(Math.max(0, Math.min(time, duration || time)))}</Text>
        <Text style={s.playbackState}>{seeking.current ? 'Seeking' : ended ? 'Ready to replay' : buffering ? 'Buffering' : playing ? 'Playing' : 'Paused'}</Text>
        <Text style={s.time}>{recordingTimeLabel(duration)}</Text>
      </View>
      <Slider style={s.slider} minimumValue={0} maximumValue={duration || 1} value={Math.min(time, duration || 1)}
        disabled={!ready || duration <= 0} minimumTrackTintColor={c.primary} maximumTrackTintColor="#E6DADF" thumbTintColor={c.primary}
        tapToSeek accessibilityLabel="Video playback position"
        onSlidingStart={() => {
          seeking.current = true; resumeAfterSeek.current = player.playing; player.pause();
          player.seekTolerance = {toleranceBefore: 0.15, toleranceAfter: 0.15};
          player.scrubbingModeOptions = {scrubbingModeEnabled: true};
        }}
        onValueChange={scrub}
        onSlidingComplete={value => {
          cancelScrub();
          player.seekTolerance = {toleranceBefore: 0, toleranceAfter: 0};
          seek(value);
          player.scrubbingModeOptions = {scrubbingModeEnabled: false};
          seeking.current = false;
          if (resumeAfterSeek.current && value < duration && visibleRef.current) player.play();
          resumeAfterSeek.current = false;
          player.seekTolerance = {toleranceBefore: 0.1, toleranceAfter: 0.1};
        }}/>
      <View style={s.transport}>
        <TapChoice accessibilityRole="button" accessibilityLabel={ended ? 'Replay video' : playing ? 'Pause video' : 'Play video'}
          disabled={!ready} onPress={togglePlay} style={({pressed}) => [s.playButton, !ready && s.disabled, pressed && shared.pressed]}>
          <Ionicons name={ended ? 'refresh' : playing ? 'pause' : 'play'} size={22} color="#FFF"/>
        </TapChoice>
        <TapChoice accessibilityRole="button" accessibilityLabel="Go back 10 seconds" disabled={!ready || duration <= 0}
          onPress={() => skip(-10)} style={({pressed}) => [s.skip, (!ready || duration <= 0) && s.disabled, pressed && shared.pressed]}>
          <MaterialCommunityIcons name="rewind-10" size={25} color={c.primary}/>
        </TapChoice>
        <TapChoice accessibilityRole="button" accessibilityLabel="Go forward 10 seconds" disabled={!ready || duration <= 0}
          onPress={() => skip(10)} style={({pressed}) => [s.skip, (!ready || duration <= 0) && s.disabled, pressed && shared.pressed]}>
          <MaterialCommunityIcons name="fast-forward-10" size={25} color={c.primary}/>
        </TapChoice>
        <TapChoice accessibilityRole="button" accessibilityLabel={muted ? 'Turn video sound on' : 'Turn video sound off'}
          onPress={() => {player.muted = !muted; setMuted(!muted);}} style={({pressed}) => [s.sound, pressed && shared.pressed]}>
          <Ionicons name={muted ? 'volume-mute-outline' : 'volume-high-outline'} size={20} color={c.primary}/>
          <Text style={s.soundText}>{muted ? 'Sound off' : 'Sound on'}</Text>
        </TapChoice>
      </View>
    </View>
    <View style={s.footer}>
      <TapChoice accessibilityRole="button" accessibilityLabel="Done previewing video" onPress={close}
        style={({pressed}) => [s.done, pressed && shared.pressed]}><Text style={s.whiteText}>Done</Text><Ionicons name="checkmark" size={18} color="#FFF"/></TapChoice>
    </View>
  </SafeAreaView></Modal>;
}

const s = StyleSheet.create({
  page: {flex: 1, backgroundColor: c.canvas},
  header: {paddingHorizontal: 22, paddingTop: 8, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 12},
  heading: {flex: 1},
  eyebrow: {fontFamily: 'DMSans_500Medium', fontSize: 11, lineHeight: 16, color: c.muted},
  title: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 30, lineHeight: 36, paddingBottom: 3, color: c.text},
  close: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center'},
  stage: {flex: 1, minHeight: 0, marginHorizontal: 18, borderRadius: 26, overflow: 'hidden', backgroundColor: '#302832', alignItems: 'center', justifyContent: 'center'},
  centerControl: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10},
  centerPlay: {width: 64, height: 64, borderRadius: 32, backgroundColor: '#251C24B5', alignItems: 'center', justifyContent: 'center'},
  centerLabel: {fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#FFF', backgroundColor: '#251C24B5', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14},
  loading: {...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center', backgroundColor: '#302832C0', gap: 12},
  loadingText: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 20, color: '#EEDDE3'},
  bufferBadge: {position: 'absolute', top: 14, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: '#251C24B5'},
  bufferText: {fontFamily: 'DMSans_400Regular', fontSize: 11, color: '#FFF'},
  retry: {minHeight: 44, borderRadius: 22, backgroundColor: c.primary, paddingHorizontal: 20, justifyContent: 'center', marginTop: 4},
  controls: {marginHorizontal: 18, marginTop: 12, padding: 12, borderRadius: 22, backgroundColor: '#FFF'},
  timeRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4},
  time: {fontFamily: 'DMSans_500Medium', fontVariant: ['tabular-nums'], fontSize: 12, lineHeight: 18, color: c.text},
  playbackState: {fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 18, color: c.muted},
  slider: {width: '100%', height: 32},
  transport: {flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2},
  playButton: {width: 48, height: 48, borderRadius: 24, backgroundColor: c.primary, justifyContent: 'center', alignItems: 'center'},
  skip: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#F6EEF1', justifyContent: 'center', alignItems: 'center'},
  sound: {flex: 1, minHeight: 44, paddingHorizontal: 8, borderRadius: 22, backgroundColor: '#F6EEF1', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5},
  soundText: {fontFamily: 'DMSans_500Medium', fontSize: 11, color: c.primary, flexShrink: 1},
  footer: {paddingHorizontal: 24, paddingTop: 12, paddingBottom: 12},
  done: {alignSelf: 'center', minWidth: 132, minHeight: 50, borderRadius: 25, paddingHorizontal: 26, backgroundColor: c.primary, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8},
  whiteText: {fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FFF'},
  disabled: {opacity: 0.4},
});
