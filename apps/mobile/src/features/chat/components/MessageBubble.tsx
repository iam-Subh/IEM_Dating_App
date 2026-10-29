import React, { useState, useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import { useHiddenWords } from '../../safety/hiddenWords';
import { containsHidden, looksHurtful } from '../../safety/hurtfulLanguage';
import { openReport } from '../../safety/ReportSheet';
import { store } from '../../../store';
import { canRaiseToEar, playThroughEarpiece, startProximity, stopEarpiece } from '../../../../modules/chat-notify';
import { reportVoicePlayed } from '../voicePlayed';
import { View, Text, StyleSheet, Dimensions, Image, ActivityIndicator, Alert, TouchableOpacity, Keyboard, Linking, Share, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync, createAudioPlayer } from 'expo-audio';
import Slider from '@react-native-community/slider';
import { useDispatch } from 'react-redux';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { colors } from '../../../core/theme/colors';
import { applyReaction, Message, removeMessage } from '../../../store/chatSlice';
import { canEditMessage } from '../messageEditing';
import { messageSendFailure } from '../messageSendState';
import { chatMarksKey, type MarkedMessage } from '../messageMarks';
import { MessageMarkIcons } from './MessageMarkIcons';
import { StoryReplyCard } from './StoryReplyCard';
import { LinearGradient } from 'expo-linear-gradient';
import { api } from '../../../services/api';
import { ImageModal } from './ImageModal';
import { peekSentMediaUri as sentMediaUri, forgetSentMedia, subscribeSentMedia, resolveCachedMedia } from '../sentMediaCache';
import { localVideoPoster, videoPosterKey } from '../videoPosters';
import { MessageContextMenu } from './MessageContextMenu';
import EmojiPicker from 'rn-emoji-keyboard';
import { ReactionsSheet } from './ReactionsSheet';
import { MESSAGE_LIST_PADDING_H } from '../chatLayout';

/**
 * Longer than this and the bubble collapses behind "Read more".
 *
 * A bubble is ~0.78 of the screen wide at 16px text, so this lands around a
 * dozen lines - long enough that short paragraphs are never interrupted, short
 * enough that a pasted wall of text does not bury the conversation.
 */
const COLLAPSE_THRESHOLD_CHARS = 500;
/** Lines left visible while collapsed. */
const COLLAPSED_LINES = 12;
import { ChatBubbleBackground } from './ChatBubbleBackground';
import Svg, { Circle, Path as SvgPath } from 'react-native-svg';
import { Directory, File as FileSystemFile } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { downloadChatFile, getChatDownload, pauseChatDownload, resumeChatDownload, subscribeChatDownloads } from '../chatDownloads';
import * as Haptics from 'expo-haptics';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useRecyclingState } from '@shopify/flash-list';

const { width } = Dimensions.get('window');
const SWIPE_REPLY_THRESHOLD = 52;
const SWIPE_REPLY_MAX_DISTANCE = 72;

function isVideoMediaKey(key: string) {
  return key.startsWith('local-video-') || /\.mp4(?:$|\?)/i.test(key);
}

function isDocumentMediaKey(key: string) {
  return key.startsWith('local-file-') || /\.(pdf|docx?|xlsx?|pptx?|txt|csv|zip|rar|7z)(?:$|\?)/i.test(key);
}

type DocumentIconName = 'document-text' | 'document' | 'grid' | 'easel' | 'archive';

function documentIconName(fileName?: string, mimeType?: string): DocumentIconName {
  const value = `${fileName ?? ''} ${mimeType ?? ''}`.toLowerCase();
  if (/\.(xls|xlsx)\b|spreadsheet|excel|text\/csv/.test(value)) return 'grid';
  if (/\.(ppt|pptx)\b|presentation|powerpoint/.test(value)) return 'easel';
  if (/\.(zip|rar|7z)\b|zip|compressed|archive/.test(value)) return 'archive';
  if (/\.(doc|docx)\b|wordprocessing|msword/.test(value)) return 'document';
  return 'document-text';
}

function documentFormatLabel(fileName?: string, mimeType?: string): string {
  const extension = fileName?.split('.').pop()?.toUpperCase();
  if (extension && ['PDF', 'DOC', 'DOCX', 'XLS', 'XLSX', 'PPT', 'PPTX', 'TXT', 'CSV', 'ZIP', 'RAR', '7Z'].includes(extension)) {
    return extension;
  }
  if (mimeType === 'text/plain') return 'TXT';
  if (mimeType === 'text/csv') return 'CSV';
  return 'FILE';
}

function localMediaUri(key: string) {
  return key.replace('local-video-', '').replace('local-voice-', '').replace('local-file-', '').replace('local-', '');
}

function formatVideoDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/**
 * The play button and length over a video's poster.
 *
 * Bubbles used to mount a video player each, and a received video was
 * downloaded in full just to be drawn. Like Telegram, a bubble now shows one
 * still frame, and the video streams only when it is opened.
 */
function VideoBadge({ durationMs }: { durationMs?: number }) {
  return (
    <>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.mediaStatus]}>
        <View style={styles.videoPlayBadge}>
          <Ionicons name="play" size={24} color="#fff" style={{ marginLeft: 3 }} />
        </View>
      </View>
      {durationMs ? (
        <View pointerEvents="none" style={styles.videoDurationBadge}>
          <Text style={styles.videoDurationText}>{formatVideoDuration(durationMs)}</Text>
        </View>
      ) : null}
    </>
  );
}

/**
 * The picture in a bubble, kept across recycling.
 *
 * The row this lives in is reused for another message as the list scrolls. It
 * used to be given a key of the picture's own address, which made every reuse
 * tear the image view down and build a new one - and a new view has nothing
 * decoded behind it, so a picture already on the device had to be loaded again
 * from scratch, showing the empty tile each time it came back on screen.
 *
 * Keeping the view and handing it a new address lets the image pipeline answer
 * from what it already has, which for a cached picture is the same frame. The
 * loading state is reset by recycling instead of by remounting.
 */
const WAVE_BAR_WIDTH = 3;
const WAVE_BAR_GAP = 2;
const WAVE_HEIGHT = 26;

/** Rounded bars, left to right, as a single path. */
function waveformBarsPath(heights: number[]): string {
  const radius = WAVE_BAR_WIDTH / 2;
  let path = '';
  for (let index = 0; index < heights.length; index += 1) {
    const height = Math.max(WAVE_BAR_WIDTH, heights[index]);
    const x = index * (WAVE_BAR_WIDTH + WAVE_BAR_GAP);
    const y = (WAVE_HEIGHT - height) / 2;
    const straight = height - WAVE_BAR_WIDTH;
    path += `M${x} ${y + radius}a${radius} ${radius} 0 0 1 ${WAVE_BAR_WIDTH} 0v${straight}a${radius} ${radius} 0 0 1 ${-WAVE_BAR_WIDTH} 0z`;
  }
  return path;
}

function BubbleImage({ uri, onError, children }: { uri: string; onError?: () => void; children?: React.ReactNode }) {
  const [state, setState] = useRecyclingState<'loading' | 'ready' | 'failed'>('loading', [uri]);
  const [attempt, setAttempt] = useRecyclingState(0, [uri]);
  const [showLoading, setShowLoading] = useRecyclingState(false, [uri]);
  useEffect(() => {
    if (state !== 'loading') { setShowLoading(false); return; }
    const timer = setTimeout(() => setShowLoading(true), 180);
    return () => clearTimeout(timer);
  }, [state, attempt]);
  return (
    <View style={styles.image}>
      <Image
        key={attempt}
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        fadeDuration={0}
        onLoad={() => setState('ready')}
        onError={() => { setState('failed'); onError?.(); }}
      />
      {state !== 'failed' ? children : null}
      {state === 'loading' && showLoading ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.mediaStatus]}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : state === 'failed' ? (
        <TouchableOpacity
          style={[StyleSheet.absoluteFill, styles.mediaStatus]}
          accessibilityLabel="Retry image loading"
          onPress={() => { setState('loading'); setAttempt(value => value + 1); }}
        >
          <Ionicons name="refresh" size={24} color="#fff" />
          <Text style={styles.mediaStatusText}>Tap to reload</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function BubbleMedia({ uri, video, document, fileName, durationMs, onError }: { uri: string | null; video: boolean; document?: boolean; fileName?: string; durationMs?: number; onError?: () => void }) {
  if (!uri) return <View style={[styles.image, styles.mediaStatus]}><ActivityIndicator color="#fff" /></View>;
  if (document) {
    return (
      <View style={styles.documentTile}>
        <Ionicons name="document-text" size={38} color="#fff" />
        <Text style={styles.documentName} numberOfLines={2}>{fileName ?? 'PDF document'}</Text>
      </View>
    );
  }
  return (
    <BubbleImage uri={uri} onError={onError}>
      {video ? <VideoBadge durationMs={durationMs} /> : null}
    </BubbleImage>
  );
}

const messageTimeFormatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

function formatMessageTime(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return Number.isFinite(date.getTime()) ? messageTimeFormatter.format(date) : '';
}

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return 'File';
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function messageStatusIcon(message: Pick<Message, 'id' | 'readAt' | 'deliveredAt' | 'localStatus'>) {
  if (message.localStatus === 'failed') return 'alert-circle' as const;
  if (message.id.startsWith('temp-')) return 'time-outline' as const;
  if (message.readAt || message.deliveredAt) return 'checkmark-done' as const;
  return 'checkmark' as const;
}

function messageStatusColor(message: Pick<Message, 'id' | 'readAt' | 'deliveredAt' | 'localStatus'>) {
  if (message.localStatus === 'failed') return '#FFD1D1';
  if (message.id.startsWith('temp-')) return 'rgba(255,255,255,0.42)';
  if (message.readAt) return 'rgba(255,255,255,0.98)';
  return message.deliveredAt ? 'rgba(255,255,255,0.76)' : 'rgba(255,255,255,0.62)';
}

function richMessageText(value: string, revealed: Set<number>, reveal: (index: number) => void): React.ReactNode[] {
  const token = /(https?:\/\/[^\s<>{}\[\]]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\+?[0-9][0-9 ()-]{7,}[0-9]|\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\|\|[^|]+\|\|)/gi;
  const parts = value.split(token);
  return parts.map((part, index) => {
    if (/^https?:\/\//i.test(part)) {
      const trailing = part.match(/[),.!?]+$/)?.[0] ?? '';
      const url = trailing ? part.slice(0, -trailing.length) : part;
      return <React.Fragment key={`${url}-${index}`}><Text style={styles.messageLink} onPress={() => void Linking.openURL(url)}>{url}</Text>{trailing}</React.Fragment>;
    }
    if (/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/i.test(part)) return <Text key={index} style={styles.messageLink} onPress={() => void Linking.openURL(`mailto:${part}`)}>{part}</Text>;
    if (/^\+?[0-9][0-9 ()-]{7,}[0-9]$/.test(part)) return <Text key={index} style={styles.messageLink} onPress={() => void Linking.openURL(`tel:${part.replace(/[^+\d]/g, '')}`)}>{part}</Text>;
    if (part.startsWith('**') && part.endsWith('**')) return <Text key={index} style={styles.messageBold}>{part.slice(2, -2)}</Text>;
    if (part.startsWith('__') && part.endsWith('__')) return <Text key={index} style={styles.messageItalic}>{part.slice(2, -2)}</Text>;
    if (part.startsWith('`') && part.endsWith('`')) return <Text key={index} style={styles.messageCode}>{part.slice(1, -1)}</Text>;
    if (part.startsWith('||') && part.endsWith('||')) {
      const visible = revealed.has(index);
      return <Text key={index} onPress={() => reveal(index)} style={visible ? styles.messageSpoilerVisible : styles.messageSpoilerHidden}>{visible ? part.slice(2, -2) : '██████'}</Text>;
    }
    return part;
  });
}

const VoicePlayerBubble = ({ 
  resolveUri,
  isMe, 
  initialDuration, 
  sentAt, 
  messageId,
  readAt,
  deliveredAt,
  playedAt,
  matchId,
  localStatus,
  waveform,
  onLongPress,
  transfer,
  starred,
  pinned,
}: { 
  resolveUri: () => Promise<string | null>;
  isMe: boolean; 
  initialDuration?: string; 
  sentAt?: string; 
  messageId?: string; 
  readAt?: string | null; 
  deliveredAt?: string | null;
  playedAt?: string | null;
  matchId?: string;
  localStatus?: Message['localStatus'];
  waveform?: number[];
  onLongPress?: () => void;
  transfer?: {
    progress: number;
    status: string;
    onPress: () => void;
  };
  starred?: boolean;
  pinned?: boolean;
}) => {
  const playerRef = React.useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const subscriptionRef = React.useRef<{ remove(): void } | null>(null);
  // Raise to ear (MESSAGE_NOTIFICATIONS_PLAN.md 7): the sensor while playing, and the earpiece while at the ear.
  const sourceRef = React.useRef<string | null>(null);
  const proximityRef = React.useRef<{ remove(): void } | null>(null);
  const earpieceRef = React.useRef<{ remove(): void } | null>(null);
  const atEarRef = React.useRef(false);
  const rateRef = React.useRef(1);
  const stopEar = React.useCallback(() => {
    proximityRef.current?.remove();
    proximityRef.current = null;
    if (atEarRef.current) stopEarpiece();
    earpieceRef.current?.remove();
    earpieceRef.current = null;
    atEarRef.current = false;
  }, []);
  const startEar = React.useCallback(() => {
    if (!canRaiseToEar || proximityRef.current || !sourceRef.current) return;
    proximityRef.current = startProximity((near) => {
      const player = playerRef.current;
      const source = sourceRef.current;
      if (!player || !source) return;
      if (near && player.playing && !atEarRef.current) {
        // Held to the ear: the same place, through the earpiece.
        atEarRef.current = true;
        player.pause();
        earpieceRef.current = playThroughEarpiece(source, player.currentTime * 1000, rateRef.current, () => {
          atEarRef.current = false;
          earpieceRef.current?.remove();
          earpieceRef.current = null;
          void player.seekTo(0).catch(() => {});
          proximityRef.current?.remove();
          proximityRef.current = null;
        });
      } else if (!near && atEarRef.current) {
        // Away from the ear: back to the speaker where it got to.
        atEarRef.current = false;
        const position = stopEarpiece();
        earpieceRef.current?.remove();
        earpieceRef.current = null;
        void player.seekTo(position / 1000).then(() => player.play()).catch(() => {});
      }
    });
  }, []);
  const mountedRef = React.useRef(true);
  const busyRef = React.useRef(false);
  const pendingSeekRef = React.useRef(0);
  const [preparing, setPreparing] = useState(false);
  const [status, setStatus] = useState({ playing: false, duration: 0, currentTime: 0 });
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      subscriptionRef.current?.remove();
      stopEar();
      playerRef.current?.setActiveForLockScreen?.(false);
      playerRef.current?.remove();
      playerRef.current = null;
    };
  }, [stopEar]);
  const initialDurationMs = initialDuration ? parseFloat(initialDuration) * 1000 : 0;
  const isPlaying = status.playing;
  const durationMs = status.duration > 0 ? status.duration * 1000 : initialDurationMs;
  const positionMs = status.currentTime * 1000;
  const [playbackRate, setPlaybackRate] = useState(1);
  const [waveformWidth, setWaveformWidth] = useState(0);

  const handlePlayPause = React.useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setPreparing(true);
    try {
      // Keeps playing with the screen off or the app in the background, with
      // lock-screen controls (MESSAGE_NOTIFICATIONS_PLAN.md 7).
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' });
      if (!mountedRef.current) return;
      let player = playerRef.current;
      if (!player) {
        const source = await resolveUri();
        if (!mountedRef.current || !source) return;
        sourceRef.current = typeof source === 'string' ? source : null;
        player = createAudioPlayer(source, { updateInterval: 100 });
        player.setPlaybackRate(playbackRate);
        playerRef.current = player;
        subscriptionRef.current = player.addListener('playbackStatusUpdate', next => {
          if (!mountedRef.current) return;
          setStatus(next);
          if (next.didJustFinish) {
            void playerRef.current?.seekTo(0).catch(() => {});
            playerRef.current?.setActiveForLockScreen?.(false);
            if (!atEarRef.current) stopEar();
          }
        });
      }
      if (pendingSeekRef.current > 0) {
        await player.seekTo(pendingSeekRef.current);
        pendingSeekRef.current = 0;
      }
      if (!mountedRef.current) return;
      if (player.playing) {
        player.pause();
        stopEar();
      } else {
        player.setActiveForLockScreen?.(true, { title: 'Voice message', artist: 'IEM Connect' });
        player.play();
        startEar();
        // Their first listen: the sender's microphone turns blue.
        if (!isMe && !playedAt && matchId && messageId) reportVoicePlayed(matchId, messageId);
      }
    } catch {
      if (mountedRef.current) Alert.alert('Playback failed', 'Tap Play to retry.');
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setPreparing(false);
    }
  }, [resolveUri, playbackRate, isMe, playedAt, matchId, messageId, startEar, stopEar]);

  const handleSeek = React.useCallback(async (value: number) => {
    if (!playerRef.current) {
      pendingSeekRef.current = value / 1000;
      setStatus(current => ({ ...current, currentTime: value / 1000 }));
      return;
    }
    try { await playerRef.current.seekTo(value / 1000); } catch {}
  }, []);

  const formatTime = (millis: number) => {
    const totalSec = Math.floor(millis / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const fallbackHeights = [
    10, 16, 12, 18, 24, 14, 20, 16, 22, 18, 14, 12, 18, 14, 20, 16, 24, 12, 16, 
    10, 18, 22, 16, 20, 12, 18, 14, 24, 16, 14, 18, 12, 20, 16, 10
  ];
  const sourceHeights = waveform?.length ? waveform.map((value) => 6 + Math.round(value * 20)) : fallbackHeights;
  const initialWaveformWidth = width * 0.75 - 20 - 42 - 14;
  const waveformTrackWidth = Math.max(1, (waveformWidth || initialWaveformWidth) - 34);
  const maximumBars = Math.max(1, Math.floor(waveformTrackWidth / 5));
  const barHeights = sourceHeights.length <= maximumBars
    ? sourceHeights
    : Array.from({ length: maximumBars }, (_, index) => {
        const start = Math.floor(index * sourceHeights.length / maximumBars);
        const end = Math.max(start + 1, Math.floor((index + 1) * sourceHeights.length / maximumBars));
        return Math.max(...sourceHeights.slice(start, end));
      });

  /**
   * The waveform as one drawing rather than a view per bar.
   *
   * Every bar used to be its own View with its own inline style - around forty
   * of them for a single voice message, built again every time the row was
   * bound to a message. A row that expensive cannot be built within the frame a
   * fling allows, which is what left blanks behind a fast scroll. These are two
   * paths into one canvas: the whole waveform, then the played part over it.
   */
  const barsKey = barHeights.join(',');
  // The heights are rebuilt on each render; their values are what matter.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const wavePath = React.useMemo(() => waveformBarsPath(barHeights), [barsKey]);
  const playedBars = durationMs > 0
    ? Math.round(Math.min(1, positionMs / durationMs) * barHeights.length)
    : 0;
  const playedPath = React.useMemo(
    () => (playedBars > 0 ? waveformBarsPath(barHeights.slice(0, playedBars)) : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [barsKey, playedBars],
  );
  const waveWidth = Math.max(1, barHeights.length * (WAVE_BAR_WIDTH + WAVE_BAR_GAP));

  const handleWaveformPress = (evt: any) => {
    const x = evt.nativeEvent.locationX;
    const pct = Math.min(Math.max(x / waveformTrackWidth, 0), 1);
    const targetMs = pct * durationMs;
    void handleSeek(targetMs);
  };

  return (
    <View
      style={[
        styles.voiceContainer,
        { 
          width: width * 0.75, 
          paddingVertical: 12,
          alignItems: 'center',
        },
      ]}
    >
      <TouchableOpacity
        onPress={transfer ? transfer.onPress : handlePlayPause}
        onLongPress={onLongPress}
        delayLongPress={250}
        accessibilityRole="button"
        accessibilityLabel={transfer
          ? (transfer.status === 'failed' || transfer.status === 'cancelled' ? 'Retry voice message' : 'Cancel voice message upload')
          : (isPlaying ? 'Pause voice message' : 'Play voice message')}
        style={{
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: isMe ? 'rgba(255,255,255,0.25)' : '#3A3A3C',
        justifyContent: 'center',
        alignItems: 'center',
        paddingLeft: !transfer && !isPlaying ? 3 : 0,
      }}>
        {transfer && transfer.status !== 'failed' && transfer.status !== 'cancelled' ? (
          <Svg width={42} height={42} style={StyleSheet.absoluteFill}>
            <Circle cx={21} cy={21} r={17} fill="none" stroke="rgba(255,255,255,0.30)" strokeWidth={2.5} />
            <Circle
              cx={21}
              cy={21}
              r={17}
              fill="none"
              stroke="#35D07F"
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 17} ${2 * Math.PI * 17}`}
              strokeDashoffset={2 * Math.PI * 17 * (1 - Math.max(0, Math.min(100, transfer.progress)) / 100)}
              rotation={-90}
              origin="21, 21"
            />
          </Svg>
        ) : null}
        {preparing && !transfer ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons
          name={transfer
            ? (transfer.status === 'failed' || transfer.status === 'cancelled' ? 'refresh' : 'close')
            : (isPlaying ? 'pause' : 'play')}
          size={20}
          color={isMe ? '#FFF' : colors.primary}
        />}
      </TouchableOpacity>
      
      <View
        onLayout={(event) => setWaveformWidth(event.nativeEvent.layout.width)}
        style={styles.voiceWaveformArea}
      >
        <TouchableOpacity 
          activeOpacity={0.8} 
          onPress={handleWaveformPress} 
          onLongPress={onLongPress}
          delayLongPress={250}
          style={styles.voiceWaveformTrack}
        >
          <Svg width={waveWidth} height={WAVE_HEIGHT}>
            <SvgPath d={wavePath} fill={isMe ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.15)'} />
            {playedPath ? <SvgPath d={playedPath} fill={isMe ? '#FFF' : colors.primary} /> : null}
          </Svg>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        onPress={() => {
          const next = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
          playerRef.current?.setPlaybackRate(next);
          rateRef.current = next;
          setPlaybackRate(next);
        }}
        onLongPress={onLongPress}
        delayLongPress={250}
        style={styles.voiceRate}
        accessibilityLabel={`Playback speed ${playbackRate} times`}
      >
        <Text style={styles.voiceRateText}>{playbackRate}×</Text>
      </TouchableOpacity>

      {/* Inline Time & Tick for Voice Note */}
      <View style={{ 
        position: 'absolute', 
        bottom: 3,
        left: 68, 
        right: 5,
        flexDirection: 'row', 
        justifyContent: 'space-between',
        alignItems: 'center' 
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Text style={{ fontSize: 11, color: isMe ? '#FFF' : colors.text.secondary, fontWeight: '500' }}>
            {formatTime(positionMs > 0 ? positionMs : durationMs)}
          </Text>
          {/* WhatsApp's microphone: blue once they listened; ours stands out until we have. */}
          <Ionicons
            name="mic"
            size={12}
            accessibilityLabel={playedAt ? 'Played' : 'Not played yet'}
            color={isMe ? (playedAt ? '#53BDEB' : 'rgba(255,255,255,0.6)') : (playedAt ? colors.text.tertiary : colors.primary)}
          />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <MessageMarkIcons starred={starred} pinned={pinned} color={isMe ? '#FFF' : '#D7B884'} />
          <Text style={{ fontSize: 11, lineHeight: 14, color: isMe ? 'rgba(255,255,255,0.85)' : colors.text.tertiary }}>
            {sentAt ? formatMessageTime(sentAt) : ''}
          </Text>
          {isMe && (
            <Ionicons
              name={messageStatusIcon({ id: messageId ?? '', readAt: readAt ?? null, deliveredAt: deliveredAt ?? null, localStatus })}
              size={messageId?.startsWith('temp-') ? 13 : 16}
              color={messageStatusColor({ id: messageId ?? '', readAt: readAt ?? null, deliveredAt: deliveredAt ?? null, localStatus })}
              style={{ marginLeft: 4 }}
            />
          )}
        </View>
      </View>
    </View>
  );
};

interface MessageBubbleProps {
  /** Avatars of the two people in the chat, so a reaction shows who left it. */
  reactorAvatars?: Record<string, string | null>;
  message: Message;
  isMe: boolean;
  /** Passed down rather than read per row: see the note in the component. */
  currentUserId: string;
  showTime: boolean;
  groupPosition?: 'single' | 'top' | 'middle' | 'bottom';
  onReply?: (message: Message) => void;
  onEdit?: (message: Message) => void;
  starred?: boolean;
  pinned?: boolean;
  replyPreview?: string;
  replyAuthor?: string;
  replyIsDocument?: boolean;
  replyDocumentIcon?: DocumentIconName;
  replyIsVoice?: boolean;
  onRetryMediaUpload?: (messageId: string, itemIndex: number) => void;
  onCancelMediaUpload?: (messageId: string, itemIndex: number) => void;
  onOpenReply?: (messageId: string) => void;
  highlighted?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelection?: (messageId: string) => void;
  onRetryMessage?: (messageId: string) => void;
}

export const MessageBubble = React.memo(({ message, isMe, currentUserId, groupPosition = 'single', onReply, onEdit, starred = false, pinned = false, replyPreview, replyAuthor, replyIsDocument, replyDocumentIcon, replyIsVoice, onRetryMediaUpload, onCancelMediaUpload, onOpenReply, highlighted = false, selectionMode = false, selected = false, onToggleSelection, onRetryMessage, reactorAvatars }: MessageBubbleProps) => {
  const messageTime = formatMessageTime(message.sentAt);
  const textMessageTime = `${message.editedAt ? 'edited · ' : ''}${messageTime}`;
  // Use the known timestamp text instead of mounting with an estimate and then
  // changing the bubble width after onLayout. Virtualized rows now remount at
  // their final width.
  // The small letters in "edited" need less space than timestamp digits.
  const metadataWidth = Math.ceil(messageTime.length * 5.75) + (message.editedAt ? 39 : 0) + (isMe ? 20 : 0) + (Number(starred) + Number(pinned)) * 15;
  const metadataGap = message.editedAt ? 4 : 8;
  const [revealedSpoilers, setRevealedSpoilers] = useRecyclingState<Set<number>>(() => new Set(), [message.id]);
  const dispatch = useDispatch();
  // Who you are is the same for every row, so it arrives as a prop. Reading it
  // from the store here put a subscription on every bubble, and a chat holds
  // dozens: each one then re-ran its selector on every dispatch, and opening a
  // conversation is a burst of them - the restored page, receipts, each
  // arriving message. The chat screen already knows this, and passes it.

  const [isViewerOpen, setIsViewerOpen] = useRecyclingState(false, [message.id]);
  const [isOptionsOpen, setIsOptionsOpen] = useRecyclingState(false, [message.id]);
  const bubbleRef = React.useRef<View>(null);
  const [anchor, setAnchor] = useRecyclingState<{ x: number; y: number; width: number; height: number } | null>(null, [message.id]);
  const [reactionPending, setReactionPending] = useRecyclingState(false, [message.id]);
  const reactionPendingRef = React.useRef(false);
  const [fullReactionsOpen, setFullReactionsOpen] = useRecyclingState(false, [message.id]);
  const [reactorsOpen, setReactorsOpen] = useRecyclingState(false, [message.id]);
  // Mounted on first use and kept, so its slide-down still plays on close; most
  // bubbles never open it and never pay for its query hook.
  const [reactorsMounted, setReactorsMounted] = useRecyclingState(false, [message.id]);
  const showReactors = () => {
    setReactorsMounted(true);
    setReactorsOpen(true);
  };
  const queryClient = useQueryClient();
  // Bubble indicators arrive from the chat's shared cache. Only the open menu
  // requests this message's current actions, without a query on every row.
  const markKey = ['message-marks', currentUserId, message.matchId, message.id];
  const marking = React.useRef(false);
  const setMark = async (kind: 'star' | 'pin') => {
    if (marking.current) return;
    marking.current = true;
    setIsOptionsOpen(false);
    try {
      const latest = (await api.get(`/chat/${message.matchId}/messages/${message.id}/marks`)).data.data;
      const active = !(kind === 'star' ? latest.starred : latest.pinned);
      if (kind === 'pin') {
        const confirmed = await new Promise<boolean>(resolve => Alert.alert(active ? 'Pin message?' : 'Unpin message?',
          active ? 'This message will appear at the top of the chat for both of you.' : 'This removes the pin for both of you.',
          [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) }, { text: active ? 'Pin' : 'Unpin', onPress: () => resolve(true) }],
          { cancelable: true, onDismiss: () => resolve(false) }));
        if (!confirmed) return;
      }
      const response = await api.put(`/chat/${message.matchId}/messages/${message.id}/marks`, { kind, active });
      queryClient.setQueryData(markKey, response.data.data);
      queryClient.setQueryData<MarkedMessage[]>(chatMarksKey(currentUserId, message.matchId, kind), old => active
        ? [{ ...message, markedAt: new Date().toISOString() }, ...(old ?? []).filter(item => item.id !== message.id)]
        : (old ?? []).filter(item => item.id !== message.id));
      void queryClient.invalidateQueries({ queryKey: chatMarksKey(currentUserId, message.matchId, kind) });
    } catch { Alert.alert('Action failed', 'The message could not be updated. Try again.'); }
    finally { marking.current = false; }
  };

  // Optimized Media Fetching via React Query (Global Caching)
  const mediaKeys = React.useMemo(
    () => (message.mediaKeys && message.mediaKeys.length > 0)
      ? message.mediaKeys
      : (message.mediaKey ? [message.mediaKey] : []),
    [message.mediaKey, message.mediaKeys],
  );
  
  const isVoiceNote = mediaKeys.some(key => {
    const k = key.toLowerCase();
    return k.endsWith('.m4a') ||
           k.endsWith('.mp3') ||
           k.endsWith('.wav') ||
           k.includes('audio') ||
           k.includes('voice') ||
           (k.startsWith('local-') && (k.endsWith('.m4a') || k.endsWith('.wav') || k.endsWith('.pcm')));
  });

  const documentMetadata = message.metadata?.document as { fileName?: string; mimeType?: string; size?: number } | undefined;
  const linkPreview = message.metadata?.linkPreview as {
    url?: string; title?: string; description?: string; image?: string; siteName?: string;
  } | undefined;
  const isDocumentMessage = message.type === 'document' || Boolean(documentMetadata) || mediaKeys.some(isDocumentMediaKey);

  // A video draws as its poster. The bubble fetches only that still; the video
  // itself streams when the viewer opens.
  const videoFlags = React.useMemo(() => mediaKeys.map(isVideoMediaKey), [mediaKeys]);
  const posterKeys = React.useMemo(
    () => mediaKeys.map((key, index) => (videoFlags[index] && !key.startsWith('local-') ? videoPosterKey(key) : null)),
    [mediaKeys, videoFlags],
  );
  const mediaDurations = ((message.metadata?.mediaInfo as Array<{ durationMs?: number } | null> | undefined) ?? [])
    .map((info) => info?.durationMs);
  const uploadPosters = ((message.metadata?.localMediaUpload as { items?: Array<{ posterUri?: string } | undefined> } | undefined)?.items ?? [])
    .map((item) => item?.posterUri);

  const { data: remoteMediaUrls, isLoading: imageLoading, isError: imageError, refetch: reloadMedia } = useQuery({
    queryKey: ['chat-media-local', 'posters', mediaKeys],
    queryFn: async () => {
      if (mediaKeys.length === 0) return [];
      const promises = mediaKeys.map(async (key, index) => {
        if (key.startsWith('local-')) return videoFlags[index] ? null : localMediaUri(key);
        const readKey = posterKeys[index] ?? key;
        return resolveCachedMedia(readKey, async () => {
          const response = await api.get('/chat/media/read', { params: { key: readKey } });
          if (!response.data?.success || typeof response.data.data !== 'string') {
            throw new Error('Media URL unavailable');
          }
          return response.data.data;
        });
      });
      return Promise.all(promises);
    },
    enabled: mediaKeys.length > 0 && !isVoiceNote && (!isDocumentMessage || Boolean(documentMetadata?.mimeType?.startsWith('image/'))),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 14,
  });

  const confirmedFallback = Array.isArray(message.metadata?.localMediaFallback)
    ? message.metadata.localMediaFallback as string[]
    : [];
  // Set once a local file has actually failed to decode, so the fallback to the
  // network happens on evidence rather than on a guess about cache eviction.
  const [localMediaFailures, setLocalMediaFailures] = useRecyclingState<Record<number, true>>({}, [message.id]);
  // The index of kept uploads is restored from storage asynchronously, so a
  // bubble rendered on a cold start must be told when it arrives. Without this
  // it would settle on the remote URL and re-download a file already on disk.
  const sentMediaSnapshot = React.useCallback(
    () => mediaKeys.map((key, index) => `${sentMediaUri(key) ?? ''}|${posterKeys[index] ? sentMediaUri(posterKeys[index]) ?? '' : ''}`).join('\u001f'),
    [mediaKeys, posterKeys],
  );
  const downloadSnapshot = React.useCallback(() => {
    const key = mediaKeys[0];
    if (!key) return '';
    const download = getChatDownload(key);
    if (!download) return '';
    return `${download.status}\u001f${download.progress}\u001f${download.localUri ?? ''}\u001f${download.error ?? ''}`;
  }, [mediaKeys]);
  // The stores notify all subscribers. Return a key-specific snapshot so a
  // completed download does not re-render every visible message bubble.
  useSyncExternalStore(subscribeSentMedia, sentMediaSnapshot, sentMediaSnapshot);
  useSyncExternalStore(subscribeChatDownloads, downloadSnapshot, downloadSnapshot);

  /** The video file on this device: still uploading, or kept after sending. */
  const localVideoSource = (index: number) => {
    const key = mediaKeys[index];
    if (!key || !videoFlags[index]) return null;
    return key.startsWith('local-') ? localMediaUri(key) : sentMediaUri(key);
  };
  // Posters drawn from a local video, matching what the server will produce, so
  // a video that is still sending, or was sent from here, needs no download.
  const [localPosters, setLocalPosters] = useRecyclingState<Record<number, string>>({}, [message.id]);
  const localPosterSources = mediaKeys.map((_, index) => localVideoSource(index) ?? '').join('\u001f');
  useEffect(() => {
    let active = true;
    mediaKeys.forEach((_, index) => {
      const source = localVideoSource(index);
      const posterKey = posterKeys[index];
      if (!source || uploadPosters[index] || (posterKey && sentMediaUri(posterKey))) return;
      localVideoPoster(source)
        .then((poster) => {
          if (active) setLocalPosters((previous) => (previous[index] === poster ? previous : { ...previous, [index]: poster }));
        })
        .catch(() => undefined);
    });
    return () => { active = false; };
    // Keyed on the resolved sources, which is what actually decides the posters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localPosterSources]);

  const immediateMediaUrls = mediaKeys.map((key, index) => {
    if (localMediaFailures[index]) return null;
    if (videoFlags[index]) {
      const posterKey = posterKeys[index];
      return uploadPosters[index] ?? (posterKey ? sentMediaUri(posterKey) : null) ?? localPosters[index] ?? null;
    }
    if (key.startsWith('local-')) return localMediaUri(key);
    // Our own upload. This resolves to the very URI the optimistic bubble was
    // rendering, so the remount that follows the server's reply is a memory-cache
    // hit rather than a fresh decode. Received media always misses here.
    const kept = sentMediaUri(key);
    if (kept) return kept;
    const fallbackKey = confirmedFallback[index];
    return fallbackKey?.startsWith('local-') ? localMediaUri(fallbackKey) : null;
  });
  // Local wins over remote. These are the exact bytes that were uploaded, so
  // switching to the network copy the moment a presigned URL resolves would buy
  // nothing and cost a download - and a blank bubble for as long as it takes.
  const displayMediaUrls = mediaKeys.map((_, index) => immediateMediaUrls[index] ?? remoteMediaUrls?.[index] ?? null);
  const handleMediaLoadError = (index: number) => {
    if (!immediateMediaUrls[index]) return; // Already the remote copy; nothing left to fall back to.
    const posterKey = posterKeys[index];
    if (videoFlags[index]) {
      if (posterKey) forgetSentMedia(posterKey);
    } else {
      forgetSentMedia(mediaKeys[index]);
    }
    setLocalMediaFailures((previous) => (previous[index] ? previous : { ...previous, [index]: true }));
    void reloadMedia();
  };

  // What the full-screen viewer plays: images as displayed, videos from the
  // local file when there is one, otherwise a presigned URL that streams.
  const [viewerSources, setViewerSources] = useRecyclingState<Array<string | null>>([], [message.id]);
  const openViewer = async (index: number) => {
    const sources = mediaKeys.map((_, itemIndex) => (videoFlags[itemIndex] ? localVideoSource(itemIndex) : displayMediaUrls[itemIndex]));
    const remote = mediaKeys
      .map((key, itemIndex) => (videoFlags[itemIndex] && !sources[itemIndex] && !key.startsWith('local-') ? itemIndex : -1))
      .filter((itemIndex) => itemIndex >= 0);
    await Promise.all(remote.map(async (itemIndex) => {
      try {
        const response = await api.get('/chat/media/read', { params: { key: mediaKeys[itemIndex] } });
        if (typeof response.data?.data === 'string') sources[itemIndex] = response.data.data;
      } catch {
        // Left out of the viewer; the rest still opens.
      }
    }));
    if (!sources[index]) {
      Alert.alert('Video unavailable', 'This video could not be loaded. Check your connection and try again.');
      return;
    }
    setViewerSources(sources);
    setSelectedImageIndex(index);
    setIsViewerOpen(true);
  };
  const hasCompleteLocalFallback = displayMediaUrls.length === mediaKeys.length && displayMediaUrls.every(Boolean);

  const isImageOnly = mediaKeys.length > 0 && !message.content && !isVoiceNote && !isDocumentMessage;
  const localUploadItems = ((message.metadata?.localMediaUpload as {
    items?: Array<{ progress: number; status: string; error?: string; fileName?: string; size?: number | null; mimeType?: string }>;
  } | undefined)?.items) ?? [];
  const sendFailure = messageSendFailure(message, currentUserId);
  const legacyDocumentName = mediaKeys[0]
    ? decodeURIComponent(mediaKeys[0].split('?')[0].split('/').pop() || 'Document')
    : 'Document';
  const documentFileName = documentMetadata?.fileName ?? localUploadItems[0]?.fileName ?? legacyDocumentName;
  const documentMimeType = documentMetadata?.mimeType ?? localUploadItems[0]?.mimeType ?? (mediaKeys.some((key) => /\.pdf(?:$|\?)/i.test(key)) ? 'application/pdf' : 'application/octet-stream');
  const transferFileName = isVoiceNote
    ? `Voice message.${mediaKeys[0]?.toLowerCase().includes('.wav') ? 'wav' : 'm4a'}`
    : documentFileName;
  const transferMimeType = isVoiceNote
    ? (mediaKeys[0]?.toLowerCase().includes('.wav') ? 'audio/wav' : 'audio/mp4')
    : documentMimeType;
  const documentUpload = localUploadItems[0];
  const documentDownload = mediaKeys[0] ? getChatDownload(mediaKeys[0]) : undefined;
  const documentUploadLabel = documentUpload && documentUpload.status !== 'done'
    ? documentUpload.status === 'failed' || documentUpload.status === 'cancelled'
      ? 'Retry'
      : documentUpload.status === 'processing'
        ? 'Sending'
        : documentUpload.status === 'queued'
          ? 'Preparing'
          : `${documentUpload.progress}%`
    : null;
  const documentTransferLabel = documentUploadLabel
    ?? (documentDownload?.status === 'downloading' ? `${documentDownload.progress}%`
      : documentDownload?.status === 'complete' ? 'Downloaded'
        : documentDownload?.status === 'failed' ? 'Download failed'
          : documentDownload?.status === 'cancelled' ? 'Download cancelled' : null);
  const renderUploadOverlay = (index: number, compact = false) => {
    const upload = localUploadItems[index];
    if (!upload || upload.status === 'done') return null;
    const failed = upload.status === 'failed' || upload.status === 'cancelled';
    const radius = 17;
    const circumference = 2 * Math.PI * radius;
    return (
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={() => failed ? onRetryMediaUpload?.(message.id, index) : onCancelMediaUpload?.(message.id, index)}
        style={styles.uploadOverlay}
        accessibilityRole={failed ? 'button' : undefined}
        accessibilityLabel={failed ? 'Retry this attachment' : `Cancel upload at ${upload.progress} percent`}
      >
        <View style={styles.uploadProgressCircle}>
          <Svg width={42} height={42} style={StyleSheet.absoluteFill}>
            <Circle cx={21} cy={21} r={radius} fill="rgba(0,0,0,0.22)" stroke="rgba(255,255,255,0.34)" strokeWidth={2.5} />
            {!failed ? (
              <Circle
                cx={21}
                cy={21}
                r={radius}
                fill="none"
                stroke="#35D07F"
                strokeWidth={3}
                strokeLinecap="round"
                strokeDasharray={`${circumference} ${circumference}`}
                strokeDashoffset={circumference * (1 - Math.max(0, Math.min(100, upload.progress)) / 100)}
                rotation={-90}
                origin="21, 21"
              />
            ) : null}
          </Svg>
          <Ionicons name={failed ? 'refresh' : 'close'} size={18} color="#fff" />
        </View>
        {!compact && <Text style={styles.uploadProgressText}>
          {failed ? 'Retry' : upload.status === 'processing' ? 'Sending' : `${upload.progress}%`}
        </Text>}
      </TouchableOpacity>
    );
  };

  // Long messages collapse behind "Read more", the way WhatsApp does it, so one
  // wall of text cannot push the rest of the conversation off screen.
  //
  // The cut itself is numberOfLines, so it lands on a clean line boundary with
  // the platform's own ellipsis rather than mid-word. Whether to cut at all is
  // decided from the raw text instead of from a measured line count: measuring
  // requires laying the message out in full first, which shows as a tall flash
  // before it collapses. This way the message is never rendered at full height.
  //
  // Character count catches prose; the newline count catches a short message
  // made of many lines, which no character threshold would flag.
  const [expanded, setExpanded] = useRecyclingState(false, [message.id]);
  const content = message.content ?? '';
  // Hidden Words fold a message away until tapped; hurtful words from them
  // ask "Does this bother you?" with a way to report (features/safety).
  const hiddenWords = useHiddenWords();
  const [showHidden, setShowHidden] = useState(false);
  // Photos and videos the nudity check flagged arrive covered (docs/NUDITY_CHECK.md):
  // the receiver chooses to look, and can report.
  const sensitiveKeys = Array.isArray(message.metadata?.sensitive) ? message.metadata.sensitive as string[] : [];
  const [showSensitive, setShowSensitive] = useRecyclingState(false, [message.id]);
  const coverSensitive = !isMe && !showSensitive && mediaKeys.some((key) => sensitiveKeys.includes(key));
  const hiddenByWords = !isMe && !showHidden && containsHidden(message.content, hiddenWords);
  const hurtful = !isMe && !hiddenByWords && looksHurtful(message.content);
  const newlineCount = (content.match(/\n/g) ?? []).length;
  const isLongMessage = content.length > COLLAPSE_THRESHOLD_CHARS || newlineCount >= COLLAPSED_LINES;
  const collapsed = isLongMessage && !expanded;
  const [selectedImageIndex, setSelectedImageIndex] = useRecyclingState<number | null>(null, [message.id]);

  const handleLongPress = () => {
    if (selectionMode) {
      onToggleSelection?.(message.id);
      return;
    }
    if (message.id.startsWith('temp-')) return;

    const openMenu = () => {
      bubbleRef.current?.measureInWindow((x, y, width, height) => {
        setAnchor({ x, y, width, height });
        setIsOptionsOpen(true);
      });
    };

    // With the keyboard up the list is shifted, so measuring now and dismissing
    // afterwards would anchor the menu to where the bubble *was*. Dismiss first
    // and measure once the layout has settled.
    if (!Keyboard.isVisible()) {
      openMenu();
      return;
    }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      subscription.remove();
      clearTimeout(fallback);
      // One more frame so the list has re-laid out before measureInWindow.
      requestAnimationFrame(openMenu);
    };
    // keyboardDidHide is not guaranteed on every OEM keyboard, so never let the
    // long press be swallowed entirely.
    const subscription = Keyboard.addListener('keyboardDidHide', finish);
    const fallback = setTimeout(finish, 350);
    Keyboard.dismiss();
  };

  const handleDeleteForMe = async () => {
    setIsOptionsOpen(false);
    try {
      await api.delete(`/chat/${message.matchId}/messages/${message.id}`, {
        data: { mode: 'me' }
      });
      dispatch(removeMessage({ matchId: message.matchId, messageId: message.id }));
    } catch (err) {
      console.error('[MessageBubble] Error hiding message for me:', err);
    }
  };

  const handleDeleteForEveryone = async () => {
    setIsOptionsOpen(false);
    try {
      if (!isMe) return; // Only sender can delete for everyone
      await api.delete(`/chat/${message.matchId}/messages/${message.id}`, {
        data: { mode: 'everyone' }
      });
      dispatch(removeMessage({ matchId: message.matchId, messageId: message.id }));
    } catch (err) {
      console.error('[MessageBubble] Error deleting message for everyone:', err);
      Alert.alert("Error", "Could not delete message for everyone.");
    }
  };

  const handleCopyText = async () => {
    setIsOptionsOpen(false);
    if (!message.content) return;
    
    try {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(message.content);
      Alert.alert("Success", "Message copied to clipboard");
    } catch (err: any) {
      console.warn('Clipboard error:', err);
      // More descriptive error for development
      if (err.message?.includes('native module')) {
        Alert.alert(
          "Module Missing",
          "The Clipboard feature requires a native module. Please restart your Expo server or rebuild your dev client if the issue persists."
        );
      } else {
        Alert.alert("Error", "Could not copy message");
      }
    }
  };

  const resolveAttachmentUri = async (): Promise<string | null> => {
    const key = mediaKeys[0];
    if (!key) return null;
    if (key.startsWith('local-')) return localMediaUri(key);
    return resolveCachedMedia(key, async () => {
      const response = await api.get('/chat/media/read', { params: { key } });
      if (typeof response.data?.data !== 'string') throw new Error('Media unavailable');
      return response.data.data;
    });
  };
  const closeAndGetDocumentUri = async () => {
    setIsOptionsOpen(false);
    try { return await resolveAttachmentUri(); }
    catch { Alert.alert('Download failed', 'Try again when you have a connection.'); return null; }
  };

  const handleOpenFile = async () => {
    if (documentDownload?.status === 'downloading') {
      await pauseChatDownload(mediaKeys[0]);
      return;
    }
    if (documentDownload?.status === 'paused') {
      await resumeChatDownload(mediaKeys[0]);
      return;
    }
    const uri = await closeAndGetDocumentUri();
    if (!uri) return;
    try {
      if (Platform.OS !== 'android') {
        await Linking.openURL(uri);
        return;
      }

      let localUri = uri;
      if (/^https?:\/\//i.test(uri)) {
        localUri = await downloadChatFile(mediaKeys[0], uri, documentFileName);
      }
      const contentUri = localUri.startsWith('content://') ? localUri : await getContentUriAsync(localUri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        type: documentMimeType,
        flags: 1,
      });
    } catch {
      if (getChatDownload(mediaKeys[0])?.status === 'cancelled') return;
      Alert.alert('Open failed', 'No installed app can open this file.');
    }
  };

  const handleSaveFile = async () => {
    const uri = await closeAndGetDocumentUri();
    if (!uri) return;
    try {
      const destination = await Directory.pickDirectoryAsync();
      const fileName = transferFileName.trim() || 'Document';
      const target = destination.createFile(fileName, transferMimeType);
      if (/^https?:\/\//i.test(uri)) await FileSystemFile.downloadFileAsync(uri, target, { idempotent: true });
      // Written, not copied: copy() cannot fill a picked folder's new file (localFiles).
      else target.write(await new FileSystemFile(uri).bytes());
      Alert.alert('Saved', `${fileName} was saved.`);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : '';
      if (!/cancel/i.test(messageText)) Alert.alert('Save failed', 'The file could not be saved.');
    }
  };

  const handleShareFile = async () => {
    const uri = await closeAndGetDocumentUri();
    if (!uri) return;
    try { await Share.share({ title: transferFileName, message: uri, url: uri }); }
    catch { Alert.alert('Share failed', 'The file could not be shared.'); }
  };

  const handleReportMessage = () => {
    setIsOptionsOpen(false);
    // The report sheet: the reason, a detail, "Also block" (features/safety/ReportSheet.tsx).
    void openReport({
      userId: message.senderId,
      name: store.getState().chat.conversations.find((row) => row.matchId === message.matchId)?.user?.name ?? 'this person',
      sourceType: 'message', sourceId: message.id, matchId: message.matchId,
    });
  };

  const handleReaction = async (emoji: string) => {
    if (reactionPendingRef.current) return;
    reactionPendingRef.current = true;
    setReactionPending(true);
    setIsOptionsOpen(false);
    const previous = message.reactions?.[currentUserId] ?? null;
    const next = previous === emoji ? null : emoji;
    dispatch(applyReaction({ matchId: message.matchId, messageId: message.id, userId: currentUserId, emoji: next }));
    void Haptics.selectionAsync().catch(() => undefined);
    try {
      const response = await api.put(`/chat/${message.matchId}/messages/${message.id}/reaction`, { emoji: next });
      const confirmed = response.data?.data?.emoji ?? null;
      dispatch(applyReaction({ matchId: message.matchId, messageId: message.id, userId: currentUserId, emoji: confirmed }));
    } catch {
      // Restore the exact prior value. A failed replacement must not remove the
      // reaction that the server still stores.
      dispatch(applyReaction({ matchId: message.matchId, messageId: message.id, userId: currentUserId, emoji: previous }));
      Alert.alert('Reaction failed', 'The reaction could not be updated. Try again.');
    } finally {
      reactionPendingRef.current = false;
      setReactionPending(false);
    }
  };

  const reactionGroups = Object.entries(message.reactions ?? {}).reduce<Array<{ emoji: string; count: number; selected: boolean; userIds: string[] }>>((groups, [userId, emoji]) => {
    const existing = groups.find(group => group.emoji === emoji);
    if (existing) {
      existing.count += 1;
      existing.selected ||= userId === currentUserId;
      existing.userIds.push(userId);
    } else {
      groups.push({ emoji, count: 1, selected: userId === currentUserId, userIds: [userId] });
    }
    return groups;
  }, []);
  const reactionSignature = reactionGroups.map(group => `${group.emoji}:${group.count}:${group.selected}:${group.userIds.join(',')}`).join('|');
  const [visibleReactionGroups, setVisibleReactionGroups] = useRecyclingState(reactionGroups, [message.id]);
  const reactionOpacity = useSharedValue(reactionGroups.length > 0 ? 1 : 0);
  const reactionRowHeight = useSharedValue(reactionGroups.length > 0 ? 25 : 0);
  const reactionFadeStyle = useAnimatedStyle(() => ({
    opacity: reactionOpacity.value,
    height: reactionRowHeight.value,
    marginTop: -5 * Math.min(1, reactionRowHeight.value / 25),
  }));

  useEffect(() => {
    if (reactionGroups.length > 0) {
      setVisibleReactionGroups(reactionGroups);
      reactionOpacity.value = withTiming(1, { duration: 120 });
      reactionRowHeight.value = withTiming(25, { duration: 140 });
      return;
    }
    if (visibleReactionGroups.length === 0) return;
    reactionOpacity.value = withTiming(0, { duration: 110 });
    const collapseTimer = setTimeout(() => {
      reactionRowHeight.value = withTiming(0, { duration: 160 });
    }, 110);
    const clearTimer = setTimeout(() => setVisibleReactionGroups([]), 280);
    return () => {
      clearTimeout(collapseTimer);
      clearTimeout(clearTimer);
    };
    // The signature changes only when the visible reaction data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reactionSignature]);

  const swipeReplyX = useSharedValue(0);
  const swipeReplyReady = useSharedValue(0);
  const swipeReplyHapticSent = useSharedValue(0);

  // FlashList reuses this component for a different message. React state uses
  // useRecyclingState above. Reset Reanimated values after React commits the
  // new message and before the frame is painted. Writing shared values during
  // render causes a discarded frame and can show the previous message.
  useLayoutEffect(() => {
    reactionPendingRef.current = false;
    swipeReplyX.value = 0;
    swipeReplyReady.value = 0;
    swipeReplyHapticSent.value = 0;
    reactionOpacity.value = reactionGroups.length > 0 ? 1 : 0;
    reactionRowHeight.value = reactionGroups.length > 0 ? 25 : 0;
    // This reset must run only when FlashList assigns a new message to the row.
    // The reaction effect above handles reaction changes for the same message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id]);

  const swipeReplyStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: swipeReplyX.value }],
  }));
  const swipeReplyIndicatorStyle = useAnimatedStyle(() => {
    const progress = Math.min(1, Math.abs(swipeReplyX.value) / SWIPE_REPLY_THRESHOLD);
    return {
      opacity: progress,
      transform: [{ scale: 0.72 + progress * 0.28 }],
    };
  });
  const playSwipeReplyHaptic = React.useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }, []);
  /**
   * Swipe-to-reply is built once per row and never again.
   *
   * It used to be rebuilt whenever the message object changed: on every row the
   * list recycled onto a new message, and on every read receipt, reaction or
   * edit landing on a message already on screen. A new gesture is four new
   * worklets serialised across to the UI thread and a native handler torn down
   * and attached again - a large share of what one row cost to bind, and, for
   * the newest messages, the reason they flickered after jumping to the bottom:
   * that is exactly when their read receipts arrive.
   *
   * So nothing about the message is captured. Which message a swipe replies to
   * is read when the swipe completes, and whether a swipe may start and which
   * way it goes are values the gesture reads on the UI thread as it runs.
   */
  const replyTarget = React.useRef({ message, onReply });
  replyTarget.current = { message, onReply };
  const openSwipeReply = React.useCallback(() => {
    const { message: target, onReply: reply } = replyTarget.current;
    reply?.(target);
  }, []);
  const swipeAllowed = useSharedValue(false);
  const swipeDirection = useSharedValue(isMe ? -1 : 1);
  const allowSwipe = Boolean(onReply) && !selectionMode && !isOptionsOpen && !message.id.startsWith('temp-');
  useLayoutEffect(() => {
    swipeAllowed.value = allowSwipe;
    swipeDirection.value = isMe ? -1 : 1;
  }, [allowSwipe, isMe, swipeAllowed, swipeDirection]);
  const replyGesture = React.useMemo(
    () => Gesture.Pan()
      .activeOffsetX([-10, 10])
      .failOffsetY([-12, 12])
      .onBegin(() => {
        swipeReplyReady.value = 0;
        swipeReplyHapticSent.value = 0;
      })
      .onUpdate((event) => {
        if (!swipeAllowed.value) return;
        const direction = swipeDirection.value;
        const directedDistance = Math.max(0, direction * event.translationX);
        const resistedDistance = directedDistance <= SWIPE_REPLY_THRESHOLD
          ? directedDistance
          : SWIPE_REPLY_THRESHOLD + (directedDistance - SWIPE_REPLY_THRESHOLD) * 0.2;
        const displayedDistance = Math.min(SWIPE_REPLY_MAX_DISTANCE, resistedDistance);
        swipeReplyX.value = direction * displayedDistance;
        swipeReplyReady.value = directedDistance >= SWIPE_REPLY_THRESHOLD ? 1 : 0;
        if (swipeReplyReady.value === 1 && swipeReplyHapticSent.value === 0) {
          swipeReplyHapticSent.value = 1;
          runOnJS(playSwipeReplyHaptic)();
        }
      })
      .onEnd(() => {
        if (swipeReplyReady.value === 1) runOnJS(openSwipeReply)();
        swipeReplyX.value = withSpring(0, { damping: 18, stiffness: 260, mass: 0.65 });
        swipeReplyReady.value = 0;
      })
      .onFinalize(() => {
        swipeReplyX.value = withSpring(0, { damping: 18, stiffness: 260, mass: 0.65 });
        swipeReplyReady.value = 0;
      }),
    [openSwipeReply, playSwipeReplyHaptic, swipeAllowed, swipeDirection, swipeReplyHapticSent, swipeReplyReady, swipeReplyX],
  );

  // Don't render bubble if it's completely empty (no text, no images)
  if (!message.content && mediaKeys.length === 0) return null;

  const groupedBubbleStyle = isMe
    ? groupPosition === 'top'
      ? styles.bubbleSentTop
      : groupPosition === 'middle'
        ? styles.bubbleSentMiddle
        : groupPosition === 'bottom'
          ? styles.bubbleSentBottom
          : styles.bubbleSentSingle
    : groupPosition === 'top'
      ? styles.bubbleReceivedTop
      : groupPosition === 'middle'
        ? styles.bubbleReceivedMiddle
        : groupPosition === 'bottom'
          ? styles.bubbleReceivedBottom
      : styles.bubbleReceivedSingle;
  const usesVectorBackground = mediaKeys.length === 0 || isDocumentMessage || isVoiceNote;

              return (
    <GestureDetector gesture={replyGesture}>
      <Animated.View style={[
        styles.messageRow,
        groupPosition === 'single' || groupPosition === 'bottom' ? styles.messageGroupBreak : null,
        isMe ? styles.messageRowRight : styles.messageRowLeft,
        // Shows which message the open menu belongs to. The row spans the full
        // width, so the band reads as a selection across the conversation rather
        // than a second bubble.
        isOptionsOpen || highlighted || selected ? styles.messageRowSelected : null,
      ]}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.swipeReplyIndicator,
            isMe ? styles.swipeReplyIndicatorRight : styles.swipeReplyIndicatorLeft,
            swipeReplyIndicatorStyle,
          ]}
        >
          <Ionicons name="arrow-undo" size={19} color="#FF9F0A" />
        </Animated.View>
        <Animated.View style={[
          styles.swipeReplyContent,
          isMe ? styles.swipeReplyContentRight : styles.swipeReplyContentLeft,
          swipeReplyStyle,
        ]}>
          <TouchableOpacity
        ref={bubbleRef}
        activeOpacity={1}
        onLongPress={handleLongPress}
        onPress={() => { if (selectionMode) onToggleSelection?.(message.id); }}
        delayLongPress={250}
        style={[
          styles.bubble,
          isMe ? styles.bubbleSent : styles.bubbleReceived,
          groupedBubbleStyle,
          usesVectorBackground && { backgroundColor: 'transparent' },
          mediaKeys.length > 0 && !isDocumentMessage && !isVoiceNote && styles.imageOnlyBubble,
          isVoiceNote && styles.voiceBubbleShell,
        ]}
      >
        {usesVectorBackground && (
          // Sizes itself from layout - no measuring, so no frame where the
          // background lags behind the bubble it belongs to.
          <ChatBubbleBackground
            outgoing={isMe}
            groupPosition={groupPosition}
            color={isMe ? colors.primary : '#1C1C1C'}
          />
        )}
        {/* Render Image Grid */}
        {mediaKeys.length > 0 && (
          isDocumentMessage ? (
            <View style={styles.documentBubble}>
              <View style={[styles.documentInnerPanel, { backgroundColor: isMe ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.055)' }]}>
              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.documentPreview}
                onPress={() => void handleOpenFile()}
                accessibilityRole="button"
                accessibilityLabel={`Open ${documentFileName}`}
              >
                {documentMimeType.startsWith('image/') && displayMediaUrls[0] ? (
                  <Image source={{ uri: displayMediaUrls[0] }} style={styles.documentPreviewImage} resizeMode="cover" onError={() => handleMediaLoadError(0)} />
                ) : (
                  <Ionicons name={documentIconName(documentFileName, documentMimeType)} size={28} color="#fff" />
                )}
                {renderUploadOverlay(0, true)}
              </TouchableOpacity>
              <View style={styles.documentDetails}>
                <Text style={styles.documentFileName} numberOfLines={2}>{documentFileName}</Text>
                <Text style={styles.documentFileInfo} numberOfLines={1}>
                  {documentTransferLabel ? `${documentTransferLabel} · ` : ''}
                  {formatFileSize(Number(documentMetadata?.size ?? localUploadItems[0]?.size ?? 0))}
                  {` · ${documentFormatLabel(documentFileName, documentMimeType)}`}
                </Text>

              </View>
              <TouchableOpacity hitSlop={10} style={styles.documentMore} onPress={handleLongPress} accessibilityRole="button" accessibilityLabel="File options">
                <Ionicons name="ellipsis-vertical" size={18} color="rgba(255,255,255,0.78)" />
              </TouchableOpacity>
              </View>
                {!message.content && (
                  <View style={styles.documentMeta}>
                    <MessageMarkIcons starred={starred} pinned={pinned} color={isMe ? '#FFF' : '#D7B884'} />
                    <Text style={styles.documentTime}>{formatMessageTime(message.sentAt)}</Text>
                    {isMe && <Ionicons name={messageStatusIcon(message)} size={message.id.startsWith('temp-') ? 13 : 16} color={messageStatusColor(message)} style={{ marginLeft: 4 }} />}
                  </View>
                )}
            </View>
          ) : isVoiceNote ? (
            <View>
              <VoicePlayerBubble
                starred={starred}
                pinned={pinned}
                resolveUri={resolveAttachmentUri}
                isMe={isMe}
                initialDuration={message.content}
                sentAt={message.sentAt}
                messageId={message.id}
                readAt={message.readAt}
                deliveredAt={message.deliveredAt}
                playedAt={message.playedAt}
                matchId={message.matchId}
                localStatus={message.localStatus}
                waveform={Array.isArray(message.metadata?.waveform) ? message.metadata.waveform as number[] : undefined}
                onLongPress={handleLongPress}
                transfer={localUploadItems[0] && localUploadItems[0].status !== 'done' ? {
                  progress: localUploadItems[0].progress,
                  status: localUploadItems[0].status,
                  onPress: () => {
                    const failed = localUploadItems[0].status === 'failed' || localUploadItems[0].status === 'cancelled';
                    if (failed) onRetryMediaUpload?.(message.id, 0);
                    else onCancelMediaUpload?.(message.id, 0);
                  },
                } : undefined}
              />
            </View>
          ) : (
          <View style={[
            styles.gridContainer,
            { aspectRatio: mediaKeys.length === 1 ? 3 / 4 : 1 },
            isImageOnly && styles.imageOnlyContainer,
            isMe ? styles.sentImageContainer : styles.receivedImageContainer,
            !isImageOnly && { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottomWidth: 0 }
          ]}>
            {coverSensitive && (
              <View style={styles.sensitiveCover}>
                <Ionicons name="eye-off-outline" size={26} color="#FFF" />
                <Text style={styles.sensitiveTitle}>May contain nudity</Text>
                <View style={styles.sensitiveActions}>
                  <TouchableOpacity onPress={() => setShowSensitive(true)} style={styles.sensitiveButton} accessibilityRole="button" accessibilityLabel="View sensitive media">
                    <Text style={styles.sensitiveButtonText}>View</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleReportMessage} style={styles.sensitiveButton} accessibilityRole="button" accessibilityLabel="Report this message">
                    <Text style={styles.sensitiveButtonText}>Report</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            {imageLoading && !hasCompleteLocalFallback ? (
              <View style={[styles.imagePlaceholder, StyleSheet.absoluteFill, { aspectRatio: undefined }]}>
                <ActivityIndicator color={isMe ? '#fff' : colors.primary} />
              </View>
            ) : imageError && !hasCompleteLocalFallback ? (
              <TouchableOpacity onPress={() => void reloadMedia()} accessibilityLabel="Retry media download" style={[styles.imagePlaceholder, StyleSheet.absoluteFill, { aspectRatio: undefined }]}>
                <Ionicons name="image-outline" size={24} color={isMe ? 'rgba(255,255,255,0.5)' : colors.text.tertiary} />
                <Text style={[styles.errorText, { color: isMe ? 'white' : colors.text.secondary }]}>Tap to retry</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.mediaGrid}>
                {mediaKeys.length === 1 && (
                  <TouchableOpacity 
                    activeOpacity={0.9} 
                    onLongPress={handleLongPress}
                    delayLongPress={250}
                    onPress={() => {
                      if (displayMediaUrls?.[0] && !isDocumentMediaKey(mediaKeys[0])) {
                        void openViewer(0);
                      }
                    }}
                    style={styles.singleImageWrapper}
                  >
                    {displayMediaUrls?.[0] ? (
                      <BubbleMedia uri={displayMediaUrls[0]} video={isVideoMediaKey(mediaKeys[0])} durationMs={mediaDurations[0]} document={isDocumentMediaKey(mediaKeys[0])} fileName={localUploadItems[0]?.fileName} onError={() => handleMediaLoadError(0)} />
                    ) : (
                      <View style={styles.imagePlaceholder}>
                        <ActivityIndicator color={isMe ? '#fff' : colors.primary} />
                      </View>
                    )}
                    {renderUploadOverlay(0)}
                  </TouchableOpacity>
                )}

                {mediaKeys.length === 2 && (
                  <View style={styles.gridRow}>
                    {displayMediaUrls?.slice(0, 2).map((url, i) => (
                      <TouchableOpacity 
                        key={i} 
                        style={styles.gridItemHalf} 
                        onLongPress={handleLongPress}
                        delayLongPress={250}
                        onPress={() => {
                          if (url) {
                            void openViewer(i);
                          }
                        }}
                      >
                        {url ? (
                          <BubbleMedia uri={url} video={isVideoMediaKey(mediaKeys[i])} durationMs={mediaDurations[i]} document={isDocumentMediaKey(mediaKeys[i])} fileName={localUploadItems[i]?.fileName} onError={() => handleMediaLoadError(i)} />
                        ) : (
                          <View style={styles.imagePlaceholder}>
                            <ActivityIndicator size="small" color={isMe ? '#fff' : colors.primary} />
                          </View>
                        )}
                        {renderUploadOverlay(i)}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {mediaKeys.length === 3 && (
                  <View style={styles.gridRow}>
                    <TouchableOpacity 
                      style={styles.gridItemLarge}
                      onLongPress={handleLongPress}
                      delayLongPress={250}
                      onPress={() => {
                        void openViewer(0);
                      }}
                    >
                      {displayMediaUrls?.[0] ? <BubbleMedia uri={displayMediaUrls[0]} video={isVideoMediaKey(mediaKeys[0])} durationMs={mediaDurations[0]} document={isDocumentMediaKey(mediaKeys[0])} fileName={localUploadItems[0]?.fileName} onError={() => handleMediaLoadError(0)} /> : null}
                      {renderUploadOverlay(0)}
                    </TouchableOpacity>
                    <View style={styles.gridCol}>
                      {displayMediaUrls?.slice(1, 3).map((url, i) => (
                        <TouchableOpacity 
                          key={i} 
                          style={styles.gridItemSmall}
                          onLongPress={handleLongPress}
                          delayLongPress={250}
                          onPress={() => {
                            void openViewer(i + 1);
                          }}
                        >
                          <BubbleMedia uri={url} video={isVideoMediaKey(mediaKeys[i + 1])} durationMs={mediaDurations[i + 1]} document={isDocumentMediaKey(mediaKeys[i + 1])} fileName={localUploadItems[i + 1]?.fileName} onError={() => handleMediaLoadError(i + 1)} />
                          {renderUploadOverlay(i + 1)}
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}

                {mediaKeys.length >= 4 && (
                  <View style={styles.grid2x2}>
                    {displayMediaUrls?.slice(0, 4).map((url, i) => (
                      <TouchableOpacity 
                        key={i} 
                        style={styles.gridItemQuarter}
                        onLongPress={handleLongPress}
                        delayLongPress={250}
                        onPress={() => {
                          void openViewer(i);
                        }}
                      >
                        <BubbleMedia uri={url} video={isVideoMediaKey(mediaKeys[i])} durationMs={mediaDurations[i]} document={isDocumentMediaKey(mediaKeys[i])} fileName={localUploadItems[i]?.fileName} onError={() => handleMediaLoadError(i)} />
                        {i === 3 && mediaKeys.length > 4 && (
                          <View pointerEvents="none" style={styles.moreOverlay}>
                            <Text style={styles.moreText}>+{mediaKeys.length - 3}</Text>
                          </View>
                        )}
                        {renderUploadOverlay(
                          i === 3
                            ? Math.max(3, localUploadItems.findIndex((item, itemIndex) => itemIndex >= 3 && item.status === 'failed'))
                            : i
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* WhatsApp Status Overlay for Images */}
                {isImageOnly && (
                  <LinearGradient
                     colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.6)']}
                     style={styles.imageGradient}
                   >
                      <View style={styles.imageMeta}>
                        <MessageMarkIcons starred={starred} pinned={pinned} color="#FFF" />
                        <Text style={styles.imageTime}>{formatMessageTime(message.sentAt)}</Text>
                        {isMe && (
                          <Ionicons
                            name={messageStatusIcon(message)}
                            size={13}
                            color={messageStatusColor(message)}
                            style={{ marginLeft: 3 }}
                          />
                        )}
                      </View>
                   </LinearGradient>
                )}
              </View>
            )}
          </View>
          )
        )}

        {/* Divider if both media and text exist */}

        {/* Divider if both media and text exist */}

        {/* Render Text Content */}
        {/* Render Text Content */}
        {/* A Story reply shows which Story it answers, above the message. */}
        {message.type === 'story_reply' ? <StoryReplyCard message={message} isMe={isMe} /> : null}
        {/* A Rose note that opened this match (STANDOUTS_LIKES_SPEC.md 4.3). */}
        {message.metadata?.roseNote ? (
          <View style={styles.roseNoteTag} accessibilityLabel={isMe ? 'Your Rose note' : 'Sent with a Rose'}>
            <Ionicons name="rose" size={11} color={isMe ? '#FFD6E3' : '#E0457B'} />
            <Text style={[styles.roseNoteText, isMe && styles.roseNoteTextMe]}>
              {isMe ? 'Your Rose note' : 'Sent with a Rose'}
            </Text>
          </View>
        ) : null}
        {/* A comment on a photo or the bio that opened this match: what it answered, then the words. */}
        {message.metadata?.likeNote ? <CommentAboutCard metadata={message.metadata} isMe={isMe} /> : null}
        {message.replyToId && (
          <TouchableOpacity
            activeOpacity={0.72}
            onPress={() => onOpenReply?.(message.replyToId!)}
            style={[styles.quote, isMe ? styles.quoteSent : styles.quoteReceived]}
            accessibilityRole="button"
            accessibilityLabel="Open replied message"
          >
            <View style={[styles.quoteLine, isMe ? styles.quoteLineSent : styles.quoteLineReceived]} />
            <View style={styles.quoteContent}>
              <Text
                style={[styles.quoteAuthor, isMe ? styles.quoteAuthorSent : styles.quoteAuthorReceived]}
                numberOfLines={1}
              >
                {replyAuthor ?? 'Original message'}
              </Text>
              <Text style={[styles.quoteText, isMe ? styles.quoteTextSent : styles.quoteTextReceived]} numberOfLines={1}>
                {replyIsDocument && <Ionicons name={replyDocumentIcon ?? 'document-text'} size={13} color={isMe ? '#fff' : colors.primary} />}
                {replyIsVoice && <Ionicons name="mic" size={13} color={isMe ? '#fff' : colors.primary} />}
                {replyIsDocument || replyIsVoice ? ' ' : ''}{replyPreview ?? 'Original message is unavailable'}
              </Text>
            </View>
          </TouchableOpacity>
        )}
        {linkPreview?.url && linkPreview.title ? (
          <TouchableOpacity
            activeOpacity={0.78}
            onPress={() => void Linking.openURL(linkPreview.url!)}
            style={[styles.linkPreview, isMe ? styles.linkPreviewSent : styles.linkPreviewReceived]}
            accessibilityRole="link"
            accessibilityLabel={`Open ${linkPreview.title}`}
          >
            {linkPreview.image ? <Image source={{ uri: linkPreview.image }} style={styles.linkPreviewImage} resizeMode="cover" /> : null}
            <View style={styles.linkPreviewBody}>
              <Text style={[styles.linkPreviewSite, isMe ? styles.linkPreviewSiteSent : styles.linkPreviewSiteReceived]} numberOfLines={1}>{linkPreview.siteName}</Text>
              <Text style={styles.linkPreviewTitle} numberOfLines={2}>{linkPreview.title}</Text>
              {linkPreview.description ? <Text style={styles.linkPreviewDescription} numberOfLines={2}>{linkPreview.description}</Text> : null}
            </View>
          </TouchableOpacity>
        ) : null}
        {!!message.content && !isVoiceNote && (
          <View style={[
            styles.textContentWrapper, 
            mediaKeys.length > 0 && { 
              backgroundColor: isMe ? colors.primary : '#1C1C1C',
              paddingTop: 8, 
              width: width * 0.72,
            }
          ]}>
            <View
              style={{
                position: 'relative',
                // A reply quote can be wider than its new message. Anchor the
                // metadata to that full width so it stays at the bubble edge.
                alignSelf: mediaKeys.length > 0 || Boolean(message.replyToId) ? 'stretch' : 'flex-start',
              }}
            >
              <Text style={[
                styles.bubbleText, 
                isMe ? styles.bubbleTextSent : styles.bubbleTextReceived, 
                mediaKeys.length > 0 ? { marginTop: 0 } : {}, 
              ]}
              numberOfLines={collapsed ? COLLAPSED_LINES : undefined}>
                {hiddenByWords
                  ? <Text style={styles.hiddenWords} onPress={() => setShowHidden(true)} accessibilityRole="button" accessibilityHint="Shows the message">Hidden by your Hidden Words · Tap to show</Text>
                  : richMessageText(message.content, revealedSpoilers, (index) => setRevealedSpoilers((current) => new Set(current).add(index)))}
                {!collapsed && <View style={{ width: metadataWidth + metadataGap, height: 14 }} />}
              </Text>

              {isLongMessage && (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={collapsed ? 'Read more' : 'Show less'}
                  onPress={() => setExpanded(value => !value)}
                  // The timestamp is absolutely positioned in this corner, so
                  // keep clear of it the same way the inline spacer does.
                  style={[styles.readMoreRow, { paddingRight: metadataWidth + metadataGap }]}
                  hitSlop={8}
                >
                  <Text style={[styles.readMore, isMe ? styles.readMoreSent : styles.readMoreReceived]}>
                    {collapsed ? 'Read more' : 'Show less'}
                  </Text>
                </TouchableOpacity>
              )}

              {hurtful ? <Text style={[styles.botherRow, { paddingRight: metadataWidth + metadataGap }]} onPress={handleReportMessage} accessibilityRole="button">
                Does this bother you? <Text style={styles.botherLink}>Report</Text>
              </Text> : null}

              {/* Message Meta for Text (Time & Status) */}
              <View
                style={[styles.bubbleMeta, styles.textMetadata, !isMe && styles.textMetadataReceived]}
              >
                <MessageMarkIcons starred={starred} pinned={pinned} color={isMe ? '#FFF' : '#D7B884'} />
                <Text style={[styles.bubbleTime, isMe ? styles.bubbleTimeSent : styles.bubbleTimeReceived]}>
                  {textMessageTime}
                </Text>
                {isMe && (
                  <TouchableOpacity
                    disabled={message.localStatus !== 'failed'}
                    onPress={() => onRetryMessage?.(message.id)}
                    accessibilityLabel={message.localStatus === 'failed' ? 'Retry message' : undefined}
                  ><Ionicons
                    name={messageStatusIcon(message)}
                    size={message.id.startsWith('temp-') ? 13 : 16}
                    color={messageStatusColor(message)}
                    style={{ marginLeft: 4 }}
                  /></TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        )}
        {isViewerOpen && (() => {
          const entries = viewerSources
            .map((source, index) => ({ source, index }))
            .filter((entry): entry is { source: string; index: number } => Boolean(entry.source));
          if (!entries.length) return null;
          return (
            <ImageModal
              isVisible={isViewerOpen}
              imageUrls={entries.map((entry) => entry.source)}
              thumbnailUrls={entries.map((entry) => displayMediaUrls[entry.index])}
              mediaTypes={entries.map((entry) => (videoFlags[entry.index] ? 'video' as const : 'image' as const))}
              initialIndex={Math.max(0, entries.findIndex((entry) => entry.index === (selectedImageIndex ?? 0)))}
              caption={message.content}
              onClose={() => {
                setIsViewerOpen(false);
                setSelectedImageIndex(null);
              }}
            />
          );
        })()}

        {isOptionsOpen && <MessageContextMenu
          anchor={anchor}
          matchId={message.matchId}
          messageId={message.id}
          currentUserId={currentUserId}
          canDeleteEveryone={isMe && Date.now() - new Date(message.sentAt).getTime() <= 15 * 60000}
          onStar={() => void setMark('star')}
          onPin={() => void setMark('pin')}
          onSelect={() => { setIsOptionsOpen(false); onToggleSelection?.(message.id); }}
          isVisible={isOptionsOpen}
          onClose={() => setIsOptionsOpen(false)}
          onDeleteForMe={handleDeleteForMe}
          onDeleteForEveryone={handleDeleteForEveryone}
          onCopy={handleCopyText}
          hasText={!isVoiceNote && Boolean(message.content)}
          isDocument={isDocumentMessage}
          isVoice={isVoiceNote}
          onOpenFile={() => void handleOpenFile()}
          onSaveFile={() => void handleSaveFile()}
          onShareFile={() => void handleShareFile()}
          onReport={handleReportMessage}
          onReaction={handleReaction}
          currentReaction={message.reactions?.[currentUserId] ?? null}
          reactionPending={reactionPending}
          onOpenFullReactions={() => { setIsOptionsOpen(false); setFullReactionsOpen(true); }}
          reactionCount={Object.keys(message.reactions ?? {}).length}
          onShowReactions={() => { setIsOptionsOpen(false); showReactors(); }}
          canEdit={Boolean(onEdit) && canEditMessage(message, currentUserId)}
          onEdit={() => { setIsOptionsOpen(false); onEdit?.(message); }}
          onReply={() => { setIsOptionsOpen(false); onReply?.(message); }}
          isMe={isMe}
        />}
        {fullReactionsOpen && <EmojiPicker
          open
          onClose={() => setFullReactionsOpen(false)}
          onEmojiSelected={(picked: { emoji: string }) => {
            setFullReactionsOpen(false);
            void handleReaction(picked.emoji);
          }}
          enableSearchBar
          enableRecentlyUsed
          categoryPosition="top"
          theme={{
            backdrop: 'rgba(0,0,0,0.45)',
            knob: colors.text.tertiary,
            container: '#1E1E1E',
            header: colors.text.primary,
            category: { icon: colors.text.tertiary, iconActive: colors.primary, container: '#1E1E1E', containerActive: '#2A2A2A' },
            search: { text: colors.text.primary, placeholder: colors.text.tertiary, icon: colors.text.tertiary, background: '#2A2A2A' },
          }}
        />}
        {reactorsMounted && <ReactionsSheet visible={reactorsOpen} onClose={() => setReactorsOpen(false)} matchId={message.matchId} messageId={message.id} />}
      </TouchableOpacity>
      {sendFailure ? (
        <TouchableOpacity
          style={styles.sendFailure}
          accessibilityRole="button"
          accessibilityLabel={`${sendFailure.label}. ${sendFailure.detail} Retry message`}
          disabled={selectionMode}
          onPress={() => onRetryMessage?.(message.id)}
        >
          <Ionicons name="alert-circle-outline" size={17} color="#FF9DA5" />
          <View style={styles.sendFailureBody}>
            <Text style={styles.sendFailureTitle}>{sendFailure.label}</Text>
            <Text style={styles.sendFailureDetail} numberOfLines={2}>{sendFailure.detail}</Text>
          </View>
          <Ionicons name="refresh" size={16} color="#F3C1CA" />
          <Text style={styles.sendFailureRetry}>Retry</Text>
        </TouchableOpacity>
      ) : null}
      {visibleReactionGroups.length > 0 ? (
        <Animated.View style={[styles.reactionSummaryRow, isMe ? styles.reactionSummaryRowSent : styles.reactionSummaryRowReceived, reactionFadeStyle]}>
          {visibleReactionGroups.map(group => (
            <Animated.View
              key={group.emoji}
            >
              <TouchableOpacity
                activeOpacity={0.72}
                disabled={reactionPending}
                onPress={() => void handleReaction(group.emoji)}
                onLongPress={showReactors}
                delayLongPress={250}
                accessibilityRole="button"
                accessibilityLabel={`${group.emoji} reaction${group.count > 1 ? `, ${group.count}` : ''}${group.selected ? ', selected' : ''}`}
                accessibilityState={{ selected: group.selected, disabled: reactionPending }}
                style={[
                  styles.reactionChip,
                  isMe ? styles.reactionChipSent : styles.reactionChipReceived,
                  group.selected && styles.reactionChipSelected,
                ]}
              >
                <Text style={styles.reactionChipEmoji}>{group.emoji}</Text>
                {/* A private chat shows who reacted rather than how many, as
                    Telegram does; the count is the fallback without avatars. */}
                {reactorAvatars && group.userIds.every(id => reactorAvatars[id]) ? (
                  <View style={styles.reactionAvatars}>
                    {group.userIds.slice(0, 3).map((id, index) => (
                      <Image key={id} source={{ uri: reactorAvatars[id]! }} style={[styles.reactionAvatar, index > 0 && styles.reactionAvatarOverlap]} />
                    ))}
                  </View>
                ) : group.count > 1 ? <Text style={[styles.reactionChipCount, group.selected && styles.reactionChipCountSelected]}>{group.count}</Text> : null}
              </TouchableOpacity>
            </Animated.View>
          ))}
        </Animated.View>
      ) : null}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
});


/** What a first-message comment answered (like-comment.service.ts): their photo, or the start of their bio. */
function CommentAboutCard({ metadata, isMe }: { metadata: Record<string, unknown>; isMe: boolean }) {
  const about = metadata.about as { kind?: string; photoUrl?: string | null; text?: string | null } | undefined;
  if (!about || (about.kind !== 'photo' && about.kind !== 'bio')) return null;
  const what = about.kind === 'photo' ? 'photo' : 'bio';
  const label = `${isMe ? 'Your comment on their' : 'Commented on your'} ${what}`;
  return (
    <View style={[styles.commentAbout, isMe && styles.commentAboutMe]} accessibilityLabel={label}>
      {about.kind === 'photo' && about.photoUrl ? (
        <Image source={{ uri: about.photoUrl }} style={styles.commentThumb} accessible={false} />
      ) : (
        <View style={[styles.commentQuoteBar, isMe && styles.commentQuoteBarMe]} />
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.commentLabel, isMe && styles.commentLabelMe]}>{label}</Text>
        {about.kind === 'bio' && !!about.text ? (
          <Text numberOfLines={2} style={[styles.commentQuote, isMe && styles.commentQuoteMe]}>{about.text}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sensitiveCover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5, elevation: 5, backgroundColor: '#2C2C2E', alignItems: 'center', justifyContent: 'center', padding: 12 },
  sensitiveTitle: { marginTop: 8, color: '#FFF', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  sensitiveActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  sensitiveButton: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.18)' },
  sensitiveButtonText: { color: '#FFF', fontSize: 13, fontWeight: '600' },
  hiddenWords: { fontStyle: 'italic', color: '#A8A2AA' },
  botherRow: { fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 16, color: '#C9C1CB', marginTop: 6 },
  botherLink: { fontFamily: 'DMSans_700Bold', color: '#F3C1CA' },
  sendFailure: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 7, minHeight: 44, maxWidth: width * 0.82, paddingHorizontal: 11, paddingVertical: 8, marginTop: 5, borderRadius: 12, backgroundColor: '#2B1D20' },
  sendFailureBody: { flexShrink: 1 },
  sendFailureTitle: { color: '#FFD5DA', fontSize: 12, fontWeight: '600' },
  sendFailureDetail: { color: '#C8B5BA', fontSize: 11, lineHeight: 15, marginTop: 2 },
  sendFailureRetry: { color: '#F3C1CA', fontSize: 12, fontWeight: '700' },
  roseNoteTag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingTop: 8 },
  commentAbout: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 8, marginTop: 8, padding: 6, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.06)', maxWidth: 240 },
  commentAboutMe: { backgroundColor: 'rgba(255,255,255,0.14)' },
  commentThumb: { width: 36, height: 46, borderRadius: 8, backgroundColor: '#3A3337' },
  commentQuoteBar: { width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: '#E0457B' },
  commentQuoteBarMe: { backgroundColor: '#FFD6E3' },
  commentLabel: { fontSize: 11, fontWeight: '700', color: '#E0457B' },
  commentLabelMe: { color: '#FFD6E3' },
  commentQuote: { fontSize: 12, lineHeight: 16, fontStyle: 'italic', color: '#6E6268' },
  commentQuoteMe: { color: '#FFE9F0' },
  roseNoteText: { fontSize: 11, fontWeight: '700', color: '#E0457B' },
  roseNoteTextMe: { color: '#FFD6E3' },
  voiceRate: { position: 'absolute', top: 5, right: 9, minWidth: 28, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.22)', alignItems: 'center', justifyContent: 'center' },
  voiceRateText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  messageLink: { color: '#FFFFFF', textDecorationLine: 'underline' },
  messageBold: { fontWeight: '700' },
  messageItalic: { fontStyle: 'italic' },
  messageCode: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', backgroundColor: 'rgba(0,0,0,0.2)' },
  messageSpoilerHidden: { color: 'rgba(255,255,255,0.55)', backgroundColor: 'rgba(255,255,255,0.45)' },
  messageSpoilerVisible: { color: '#fff', backgroundColor: 'rgba(255,255,255,0.10)' },
  linkPreview: { marginHorizontal: 5, marginTop: 4, overflow: 'hidden', borderRadius: 12, borderLeftWidth: 3 },
  linkPreviewSent: { backgroundColor: 'rgba(255,255,255,0.12)', borderLeftColor: '#FFFFFF' },
  linkPreviewReceived: { backgroundColor: 'rgba(255,255,255,0.055)', borderLeftColor: colors.primary },
  linkPreviewImage: { width: '100%', height: 116 },
  linkPreviewBody: { paddingHorizontal: 9, paddingVertical: 7 },
  linkPreviewSite: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  linkPreviewSiteSent: { color: '#FFFFFF' },
  linkPreviewSiteReceived: { color: colors.primary },
  linkPreviewTitle: { color: '#FFFFFF', fontSize: 14, lineHeight: 18, fontWeight: '600' },
  linkPreviewDescription: { color: 'rgba(255,255,255,0.7)', fontSize: 13, lineHeight: 17, marginTop: 1 },
  reactionSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    zIndex: 3,
    overflow: 'hidden',
  },
  reactionSummaryRowSent: { alignSelf: 'flex-end', marginRight: 8 },
  reactionSummaryRowReceived: { alignSelf: 'flex-start', marginLeft: 8 },
  reactionChip: {
    minWidth: 34,
    height: 25,
    paddingHorizontal: 7,
    borderRadius: 13,
    borderWidth: 1.25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  reactionChipSent: {
    backgroundColor: '#2D2924',
    borderColor: '#F59E0B',
  },
  reactionChipReceived: {
    backgroundColor: '#2D2924',
    borderColor: '#F59E0B',
  },
  reactionChipSelected: {
    backgroundColor: '#3B2C18',
    borderColor: '#FF9F0A',
  },
  reactionChipEmoji: { fontSize: 14, lineHeight: 18 },
  reactionAvatars: { flexDirection: 'row', marginLeft: 4 },
  reactionAvatar: { width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(0,0,0,0.35)', backgroundColor: '#333' },
  reactionAvatarOverlap: { marginLeft: -5 },
  reactionChipCount: { color: 'rgba(255,255,255,0.72)', fontSize: 11, lineHeight: 14, fontWeight: '600' },
  reactionChipCountSelected: { color: '#FFFFFF' },
  quote: {
    minWidth: 116,
    maxWidth: width * 0.72,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'stretch',
    // The 5 px inset leaves a 12 px concentric radius inside the 17 px bubble.
    borderRadius: 12,
    marginHorizontal: 5,
    marginTop: 4,
    marginBottom: 1,
    paddingVertical: 0,
    paddingLeft: 0,
    paddingRight: 8,
    overflow: 'hidden',
  },
  quoteSent: { backgroundColor: 'rgba(255,255,255,0.12)' },
  quoteReceived: { backgroundColor: 'rgba(255,255,255,0.055)' },
  // Fill the complete rounded left edge instead of drawing a detached line.
  quoteLine: { width: 3, marginRight: 8 },
  quoteLineSent: { backgroundColor: '#FFFFFF' },
  quoteLineReceived: { backgroundColor: colors.primary },
  quoteContent: { flexShrink: 1, justifyContent: 'center', paddingVertical: 4 },
  quoteAuthor: { fontSize: 14, lineHeight: 17, fontWeight: '600', includeFontPadding: false },
  quoteAuthorSent: { color: '#FFFFFF' },
  quoteAuthorReceived: { color: colors.primary },
  quoteText: { fontSize: 14, lineHeight: 17, includeFontPadding: false },
  quoteTextSent: { color: 'rgba(255,255,255,0.82)' },
  quoteTextReceived: { color: 'rgba(255,255,255,0.72)' },
  messageRow: {
    marginBottom: 2,
    position: 'relative',
  },
  swipeReplyContent: { width: '100%' },
  swipeReplyContentRight: { alignItems: 'flex-end' },
  swipeReplyContentLeft: { alignItems: 'flex-start' },
  swipeReplyIndicator: {
    position: 'absolute',
    top: '50%',
    width: 34,
    height: 34,
    marginTop: -17,
    borderRadius: 17,
    backgroundColor: '#2D2924',
    borderWidth: 1.25,
    borderColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeReplyIndicatorLeft: { left: 5 },
  swipeReplyIndicatorRight: { right: 5 },
  messageRowSelected: {
    // Read through the menu's rgba(0,0,0,0.38) scrim, which cuts the effective
    // alpha to roughly a third of what is set here.
    backgroundColor: 'rgba(242, 13, 128, 0.30)',
    // Bleed past the list's paddingHorizontal so the band runs edge to edge,
    // then put the padding back so the bubble does not move when it is
    // selected. Square corners: this is a full-width selection, not a card.
    marginHorizontal: -MESSAGE_LIST_PADDING_H,
    paddingHorizontal: MESSAGE_LIST_PADDING_H,
  },
  // The row is counter-transformed by the inverted list, so its bottom margin
  // remains below the visible bubble. Separate groups after their last item.
  messageGroupBreak: {
    marginBottom: 7,
  },
  messageRowRight: {
    alignItems: 'flex-end',
  },
  messageRowLeft: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: width * 0.78,
    paddingHorizontal: 1,
    paddingVertical: 3,
    borderRadius: 17,
    position: 'relative',
    zIndex: 1,
  },
  imageOnlyBubble: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  voiceBubbleShell: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    backgroundColor: 'transparent',
  },
  bubbleSent: {
    backgroundColor: colors.primary,
  },
  bubbleReceived: {
    backgroundColor: '#1C1C1C',
  },
  bubbleSentSingle: {
    borderBottomRightRadius: 5,
  },
  bubbleSentTop: {
    borderBottomRightRadius: 6,
  },
  bubbleSentMiddle: {
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
  },
  bubbleSentBottom: {
    borderTopRightRadius: 6,
    borderBottomRightRadius: 5,
  },
  bubbleReceivedSingle: {
    borderBottomLeftRadius: 5,
  },
  bubbleReceivedTop: {
    borderBottomLeftRadius: 6,
  },
  bubbleReceivedMiddle: {
    borderTopLeftRadius: 6,
    borderBottomLeftRadius: 6,
  },
  bubbleReceivedBottom: {
    borderTopLeftRadius: 6,
    borderBottomLeftRadius: 5,
  },
  bubbleText: {
    fontSize: 16,
    lineHeight: 21,
  },
  readMoreRow: {
    alignSelf: 'flex-start',
    paddingTop: 2,
    // The timestamp is pinned to the bottom of this wrapper, so this padding is
    // what holds it clear of the bubble's bottom edge. Matches the gap a bubble
    // without a Read more row gets from the text's own descender space.
    paddingBottom: 6,
  },
  readMore: {
    fontSize: 13,
    fontWeight: '600',
  },
  readMoreSent: {
    color: 'rgba(255,255,255,0.85)',
  },
  readMoreReceived: {
    color: colors.primary,
  },
  bubbleTextSent: {
    color: '#fff',
  },
  bubbleTextReceived: {
    color: colors.text.primary,
  },
  bubbleMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 2,
  },
  textMetadata: {
    position: 'absolute',
    // Keep the time and receipt together, below the message text baseline.
    // The wrapper and bubble retain 4 dp below this row.
    bottom: -4,
    right: -4,
  },
  // Received bubbles only. Their right edge has no tail, so the overhang above
  // leaves the time hard against the rounded corner. Sent bubbles keep the
  // original offset - the tail on that side already carries the eye outwards.
  textMetadataReceived: {
    right: 4,
  },
  bubbleTime: {
    fontSize: 11,
    lineHeight: 14,
  },
  bubbleTimeSent: {
    color: 'rgba(255,255,255,0.6)',
  },
  bubbleTimeReceived: {
    color: colors.text.tertiary,
  },
  textContentWrapper: {
    paddingBottom: 5,
    paddingTop: 3,
    paddingHorizontal: 10,
  },
  // Telegram-style media grid.
  gridContainer: {
    width: width * 0.72,
    borderRadius: 18,
    borderWidth: 1.25,
    borderColor: 'rgba(255,255,255,0.28)',
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  imageOnlyContainer: {
  },
  sentImageContainer: {
    borderBottomRightRadius: 4,
  },
  receivedImageContainer: {
    borderBottomLeftRadius: 4,
  },
  mediaGrid: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  // These hold a picture each, and are on screen before the pictures are. A
  // cell that draws nothing is transparent, and what shows through it is the
  // chat's background - which is why an album could open as black squares.
  singleImageWrapper: {
    width: '100%',
    aspectRatio: 3 / 4,
    backgroundColor: '#292929',
  },
  gridRow: {
    flexDirection: 'row',
    width: '100%',
    aspectRatio: 1, // Square overall
    gap: 1.25,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  gridCol: {
    flex: 1,
    gap: 1.25,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  gridItemHalf: {
    flex: 1,
    height: '100%',
    backgroundColor: '#292929',
  },
  gridItemLarge: {
    flex: 2,
    height: '100%',
    backgroundColor: '#292929',
  },
  gridItemSmall: {
    flex: 1,
    height: '100%',
    backgroundColor: '#292929',
  },
  grid2x2: {
    width: '100%',
    aspectRatio: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 1.25,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  gridItemQuarter: {
    width: '49.5%', // Slightly less than 50% for gap
    height: '49.5%',
    position: 'relative',
    backgroundColor: '#292929',
  },
  moreOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  moreText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
  },
  uploadOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.36)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  uploadProgressCircle: {
    width: 42,
    height: 42,
    justifyContent: 'center',
    alignItems: 'center',
  },
  uploadProgressText: {
    marginTop: 5,
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: 2,
    // A photo that has not arrived yet is a tile the size of the photo, not a
    // hole. Without this the placeholder is transparent and what shows through
    // is the chat's own background - a picture-shaped piece of black, which is
    // what a media message looked like until its image had loaded.
    backgroundColor: '#292929',
  },
  mediaStatus: { alignItems: 'center', justifyContent: 'center' },
  mediaStatusText: { color: '#fff', fontSize: 12, marginTop: 6 },
  videoPlayBadge: { width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  videoDurationBadge: { position: 'absolute', left: 8, top: 8, paddingHorizontal: 7, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center' },
  videoDurationText: { color: '#fff', fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  documentTile: {
    width: '100%',
    height: '100%',
    minHeight: 110,
    backgroundColor: '#252529',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 12,
  },
  documentName: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 7,
    textAlign: 'center',
  },
  documentBubble: {
    width: Math.min(width * 0.78, 330),
    minHeight: 68,
    paddingHorizontal: 6,
    paddingTop: 4,
    paddingBottom: 2,
  },
  documentInnerPanel: { flexDirection: 'row', alignItems: 'center', padding: 6, borderRadius: 12 },
  documentPreview: {
    width: 52,
    height: 52,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  documentPreviewImage: { width: '100%', height: '100%', backgroundColor: '#292929' },
  documentDetails: { flex: 1, minWidth: 0, marginLeft: 10, paddingRight: 4, alignSelf: 'stretch', justifyContent: 'center' },
  documentFileName: { color: '#fff', fontSize: 15, lineHeight: 19, fontWeight: '600' },
  documentFileInfo: { color: 'rgba(255,255,255,0.58)', fontSize: 12, lineHeight: 16, marginTop: 1 },
  documentMeta: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: 2, marginRight: -1, marginBottom: -1 },
  documentTime: { color: 'rgba(255,255,255,0.58)', fontSize: 11, lineHeight: 14 },
  documentMore: { width: 24, height: 32, alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center' },
  imageGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 40,
    justifyContent: 'flex-end',
    padding: 6,
  },
  imageMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  imageTime: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '500',
  },
  imagePlaceholder: {
    width: '100%',
    aspectRatio: 3 / 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  errorText: {
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  voiceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 16,
    width: 240,
  },
  voiceWaveformArea: {
    flex: 1,
    minWidth: 0,
    marginLeft: 14,
    height: 42,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  voiceWaveformTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    height: 26,
    paddingRight: 34,
    overflow: 'hidden',
  },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
