import React, { useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
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
import { requestRecordingPermissionsAsync } from 'expo-audio';
import { discardDraftMedia } from '../draftMedia';
import { useAudioRecorder } from '@siteed/audio-studio';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../../../core/theme/colors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface VoiceRecordBarProps {
  text: string;
  setText: (value: string) => void;
  onSend: () => void;
  onPickImage: () => void;
  onToggleEmoji: () => void;
  showEmoji: boolean;
  isSending: boolean;
  onSendVoiceNote: (uri: string, durationSec: number) => void;
  onFocus?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export const VoiceRecordBar = React.forwardRef<TextInput, VoiceRecordBarProps>(
  (
    {
      text,
      setText,
      onSend,
      onPickImage,
      onToggleEmoji,
      showEmoji,
      isSending,
      onSendVoiceNote,
      onFocus,
    },
    ref
  ) => {
  const {
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    isRecording,
    isPaused,
    durationMs,
    analysisData,
  } = useAudioRecorder();

  // Track file URI across the recording lifecycle
  const fileUriRef = useRef<string | null>(null);
  // Guard against double-start / race conditions
  const busyRef = useRef(false);

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

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      if (isRecording || isPaused) {
        stopRecording().catch(() => {});
      }
    };
  }, []);

  // ── Helpers ──
  const formatDuration = (totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const currentDurationSec = Math.floor((durationMs ?? 0) / 1000);

  const requestMicPermission = useCallback(async (): Promise<boolean> => {
    try {
      const { status } = await requestRecordingPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Microphone access is needed to record voice notes.');
        return false;
      }
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

    try {
      const granted = await requestMicPermission();
      if (!granted) return;

      const result = await startRecording({
        sampleRate: 16000, // standard for voice to save space/bandwidth, or keep 44100
        channels: 1,
        encoding: 'pcm_16bit',
        enableProcessing: true,
        intervalAnalysis: 50, // emit analysis every 50ms for smooth live rendering
      });

      if (result?.fileUri) {
        fileUriRef.current = result.fileUri;
      }

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (err) {
      console.error('[VoiceRecordBar] Start failed:', err);
      Alert.alert('Error', 'Failed to start recording.');
    } finally {
      busyRef.current = false;
    }
  }, [isRecording, isPaused, startRecording, requestMicPermission]);

  const handlePause = useCallback(async () => {
    try {
      await pauseRecording();
    } catch (err) {
      console.error('[VoiceRecordBar] Pause failed:', err);
    }
  }, [pauseRecording]);

  const handleResume = useCallback(async () => {
    try {
      await resumeRecording();
    } catch (err) {
      console.error('[VoiceRecordBar] Resume failed:', err);
    }
  }, [resumeRecording]);

  const handleDelete = useCallback(async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    try {
      await stopRecording();
    } catch {
      // may already be stopped
    }
    // Clean up the staged recording. FileSystem.deleteAsync is a legacy stub
    // that throws on the current SDK, so this previously reclaimed nothing.
    if (fileUriRef.current) {
      void discardDraftMedia(fileUriRef.current);
      fileUriRef.current = null;
    }
  }, [stopRecording]);

  const handleSend = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const duration = currentDurationSec;

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
      busyRef.current = false;
    }
  }, [stopRecording, currentDurationSec, onSendVoiceNote]);

  // ── Derived state ──
  const showRecordingUI = isRecording || isPaused;
  const isMicMode = !text.trim();

  // ── Waveform bars from analysisData ──
  const waveformBars = (analysisData?.dataPoints ?? []).slice(-30);

  // ── Render ──
  return (
    <View style={styles.container}>
      {/* ────── IDLE STATE ────── */}
      {!showRecordingUI && (
        <View style={styles.idleRow}>
          <TouchableOpacity onPress={onPickImage} style={styles.plusButton}>
            <Ionicons name="add" size={24} color="#FFF" />
          </TouchableOpacity>

          <View style={styles.inputWrapper}>
            <TextInput
              ref={ref}
              style={styles.textInput}
              placeholder="Your message..."
              placeholderTextColor="#8E8E93"
              value={text}
              onChangeText={setText}
              multiline
              onFocus={onFocus}
            />
            
            <TouchableOpacity onPress={onToggleEmoji} style={styles.emojiInside}>
              <Ionicons
                name="happy-outline"
                size={22}
                color={showEmoji ? colors.primary : '#8E8E93'}
              />
            </TouchableOpacity>
          </View>

          {isMicMode ? (
            <LinearGradient
              colors={['#FF758C', '#F94E27']}
              style={styles.gradientButton}
            >
              <TouchableOpacity onPress={handleStart} style={styles.actionButton}>
                <Ionicons name="mic" size={22} color="#FFF" />
              </TouchableOpacity>
            </LinearGradient>
          ) : (
            <LinearGradient
              colors={['#FF758C', '#F94E27']}
              style={styles.gradientButton}
            >
              <TouchableOpacity
                onPress={onSend}
                disabled={isSending}
                style={[styles.actionButton, isSending && { opacity: 0.5 }]}
              >
                <Ionicons name="send" size={18} color="#FFF" />
              </TouchableOpacity>
            </LinearGradient>
          )}
        </View>
      )}

      {/* ────── RECORDING STATE ────── */}
      {showRecordingUI && (
        <View style={styles.recordingRow}>
          {/* Delete */}
          <TouchableOpacity onPress={handleDelete} style={styles.deleteBtn}>
            <Ionicons name="trash-outline" size={22} color="#EF4444" />
          </TouchableOpacity>

          {/* Timer */}
          <View style={styles.timerBlock}>
            <Animated.View style={[styles.redDot, blinkStyle]} />
            <Text style={styles.timerText}>{formatDuration(currentDurationSec)}</Text>
          </View>

          {/* Live Waveform */}
          <View style={styles.waveformContainer}>
            {waveformBars.map((dp, i) => {
              const h = Math.max(4, (dp.amplitude ?? 0) * 36);
              return <View key={i} style={[styles.waveBar, { height: h }]} />;
            })}
          </View>

          {/* Pause / Resume */}
          {isPaused ? (
            <TouchableOpacity onPress={handleResume} style={styles.resumeBtn}>
              <Ionicons name="mic" size={18} color="#F94E27" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handlePause} style={styles.pauseBtn}>
              <Ionicons name="pause" size={18} color="#FFF" />
            </TouchableOpacity>
          )}

          {/* Send */}
          <TouchableOpacity onPress={handleSend} style={styles.sendButton}>
            <Ionicons name="send" size={16} color="#FFF" />
          </TouchableOpacity>
        </View>
      )}
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
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: '#1E1B1D',
    minHeight: 60,
  },

  // ── Idle ──
  idleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconBtn: {
    marginRight: 10,
  },
  plusButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#242426',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 10 : 4,
    marginRight: 8,
  },
  textInput: {
    flex: 1,
    color: '#FFF',
    fontSize: 16,
    maxHeight: 100,
  },
  emojiInside: {
    marginLeft: 8,
  },
  gradientButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
  },
  actionButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Recording ──
  recordingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  deleteBtn: {
    padding: 6,
    marginRight: 6,
  },
  timerBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
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
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
    overflow: 'hidden',
  },
  waveBar: {
    width: 3,
    borderRadius: 1.5,
    backgroundColor: '#F94E27',
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
    marginRight: 8,
  },
  resumeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2C2C2E',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  micButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F94E27',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F94E27',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
