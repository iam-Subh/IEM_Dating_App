import React, { useCallback, useEffect, useRef, useState } from 'react';
import { completeProfileUpload, explicitUploadMessage, tellBeingChecked } from '../../../features/safety/mediaCheck';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Video as VideoCompressor } from 'react-native-compressor';
import { File as FileSystemFile, UploadType as FileSystemUploadType } from 'expo-file-system';
import { api } from '../../../services/api';
import { updateUser } from '../../../store/authSlice';
import type { RootState } from '../../../store';
import { videoExtFromAsset } from '../../../utils/mediaFileExt';
import { settingsPalette as palette } from '../../../core/settings/SettingsLayout';
import { createVideoSourceRequest, takeVideoSource, type ProfileVideoSource } from './profileVideoSourceRequests';
import { ProfileVideoPlayer } from './ProfileVideoPlayer';

/**
 * The profile video in Edit profile: see it, play it, replace it. It cannot
 * be removed - a video is required, as onboarding requires it (the server
 * refuses an empty one too).
 *
 * The same pipeline as onboarding - compress on the phone, upload straight to
 * storage, confirm, then `PUT /profile { profileVideoUrl }` - after which the
 * server makes the playback copy and poster. A change saves at once, like
 * Instagram's, so it never waits on the photos' Save.
 */

/** Onboarding records up to 60 seconds; a picked video is held to the same. */
const MAX_SECONDS = 60;

type Status = 'none' | 'processing' | 'ready' | 'failed';
type VideoState = { status: Status; url: string | null; posterUrl: string | null };
type Busy = { stage: 'compressing' | 'uploading' | 'saving'; percent: number } | null;

export function ProfileVideoSection({ onLayout }: { onLayout?: (event: LayoutChangeEvent) => void } = {}) {
  const navigation = useNavigation<any>();
  const dispatch = useDispatch();
  const savedVideoUrl = useSelector((state: RootState) => state.auth.user?.profileVideoUrl as string | undefined);
  const [video, setVideo] = useState<VideoState | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [playing, setPlaying] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const sourceRequest = useRef<string | null>(null);
  const picker = useRef<((source: ProfileVideoSource) => Promise<void>) | null>(null);
  const dismissalFallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishSourceSheet = useCallback(() => {
    if (dismissalFallback.current) clearTimeout(dismissalFallback.current);
    dismissalFallback.current = null;
    const requestId = sourceRequest.current;
    if (!requestId) return;
    sourceRequest.current = null;
    const source = takeVideoSource(requestId);
    if (source) void picker.current?.(source);
  }, []);
  useEffect(() => {
    const unsubscribe = navigation.addListener('transitionEnd', (event: any) => {
      if (!event.data.closing && navigation.isFocused()) finishSourceSheet();
    });
    return () => {
      unsubscribe();
      if (dismissalFallback.current) clearTimeout(dismissalFallback.current);
      if (sourceRequest.current) takeVideoSource(sourceRequest.current);
    };
  }, [navigation, finishSourceSheet]);
  useFocusEffect(useCallback(() => {
    if (sourceRequest.current) {
      // Use transitionEnd first. Allow native dismissal to finish if that event is absent.
      dismissalFallback.current = setTimeout(finishSourceSheet, 350);
    }
    return () => {
      if (dismissalFallback.current) clearTimeout(dismissalFallback.current);
      dismissalFallback.current = null;
    };
  }, [finishSourceSheet]));

  const read = useCallback(async () => {
    setReadFailed(false);
    try {
      const response = await api.get('/profile/video');
      setVideo(response.data.data as VideoState);
    } catch {
      // Keep what is shown; the next focus reads again.
      setReadFailed(true);
    }
  }, []);
  useFocusEffect(useCallback(() => { void read(); }, [read]));

  // Processing happens on the server: check back until it is ready or failed.
  useEffect(() => {
    if (video?.status !== 'processing') return;
    const timer = setInterval(() => void read(), 3000);
    return () => clearInterval(timer);
  }, [video?.status, read]);

  const pick = async (source: 'library' | 'camera') => {
    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', source === 'camera' ? 'Allow the camera to record a video.' : 'Allow access to your videos to choose one.');
      return;
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['videos'],
      videoMaxDuration: MAX_SECONDS,
      quality: 1,
    };
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    // A gallery pick ignores videoMaxDuration on some phones: hold the line here too.
    if (asset.duration && asset.duration / 1000 > MAX_SECONDS + 0.5) {
      Alert.alert('Video too long', `Choose a video of ${MAX_SECONDS} seconds or less, or trim it first.`);
      return;
    }
    await upload(asset.uri);
  };
  picker.current = pick;

  const upload = async (sourceUri: string) => {
    const controller = new AbortController();
    abort.current = controller;
    try {
      setBusy({ stage: 'compressing', percent: 0 });
      let uri = sourceUri;
      try {
        uri = await VideoCompressor.compress(
          sourceUri,
          { compressionMethod: 'auto', minimumFileSizeForCompress: 2 },
          (progress) => setBusy({ stage: 'compressing', percent: Math.round(progress * 100) }),
        );
      } catch {
        // Too small to need it, or the phone could not: send the original.
      }
      if (controller.signal.aborted) return;
      const ext = videoExtFromAsset(uri);
      const presign = await api.post('/upload/presigned-urls', { files: [{ type: 'video', ext }] });
      const ticket = presign.data.data[0];
      setBusy({ stage: 'uploading', percent: 0 });
      const nativeUri = uri.startsWith('file://') ? uri : `file://${uri}`;
      const result = await new FileSystemFile(nativeUri).createUploadTask(ticket.uploadUrl, {
        httpMethod: 'PUT',
        uploadType: FileSystemUploadType.BINARY_CONTENT,
        mimeType: ticket.contentType,
        headers: { 'Content-Type': ticket.contentType },
        signal: controller.signal,
        onProgress: ({ bytesSent, totalBytes }) => {
          if (totalBytes > 0) setBusy({ stage: 'uploading', percent: Math.min(100, Math.round((bytesSent * 100) / totalBytes)) });
        },
      }).uploadAsync();
      if (!result || result.status < 200 || result.status >= 300) throw new Error(`Upload failed (${result?.status})`);
      setBusy({ stage: 'saving', percent: 100 });
      const { review } = await completeProfileUpload(ticket.assetId);
      const saved = await api.put('/profile', { profileVideoUrl: ticket.fileUrl });
      if (saved.data?.data) dispatch(updateUser(saved.data.data));
      if (review) tellBeingChecked('video');
      await read();
    } catch (error: any) {
      if (controller.signal.aborted) return;
      Alert.alert(explicitUploadMessage(error) ? "This video can't be used" : "Couldn't upload the video", error?.response?.data?.message ?? 'Check your connection and try again.');
    } finally {
      if (abort.current === controller) abort.current = null;
      setBusy(null);
    }
  };

  const cancel = () => {
    abort.current?.abort();
    abort.current = null;
    setBusy(null);
  };

  const retry = async () => {
    try {
      const response = await api.post('/profile/video/retry');
      setVideo(response.data.data as VideoState);
    } catch {
      Alert.alert("Couldn't retry", 'Check your connection and try again.');
    }
  };

  // An existing video must not show the empty-state action during the request.
  const status = video?.status ?? (savedVideoUrl ? 'ready' : null);
  const playbackUrl = video?.url || savedVideoUrl;
  const hasVideo = Boolean(playbackUrl || video?.posterUrl) || status === 'processing' || status === 'failed';
  const canPlay = Boolean(playbackUrl) && status !== 'processing' && status !== 'failed';
  const loading = !video && !savedVideoUrl;
  const openChooser = () => {
    if (busy || sourceRequest.current) return;
    const requestId = createVideoSourceRequest();
    sourceRequest.current = requestId;
    navigation.navigate('ProfileVideoSource', { requestId, replacing: hasVideo });
  };

  return (
    <View style={styles.section} onLayout={onLayout}>
      <View style={styles.heading}>
        <Text style={styles.title}>Your video</Text>
        <Text style={styles.limit}>{MAX_SECONDS}s max</Text>
      </View>

      <View style={styles.card}>
        <Pressable
          onPress={() => (canPlay && !busy ? setPlaying(true) : !hasVideo && !loading && !busy ? openChooser() : undefined)}
          disabled={Boolean(busy) || (!canPlay && (hasVideo || loading))}
          style={styles.frame}
          accessibilityRole="button"
          accessibilityLabel={canPlay ? 'Play your profile video' : loading ? 'Loading your profile video' : hasVideo ? 'Your profile video' : 'Add a profile video'}
        >
          {video?.posterUrl ? (
            <Image source={{ uri: video.posterUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : null}
          {busy ? (
            <View style={styles.overlay}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.overlayText}>
                {busy.stage === 'compressing' ? `Preparing ${busy.percent}%` : busy.stage === 'uploading' ? `Uploading ${busy.percent}%` : 'Saving…'}
              </Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${busy.stage === 'saving' ? 100 : busy.percent}%` }]} />
              </View>
            </View>
          ) : canPlay ? (
            <View key="play" style={styles.playButton}>
              <Ionicons name="play" size={26} color="#fff" />
            </View>
          ) : status === 'processing' ? (
            <View style={styles.overlay}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.overlayText}>Preparing video…</Text>
            </View>
          ) : status === 'failed' ? (
            <View style={styles.overlay}>
              <Ionicons name="alert-circle" size={28} color="#FF8C93" />
              <Text style={styles.overlayText}>This video couldn't be processed</Text>
            </View>
          ) : loading || hasVideo ? (
            <View key="loading" style={styles.overlay}>
              {readFailed ? <><Ionicons name="refresh" size={24} color="#fff" /><Text style={styles.overlayText}>Preview unavailable</Text></> : <ActivityIndicator color="#fff" />}
            </View>
          ) : (
            <View key="empty" style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons name="videocam" size={26} color={palette.accent} />
              </View>
              <Text style={styles.emptyText}>Add a video</Text>
            </View>
          )}
        </Pressable>

        <View style={styles.actions}>
          <View>
            <View style={[styles.statusPill, status === 'failed' && styles.statusFailed]}>
              <View style={[styles.statusDot, status === 'ready' && styles.statusReadyDot]} />
              <Text style={styles.badge}>{busy ? 'Updating' : canPlay ? 'Live on your profile' : loading ? (readFailed ? 'Preview unavailable' : 'Loading video') : status === 'processing' ? 'Preparing video' : status === 'failed' ? 'Needs attention' : 'Required'}</Text>
            </View>
            <Text style={styles.cardTitle}>Your profile preview</Text>
            <Text style={styles.hint}>Plays first on your profile.{'\n'}Muted while people browse.</Text>
          </View>
          <View style={styles.actionButtons}>
            {busy ? (
              <ActionButton icon="close" label="Cancel" onPress={cancel} />
            ) : (
              <>
                {status === 'failed' && <ActionButton icon="refresh" label="Retry" onPress={() => void retry()} accent />}
                {loading && readFailed && <ActionButton icon="refresh" label="Reload preview" onPress={() => void read()} accent />}
                {!loading && <ActionButton icon={hasVideo ? 'swap-horizontal' : 'add'} label={hasVideo ? 'Replace video' : 'Add video'} onPress={openChooser} accent />}
              </>
            )}
          </View>
        </View>
      </View>

      {playing && playbackUrl ? <ProfileVideoPlayer url={playbackUrl} posterUrl={video?.posterUrl} onClose={() => setPlaying(false)} /> : null}
    </View>
  );
}

function ActionButton({ icon, label, onPress, accent, danger }: {
  icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; accent?: boolean; danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, accent && styles.actionAccent, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={16} color={danger ? '#FF8C93' : accent ? palette.accentText : '#fff'} />
      <Text style={[styles.actionText, accent && styles.actionTextAccent, danger && styles.actionTextDanger]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 12, marginHorizontal: 16 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
  title: { fontFamily: 'DMSans_500Medium', fontSize: 14, lineHeight: 20, color: '#FFB8C7' },
  limit: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: '#DDD0D5' },
  badge: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: '#FFE2E8', flexShrink: 1 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#493039', alignSelf: 'flex-start' },
  statusFailed: { backgroundColor: '#512E32' },
  statusDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#FFB8C7' },
  statusReadyDot: { backgroundColor: '#91E8B2' },
  cardTitle: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 14, marginTop: 10 },
  hint: { fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 16, color: '#DDD0D5', marginTop: 5 },
  card: { flexDirection: 'row', gap: 14, alignItems: 'stretch', padding: 12, backgroundColor: palette.card, borderRadius: 18 },
  frame: {
    width: 92,
    aspectRatio: 9 / 16,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#232323',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 3,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  overlayText: { color: '#fff', fontSize: 11, fontWeight: '700', textAlign: 'center' },
  overlaySub: { color: '#D8D5DC', fontSize: 10, textAlign: 'center' },
  progressTrack: { width: '80%', height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: palette.accent },
  empty: { alignItems: 'center', gap: 8 },
  emptyIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#493039' },
  emptyText: { color: '#ECEAF0', fontSize: 12, fontWeight: '600' },
  actions: { flex: 1, minWidth: 0, justifyContent: 'space-between', gap: 12, paddingVertical: 2 },
  actionButtons: { gap: 8 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 21,
    backgroundColor: '#3A343A',
  },
  actionAccent: { backgroundColor: palette.accent },
  actionText: { color: '#fff', fontSize: 12, fontFamily: 'DMSans_700Bold', flexShrink: 1 },
  actionTextAccent: { color: palette.accentText },
  actionTextDanger: { color: '#FF8C93' },
  pressed: { opacity: 0.7 },
});
