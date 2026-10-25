import React, { useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
  AppState,
  Pressable,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  cancelAnimation,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { discardDraftMedia } from '../draftMedia';
import { AudioStudioModule, useAudioRecorder } from '@siteed/audio-studio';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../../core/theme/colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import type { ComposerDraft } from '../composerDraft';
import type { SendOrigin } from '../chatSendMotion';

const EMPTY_SUBSCRIBE = () => () => undefined;
const RECORDING_CONFIG = {
  sampleRate: 16000, channels: 1, encoding: 'pcm_16bit', enableProcessing: true,
  intervalAnalysis: 120, segmentDurationMs: 120, keepFullAnalysis: false,
} as const;

const VoiceDraftPreview = ({ uri, durationSec, onDelete, onSend, onSendOrigin }: { uri: string; durationSec: number; onDelete: () => void; onSend: () => void; onSendOrigin?: (origin: SendOrigin) => void }) => {
  const player = useAudioPlayer(uri, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const seconds = Math.floor(status.currentTime || durationSec);
  const total = Math.max(1, Math.floor(status.duration || durationSec));
  return <View style={styles.previewRow}>
    <TouchableOpacity onPress={onDelete} style={styles.deleteBtn}><Ionicons name="trash-outline" size={22} color="#EF4444" /></TouchableOpacity>
    <TouchableOpacity onPress={() => { void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); status.playing ? player.pause() : player.play(); }} style={styles.previewPlay}><Ionicons name={status.playing ? 'pause' : 'play'} size={19} color="#fff" /></TouchableOpacity>
    <View style={styles.previewTrack}><View style={[styles.previewProgress, { width: `${Math.min(100, seconds * 100 / total)}%` }]} /></View>
    <Text style={styles.previewTime}>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</Text>
    <TouchableOpacity onPress={event => { onSendOrigin?.({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY, capturedAt: Date.now() }); onSend(); }} style={styles.sendButton}><Ionicons name="send" size={16} color="#fff" /></TouchableOpacity>
  </View>;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface VoiceRecordBarProps {
  text: string;
  draft?: ComposerDraft;
  setText: (value: string) => void;
  onSend: () => void;
  onSendOrigin?: (origin: SendOrigin) => void;
  onPickImage: () => void;
  onToggleEmoji: () => void;
  showEmoji: boolean;
  isSending: boolean;
  replyPreview?: React.ReactNode;
  editMode?: boolean;
  canSaveEdit?: boolean;
  onVoiceBusyChange?: (busy: boolean) => void;
  onSendVoiceNote: (uri: string, durationSec: number) => void;
  onFocus?: () => void;
  onInputTouch?: () => void;
  onRecordingActivity?: (active: boolean) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export const VoiceRecordBar = React.forwardRef<TextInput, VoiceRecordBarProps>(
  (
    {
      text: renderedText,
      draft,
      setText,
      onSend,
      onSendOrigin,
      onPickImage,
      onToggleEmoji,
      showEmoji,
      isSending,
      replyPreview,
      editMode = false,
      canSaveEdit = true,
      onVoiceBusyChange,
      onSendVoiceNote,
      onFocus,
      onInputTouch,
      onRecordingActivity,
    },
    ref
  ) => {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const mountedRef = useRef(true);
  // Our own handle on the input too, to measure it on send; the parent keeps its ref.
  const inputRef = useRef<TextInput | null>(null);

  const setInputRef = useCallback((node: TextInput | null) => {
    inputRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);
  const text = useSyncExternalStore(draft?.subscribe ?? EMPTY_SUBSCRIBE, draft?.getSnapshot ?? (() => renderedText));
  const {
    prepareRecording,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    isRecording,
    isPaused,
    analysisData,
  } = useAudioRecorder();

  useEffect(() => {
    if (!isRecording || isPaused || !onRecordingActivity) return;
    onRecordingActivity(true);
    const timer = setInterval(() => onRecordingActivity(true), 3000);
    return () => { clearInterval(timer); onRecordingActivity(false); };
  }, [isRecording, isPaused, onRecordingActivity]);

  // Track file URI across the recording lifecycle
  const fileUriRef = useRef<string | null>(null);
  // Guard against double-start / race conditions
  const busyRef = useRef(false);
  const micGrantedRef = useRef(false);
  const preparedRef = useRef(false);
  const preparationRef = useRef<Promise<void> | null>(null);
  const [starting, setStarting] = React.useState(false);
  const canPrepareSafely = typeof AudioStudioModule.releasePreparedRecording === 'function';
  // The native recorder duration can restart after resume on Android. Keep a
  // monotonic active-time clock for the composer and the sent voice duration.
  const accumulatedDurationMsRef = useRef(0);
  const activeStartedAtRef = useRef<number | null>(null);
  const recordingSessionActiveRef = useRef(false);
  const [elapsedRecordingMs, setElapsedRecordingMs] = React.useState(0);
  const [recordedDraft, setRecordedDraft] = React.useState<{ uri: string; durationSec: number } | null>(null);
  useEffect(() => {
    onVoiceBusyChange?.(starting || isRecording || isPaused || Boolean(recordedDraft));
  }, [starting, isRecording, isPaused, recordedDraft, onVoiceBusyChange]);

  const prepareMicrophone = useCallback(async () => {
    if (!focusedRef.current || busyRef.current || recordingSessionActiveRef.current || recordedDraft) return;
    if (!micGrantedRef.current) micGrantedRef.current = (await getRecordingPermissionsAsync()).granted;
    if (!mountedRef.current || !focusedRef.current || busyRef.current || !micGrantedRef.current || !canPrepareSafely || preparedRef.current || preparationRef.current) return;
    // Allocate the recorder without starting microphone capture.
    preparationRef.current = prepareRecording(RECORDING_CONFIG)
      .then(() => { preparedRef.current = true; })
      .catch(() => { preparedRef.current = false; })
      .finally(() => { preparationRef.current = null; });
    await preparationRef.current;
  }, [canPrepareSafely, prepareRecording, recordedDraft]);

  const releasePreparation = useCallback(() => {
    void (preparationRef.current ?? Promise.resolve()).then(async () => {
      if (!canPrepareSafely || busyRef.current || recordingSessionActiveRef.current) return;
      preparedRef.current = false;
      await AudioStudioModule.releasePreparedRecording();
    }).catch(() => undefined);
  }, [canPrepareSafely]);

  useEffect(() => {
    if (focused && !starting && !isRecording && !isPaused) void prepareMicrophone().catch(() => undefined);
    if (!focused) releasePreparation();
  }, [focused, starting, isRecording, isPaused, prepareMicrophone, releasePreparation]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      micGrantedRef.current = false;
      if (state === 'active') void prepareMicrophone().catch(() => undefined);
    });
    return () => listener.remove();
  }, [prepareMicrophone]);
  const [selection, setSelection] = React.useState({ start: 0, end: 0 });
  const hasTextSelection = selection.end > selection.start;

  const formatSelection = useCallback((prefix: string, suffix = prefix) => {
    if (!hasTextSelection) return;
    const selected = text.slice(selection.start, selection.end);
    const next = `${text.slice(0, selection.start)}${prefix}${selected}${suffix}${text.slice(selection.end)}`;
    setText(next);
    setSelection({ start: selection.start + prefix.length, end: selection.end + prefix.length });
  }, [hasTextSelection, selection.end, selection.start, setText, text]);

  // ── Blinking red dot animation ──
  const blinkOpacity = useSharedValue(1);

  useEffect(() => {
    if (isRecording && !isPaused) {
      blinkOpacity.value = withRepeat(
        withSequence(
          withTiming(0.15, { duration: 450 }),
          withTiming(1, { duration: 450 }),
        ),
        -1, // infinite
        true,
      );
    } else {
      cancelAnimation(blinkOpacity);
      blinkOpacity.value = withTiming(1, { duration: 200 });
    }
  }, [isRecording, isPaused]);

  const blinkStyle = useAnimatedStyle(() => ({ opacity: blinkOpacity.value }));

  const readElapsedRecordingMs = useCallback(() => {
    const activeStartedAt = activeStartedAtRef.current;
    return accumulatedDurationMsRef.current
      + (activeStartedAt === null ? 0 : Math.max(0, Date.now() - activeStartedAt));
  }, []);

  const resetRecordingClock = useCallback(() => {
    accumulatedDurationMsRef.current = 0;
    activeStartedAtRef.current = null;
    setElapsedRecordingMs(0);
  }, []);

  const freezeRecordingClock = useCallback(() => {
    const elapsedMs = readElapsedRecordingMs();
    accumulatedDurationMsRef.current = elapsedMs;
    activeStartedAtRef.current = null;
    setElapsedRecordingMs(elapsedMs);
    return elapsedMs;
  }, [readElapsedRecordingMs]);

  useEffect(() => {
    if (!isRecording || isPaused || activeStartedAtRef.current === null) return;

    const updateElapsed = () => setElapsedRecordingMs(readElapsedRecordingMs());
    updateElapsed();
    const timer = setInterval(updateElapsed, 200);
    return () => clearInterval(timer);
  }, [isPaused, isRecording, readElapsedRecordingMs]);

  // ── Cleanup on unmount ──
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (recordingSessionActiveRef.current) {
        stopRecording().catch(() => {});
      } else releasePreparation();
    };
  }, [stopRecording, releasePreparation]);

  // ── Helpers ──
  const formatDuration = (totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const currentDurationSec = Math.floor(elapsedRecordingMs / 1000);

  const requestMicPermission = useCallback(async (): Promise<boolean> => {
    try {
      const { status } = await requestRecordingPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Microphone access is needed to record voice notes.');
        return false;
      }
      micGrantedRef.current = true;
      return true;
    } catch {
      Alert.alert('Error', 'Could not request microphone permission.');
      return false;
    }
  }, []);

  // ── Actions ──
  const handleStart = useCallback(async () => {
    if (busyRef.current || isRecording || isPaused) return;
    busyRef.current = true;
    setStarting(true);

    try {
      const granted = micGrantedRef.current || await requestMicPermission();
      if (!granted) return;
      if (preparationRef.current) await preparationRef.current;
      if (!mountedRef.current || !focusedRef.current) return;
      preparedRef.current = false;
      const result = await startRecording(RECORDING_CONFIG);
      if (!mountedRef.current || !focusedRef.current) {
        const stopped = await stopRecording();
        if (stopped?.fileUri ?? result?.fileUri) void discardDraftMedia((stopped?.fileUri ?? result?.fileUri)!);
        return;
      }

      if (result?.fileUri) {
        fileUriRef.current = result.fileUri;
      }
      accumulatedDurationMsRef.current = 0;
      activeStartedAtRef.current = Date.now();
      recordingSessionActiveRef.current = true;
      setElapsedRecordingMs(0);

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (err) {
      console.error('[VoiceRecordBar] Start failed:', err);
      Alert.alert('Error', 'Failed to start recording.');
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setStarting(false);
    }
  }, [isRecording, isPaused, startRecording, stopRecording, requestMicPermission]);

  const handlePause = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const elapsedMs = freezeRecordingClock();
    try {
      await pauseRecording();
    } catch (err) {
      accumulatedDurationMsRef.current = elapsedMs;
      activeStartedAtRef.current = Date.now();
      console.error('[VoiceRecordBar] Pause failed:', err);
    } finally {
      busyRef.current = false;
    }
  }, [freezeRecordingClock, pauseRecording]);

  const handleResume = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await resumeRecording();
      activeStartedAtRef.current = Date.now();
      setElapsedRecordingMs(accumulatedDurationMsRef.current);
    } catch (err) {
      console.error('[VoiceRecordBar] Resume failed:', err);
    } finally {
      busyRef.current = false;
    }
  }, [resumeRecording]);

  const handleDelete = useCallback(async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    try {
      await stopRecording();
    } catch {
      // may already be stopped
    }
    recordingSessionActiveRef.current = false;
    resetRecordingClock();
    // Clean up the staged recording. FileSystem.deleteAsync is a legacy stub
    // that throws on the current SDK, so this previously reclaimed nothing.
    if (fileUriRef.current) {
      void discardDraftMedia(fileUriRef.current);
      fileUriRef.current = null;
    }
    if (recordedDraft?.uri) void discardDraftMedia(recordedDraft.uri);
    setRecordedDraft(null);
  }, [recordedDraft, resetRecordingClock, stopRecording]);

  const handleStopForPreview = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const durationSec = Math.max(1, Math.floor(freezeRecordingClock() / 1000));
    try {
      const result = await stopRecording();
      const uri = result?.fileUri ?? fileUriRef.current;
      if (uri) setRecordedDraft({ uri, durationSec });
      fileUriRef.current = null;
    } finally {
      recordingSessionActiveRef.current = false;
      resetRecordingClock();
      busyRef.current = false;
    }
  }, [freezeRecordingClock, resetRecordingClock, stopRecording]);

  useEffect(() => {
    if ((isRecording || isPaused) && currentDurationSec >= 60) void handleStopForPreview();
  }, [currentDurationSec, handleStopForPreview, isPaused, isRecording]);

  const handleSend = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const duration = Math.max(1, Math.floor(freezeRecordingClock() / 1000));

    try {
      const result = await stopRecording();
      const uri = result?.fileUri ?? fileUriRef.current;

      if (uri) {
        onSendVoiceNote(uri, duration);
      } else {
        console.warn('[VoiceRecordBar] No file URI after stopping');
      }
    } catch (err) {
      console.error('[VoiceRecordBar] Send failed:', err);
    } finally {
      fileUriRef.current = null;
      recordingSessionActiveRef.current = false;
      resetRecordingClock();
      busyRef.current = false;
    }
  }, [freezeRecordingClock, onSendVoiceNote, resetRecordingClock, stopRecording]);

  // ── Derived state ──
  const showRecordingUI = starting || isRecording || isPaused;
  const usesReplyShape = Boolean(replyPreview) && !showRecordingUI && !recordedDraft;
  const isMicMode = !editMode && !text.trim();

  // ── Waveform bars from analysisData ──
  const waveformBars = React.useMemo(
    () => (analysisData?.dataPoints ?? [])
      .slice(-24)
      .map(point => Math.max(4, Math.min(30, (point.amplitude ?? 0) * 30))),
    [analysisData],
  );
  const material = (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.solidMaterial, usesReplyShape && styles.materialWithReply]} />
  );

  // ── Render ──
  return (
    <View style={[
      styles.container,
      { paddingBottom: Math.max(insets.bottom, 6) },
    ]}>
      {/* ────── IDLE STATE ────── */}
      {!showRecordingUI && !recordedDraft && (
        <View style={[styles.idleRow, usesReplyShape && styles.idleRowWithReply]}>
          {material}
          {replyPreview}
          {hasTextSelection ? <View style={styles.formatBar}>
            <TouchableOpacity style={styles.formatAction} onPress={() => formatSelection('**')} accessibilityLabel="Bold selected text"><Text style={styles.formatBold}>B</Text></TouchableOpacity>
            <TouchableOpacity style={styles.formatAction} onPress={() => formatSelection('__')} accessibilityLabel="Italic selected text"><Text style={styles.formatItalic}>I</Text></TouchableOpacity>
            <TouchableOpacity style={styles.formatAction} onPress={() => formatSelection('`')} accessibilityLabel="Code selected text"><Text style={styles.formatCode}>&lt;/&gt;</Text></TouchableOpacity>
            <TouchableOpacity style={styles.formatAction} onPress={() => formatSelection('||')} accessibilityLabel="Hide selected text as spoiler"><Ionicons name="eye-off-outline" size={18} color="#fff" /></TouchableOpacity>
          </View> : null}
          <View style={[styles.inputWrapper, usesReplyShape && styles.inputWrapperWithReply]}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={showEmoji ? 'Close emoji keyboard' : 'Open emoji keyboard'}
              activeOpacity={0.65}
              onPress={onToggleEmoji}
              style={styles.composerIcon}
            >
              <Ionicons
                name={showEmoji ? 'keypad-outline' : 'happy-outline'}
                size={24}
                color={showEmoji ? colors.primary : '#929096'}
              />
            </TouchableOpacity>
            <TextInput
              ref={setInputRef}
              style={styles.textInput}
              placeholder={editMode ? 'Edit message' : 'Message'}
              accessibilityLabel={editMode ? 'Edit message text' : 'Message'}
              placeholderTextColor="#8E8E93"
              value={text}
              onChangeText={setText}
              onSelectionChange={(event) => {
                const next = event.nativeEvent.selection;
                setSelection(previous => previous.start === previous.end && next.start === next.end ? previous : next);
              }}
              multiline
              maxLength={editMode ? 2000 : undefined}
              editable={!editMode || !isSending}
              textAlignVertical="center"
              onFocus={onFocus}
              onTouchStart={onInputTouch}
            />

            {!editMode && <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Attach photos"
              activeOpacity={0.65}
              onPress={onPickImage}
              style={styles.composerIcon}
            >
              <Ionicons name="attach-outline" size={25} color="#929096" />
            </TouchableOpacity>}
            {isMicMode ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Record a voice message"
                unstable_pressDelay={0}
                onPress={handleStart}
                style={styles.actionButton}
              >
                <Ionicons name="mic" size={23} color="#FFF" />
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={editMode ? 'Save message edit' : 'Send message'}
                accessibilityState={{ disabled: isSending || (editMode && !canSaveEdit), busy: isSending }}
                unstable_pressDelay={0}
                onPress={event => {
                  if (!editMode) {
                    // Where the typed text sits: the sent bubble rises from here.
                    const field: { rect: { x: number; y: number; width: number; height: number } | null } = { rect: null };
                    inputRef.current?.measureInWindow((x, y, width, height) => { field.rect = { x, y, width, height }; });
                    onSendOrigin?.({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY, capturedAt: Date.now(), field, text });
                  }
                  onSend();
                }}
                disabled={isSending || (editMode && !canSaveEdit)}
                style={[styles.actionButton, editMode && styles.editSaveButton, (isSending || (editMode && !canSaveEdit)) && styles.actionButtonDisabled]}
              >
                {editMode && isSending ? <ActivityIndicator size="small" color="#352329" />
                  : <Ionicons name={editMode ? 'checkmark' : 'send'} size={editMode ? 25 : 19} color={editMode ? '#352329' : '#FFF'} style={!editMode ? styles.sendIcon : undefined} />}
              </Pressable>
            )}
          </View>
        </View>
      )}

      {/* ────── RECORDING STATE ────── */}
      {showRecordingUI && (
        <View style={styles.recordingRow}>
          {material}
          {/* Delete */}
          <TouchableOpacity disabled={starting} onPress={handleDelete} style={styles.deleteBtn}>
            <Ionicons name="trash-outline" size={22} color="#EF4444" />
          </TouchableOpacity>

          {/* Timer */}
          <View style={styles.timerBlock}>
            {!starting && <Animated.View style={[styles.redDot, blinkStyle]} />}
            <Text style={styles.timerText}>{starting ? 'Starting…' : formatDuration(currentDurationSec)}</Text>
          </View>

          {/* Live Waveform */}
          <View style={styles.waveformContainer}>
            {waveformBars.map((height, i) => (
              <View key={i} style={[styles.waveBar, { height }]} />
            ))}
          </View>

          {/* Pause / Resume */}
          {isPaused ? (
            <TouchableOpacity disabled={starting} onPress={handleResume} style={styles.resumeBtn}>
              <Ionicons name="mic" size={18} color={colors.primary} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity disabled={starting} onPress={handlePause} style={styles.pauseBtn}>
              <Ionicons name="pause" size={18} color="#FFF" />
            </TouchableOpacity>
          )}

          <TouchableOpacity disabled={starting} onPress={() => void handleStopForPreview()} style={styles.stopBtn} accessibilityLabel="Stop and preview recording">
            <Ionicons name="stop" size={16} color="#fff" />
          </TouchableOpacity>

          {/* Send */}
          <TouchableOpacity disabled={starting} onPress={event => { onSendOrigin?.({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY, capturedAt: Date.now() }); void handleSend(); }} style={styles.sendButton}>
            <Ionicons name="send" size={16} color="#FFF" style={{ marginLeft: 2 }} />
          </TouchableOpacity>
        </View>
      )}
      {recordedDraft ? <VoiceDraftPreview uri={recordedDraft.uri} durationSec={recordedDraft.durationSec} onDelete={() => void handleDelete()} onSendOrigin={onSendOrigin} onSend={() => { onSendVoiceNote(recordedDraft.uri, recordedDraft.durationSec); setRecordedDraft(null); }} /> : null}
    </View>
  );
});

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 6,
    paddingRight: 3,
    paddingTop: 6,
    backgroundColor: 'transparent',
    minHeight: 48,
  },

  // ── Idle ──
  idleRow: {
    flexDirection: 'column',
    borderRadius: 24,
    overflow: 'hidden',
    flex: 1,
  },
  idleRowWithReply: {
    borderTopLeftRadius: 13,
    borderTopRightRadius: 13,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    minHeight: 48,
    backgroundColor: 'transparent',
    borderRadius: 24,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  inputWrapperWithReply: {
    borderTopLeftRadius: 13,
    borderTopRightRadius: 13,
  },
  textInput: {
    flex: 1,
    color: '#FFF',
    fontSize: 17,
    lineHeight: 21,
    minHeight: 44,
    maxHeight: 126,
    includeFontPadding: false,
    paddingHorizontal: 2,
    paddingTop: 11.5,
    paddingBottom: 11.5,
  },
  composerIcon: {
    width: 38,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButton: {
    width: 40,
    height: 40,
    // Center the circle in the 44-point inner row; retain bottom anchoring as text grows.
    marginBottom: 2,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  editSaveButton: { backgroundColor: '#F3C1CA' },
  sendIcon: {
    marginLeft: 2,
  },

  // ── Recording ──
  recordingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    height: 48,
    minHeight: 48,
    paddingLeft: 8,
    paddingRight: 4,
    borderRadius: 24,
    overflow: 'hidden',
  },
  solidMaterial: { backgroundColor: '#1C1C1C', borderRadius: 24 },
  materialWithReply: { borderTopLeftRadius: 13, borderTopRightRadius: 13 },
  deleteBtn: {
    padding: 6,
    marginRight: 4,
  },
  timerBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 6,
  },
  redDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    marginRight: 6,
  },
  timerText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  waveformContainer: {
    flex: 1,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 6,
    overflow: 'hidden',
  },
  waveBar: {
    width: 3,
    borderRadius: 1.5,
    backgroundColor: colors.primary,
    marginHorizontal: 1,
  },

  // ── Buttons ──
  pauseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#3A3A3C',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  resumeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2C2C2E',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  formatBar: { height: 38, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.10)' },
  formatAction: { minWidth: 36, height: 30, paddingHorizontal: 8, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.10)', alignItems: 'center', justifyContent: 'center' },
  formatBold: { color: '#fff', fontSize: 17, fontWeight: '800' },
  formatItalic: { color: '#fff', fontSize: 17, fontStyle: 'italic' },
  formatCode: { color: '#fff', fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  stopBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#3A3A3C', alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  previewRow: { flex: 1, height: 48, borderRadius: 24, backgroundColor: '#1C1C1C', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5 },
  previewPlay: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  previewTrack: { flex: 1, height: 3, backgroundColor: '#47454A', borderRadius: 2, marginHorizontal: 10, overflow: 'hidden' },
  previewProgress: { height: '100%', backgroundColor: colors.primary },
  previewTime: { color: '#B8B6BD', fontSize: 12, marginRight: 8, fontVariant: ['tabular-nums'] },
  micButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
