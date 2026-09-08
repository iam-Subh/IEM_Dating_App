import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions, Image, ActivityIndicator, Alert, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import Slider from '@react-native-community/slider';
import { useDispatch, useSelector } from 'react-redux';
import { useQuery } from '@tanstack/react-query';
import { colors } from '../../../core/theme/colors';
import { applyMessageEdit, applyReaction, Message, removeMessage } from '../../../store/chatSlice';
import { LinearGradient } from 'expo-linear-gradient';
import { api } from '../../../services/api';
import { ImageModal } from './ImageModal';
import { MessageOptionsSheet } from './MessageOptionsSheet';
import { RootState } from '../../../store';

const { width } = Dimensions.get('window');

function formatMessageTime(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

const VoicePlayerBubble = ({ 
  uri, 
  isMe, 
  initialDuration, 
  sentAt, 
  messageId,
  readAt,
  waveform,
}: { 
  uri: string; 
  isMe: boolean; 
  initialDuration?: string; 
  sentAt?: string; 
  messageId?: string; 
  readAt?: string | null; 
  waveform?: number[];
}) => {
  const player = useAudioPlayer(uri, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const initialDurationMs = initialDuration ? parseFloat(initialDuration) * 1000 : 0;
  const isPlaying = status.playing;
  const durationMs = status.duration > 0 ? status.duration * 1000 : initialDurationMs;
  const positionMs = status.currentTime * 1000;

  useEffect(() => {
    if (status.didJustFinish) {
      player.seekTo(0).catch(() => {});
    }
  }, [player, status.didJustFinish]);

  const handlePlayPause = React.useCallback(async () => {
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      if (isPlaying) {
        player.pause();
      } else {
        player.play();
      }
    } catch (err) {
      console.error('[VoicePlayer] Toggle error:', err);
    }
  }, [isPlaying, player]);

  const handleSeek = React.useCallback(async (value: number) => {
    try {
      await player.seekTo(value / 1000);
    } catch {
      // ignore seek errors
    }
  }, [player]);

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
  const barHeights = waveform?.length ? waveform.map((value) => 6 + Math.round(value * 20)) : fallbackHeights;

  const handleWaveformPress = (evt: any) => {
    const x = evt.nativeEvent.locationX;
    // Assuming container flex layout leaves roughly 150-180px for the bars
    const widthEstimate = barHeights.length * 5; // index * (width+margin)
    const pct = Math.min(Math.max(x / widthEstimate, 0), 1);
    const targetMs = pct * durationMs;
    player.seekTo(targetMs / 1000).catch(() => {});
  };

  const Container = isMe ? LinearGradient : View;
  const containerProps = isMe ? {
    colors: ['#FF758C', '#F94E27'],
    start: { x: 0, y: 0 },
    end: { x: 1, y: 0 }
  } : {};

  return (
    <Container
      {...containerProps as any}
      style={[
        styles.voiceContainer, 
        { 
          borderRadius: 24, 
          width: width * 0.75, 
          paddingVertical: 12,
          alignItems: 'center',
        },
        isMe ? { borderBottomRightRadius: 4 } : { borderBottomLeftRadius: 4 },
        !isMe && styles.voiceReceived
      ]}
    >
      <TouchableOpacity onPress={handlePlayPause} style={{
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: isMe ? 'rgba(255,255,255,0.25)' : '#3A3A3C',
        justifyContent: 'center',
        alignItems: 'center',
        paddingLeft: isPlaying ? 0 : 3, // compensate play icon alignment
      }}>
        <Ionicons name={isPlaying ? 'pause' : 'play'} size={20} color={isMe ? '#FFF' : '#F94E27'} />
      </TouchableOpacity>
      
      <View style={{ flex: 1, marginLeft: 14, height: 42, justifyContent: 'center' }}>
        <TouchableOpacity 
          activeOpacity={0.8} 
          onPress={handleWaveformPress} 
          style={{ flexDirection: 'row', alignItems: 'center', height: 26 }}
        >
          {barHeights.map((h, i) => {
            const progress = positionMs / (durationMs || 1);
            const isActive = progress >= i / barHeights.length;
            return (
              <View 
                key={i} 
                style={{
                  width: 3,
                  height: h,
                  borderRadius: 1.5,
                  backgroundColor: isActive 
                    ? (isMe ? '#FFF' : '#F94E27') 
                    : (isMe ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.15)'),
                  marginHorizontal: 1,
                }} 
              />
            );
          })}
        </TouchableOpacity>
      </View>

      {/* Inline Time & Tick for Voice Note */}
      <View style={{ 
        position: 'absolute', 
        bottom: 6, 
        left: 68, 
        right: 12, 
        flexDirection: 'row', 
        justifyContent: 'space-between',
        alignItems: 'center' 
      }}>
        <Text style={{ fontSize: 11, color: isMe ? '#FFF' : colors.text.secondary, fontWeight: '500' }}>
          {formatTime(positionMs > 0 ? positionMs : durationMs)}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontSize: 9, color: isMe ? 'rgba(255,255,255,0.85)' : colors.text.tertiary }}>
            {sentAt ? formatMessageTime(sentAt) : ''}
          </Text>
          {isMe && (
            <Ionicons
              name={messageId?.startsWith('temp-') ? 'time-outline' : readAt ? 'checkmark-done' : 'checkmark'}
              size={11}
              color={readAt ? '#60a5fa' : 'rgba(255,255,255,0.6)'}
              style={{ marginLeft: 3 }}
            />
          )}
        </View>
      </View>
    </Container>
  );
};

interface MessageBubbleProps {
  message: Message;
  isMe: boolean;
  showTime: boolean;
  onReply?: (message: Message) => void;
  replyPreview?: string;
}

export const MessageBubble = React.memo(({ message, isMe, showTime, onReply, replyPreview }: MessageBubbleProps) => {
  const dispatch = useDispatch();
  const currentUserId = useSelector((state: RootState) => state.auth.user?.id ?? 'me');
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.content);

  // Optimized Media Fetching via React Query (Global Caching)
  const mediaKeys = (message.mediaKeys && message.mediaKeys.length > 0) 
    ? message.mediaKeys 
    : (message.mediaKey ? [message.mediaKey] : []);
  
  const { data: imageUrls, isLoading: imageLoading, isError: imageError } = useQuery({
    queryKey: ['chat-media-list', mediaKeys],
    queryFn: async () => {
      if (mediaKeys.length === 0) return [];
      
      const promises = mediaKeys.map(async (key) => {
        if (key.startsWith('local-')) return key.replace('local-voice-', '').replace('local-', '');
        
        const response = await api.get('/chat/media/read', {
          params: { key }
        });
        return response.data?.success ? response.data.data : null;
      });
      
      return Promise.all(promises);
    },
    enabled: mediaKeys.length > 0,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 14,
  });

  const isVoiceNote = mediaKeys.some(key => {
    const k = key.toLowerCase();
    return k.endsWith('.m4a') || 
           k.endsWith('.mp3') || 
           k.endsWith('.wav') || 
           k.includes('audio') ||
           k.includes('voice') ||
           (k.startsWith('local-') && (k.endsWith('.m4a') || k.endsWith('.wav') || k.endsWith('.pcm')));
  });

  const isImageOnly = mediaKeys.length > 0 && !message.content && !isVoiceNote;
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);

  const handleLongPress = () => {
    if (message.id.startsWith('temp-')) return;
    setIsOptionsOpen(true);
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

  const handleReportMessage = () => {
    setIsOptionsOpen(false);
    Alert.alert(
      "Report Message",
      "Are you sure you want to report this message for review?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Report", 
          onPress: async () => {
            try {
              await api.post('/safety/report', {
                reportedUserId: message.senderId,
                matchId: message.matchId,
                reason: 'inappropriate_message',
                sourceType: 'message',
                sourceId: message.id,
              });
              Alert.alert('Report sent', 'The safety team will review this message.');
            } catch {
              Alert.alert('Report failed', 'Try again when you have a network connection.');
            }
          }
        }
      ]
    );
  };

  const handleReaction = async (emoji: string) => {
    setIsOptionsOpen(false);
    dispatch(applyReaction({ matchId: message.matchId, messageId: message.id, userId: currentUserId, emoji }));
    try { await api.put(`/chat/${message.matchId}/messages/${message.id}/reaction`, { emoji }); }
    catch { dispatch(applyReaction({ matchId: message.matchId, messageId: message.id, userId: currentUserId, emoji: null })); }
  };

  const saveEdit = async () => {
    const content = editText.trim();
    if (!content) return;
    try {
      const response = await api.patch(`/chat/${message.matchId}/messages/${message.id}`, { content, expectedRevision: message.revision ?? 1 });
      const value = response.data.data;
      dispatch(applyMessageEdit({ matchId: message.matchId, messageId: message.id, content: value.content, revision: value.revision, editedAt: value.editedAt }));
      setIsEditing(false);
    } catch { Alert.alert('Edit failed', 'The message changed or the edit window expired.'); }
  };

  // Don't render bubble if it's completely empty (no text, no images)
  if (!message.content && mediaKeys.length === 0) return null;

  return (
    <View style={[styles.messageRow, isMe ? styles.messageRowRight : styles.messageRowLeft]}>
      <TouchableOpacity
        activeOpacity={0.8}
        onLongPress={handleLongPress}
        delayLongPress={100}
        style={[
          styles.bubble,
          isMe ? styles.bubbleSent : styles.bubbleReceived,
          mediaKeys.length > 0 && styles.imageOnlyBubble
        ]}
      >
        {/* Render Image Grid */}
        {mediaKeys.length > 0 && (
          isVoiceNote ? (
            <VoicePlayerBubble 
              uri={imageUrls?.[0] || mediaKeys[0].replace('local-voice-', '').replace('local-', '')} 
              isMe={isMe} 
              initialDuration={message.content}
              sentAt={message.sentAt}
              messageId={message.id}
              readAt={message.readAt}
              waveform={Array.isArray(message.metadata?.waveform) ? message.metadata.waveform as number[] : undefined}
            />
          ) : (
          <View style={[
            styles.gridContainer,
            isImageOnly && styles.imageOnlyContainer,
            isMe ? styles.sentImageContainer : styles.receivedImageContainer,
            !isImageOnly && { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottomWidth: 0 }
          ]}>
            {imageLoading ? (
              <View style={styles.imagePlaceholder}>
                <ActivityIndicator color={isMe ? '#fff' : colors.primary} />
              </View>
            ) : imageError ? (
              <View style={styles.imagePlaceholder}>
                <Ionicons name="image-outline" size={24} color={isMe ? 'rgba(255,255,255,0.5)' : colors.text.tertiary} />
                <Text style={[styles.errorText, { color: isMe ? 'white' : colors.text.secondary }]}>Failed to load photos</Text>
              </View>
            ) : (
              <View style={styles.mediaGrid}>
                {mediaKeys.length === 1 && (
                  <TouchableOpacity 
                    activeOpacity={0.9} 
                    onPress={() => {
                      if (imageUrls?.[0]) {
                        setSelectedImageIndex(0);
                        setIsViewerOpen(true);
                      }
                    }}
                    style={styles.singleImageWrapper}
                  >
                    {imageUrls?.[0] ? (
                      <Image source={{ uri: imageUrls[0] }} style={styles.image} resizeMode="cover" />
                    ) : (
                      <View style={styles.imagePlaceholder}>
                        <ActivityIndicator color={isMe ? '#fff' : colors.primary} />
                      </View>
                    )}
                  </TouchableOpacity>
                )}

                {mediaKeys.length === 2 && (
                  <View style={styles.gridRow}>
                    {imageUrls?.slice(0, 2).map((url, i) => (
                      <TouchableOpacity 
                        key={i} 
                        style={styles.gridItemHalf} 
                        onPress={() => {
                          if (url) {
                            setSelectedImageIndex(i);
                            setIsViewerOpen(true);
                          }
                        }}
                      >
                        {url ? (
                          <Image source={{ uri: url }} style={styles.image} />
                        ) : (
                          <View style={styles.imagePlaceholder}>
                            <ActivityIndicator size="small" color={isMe ? '#fff' : colors.primary} />
                          </View>
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {mediaKeys.length === 3 && (
                  <View style={styles.gridRow}>
                    <TouchableOpacity 
                      style={styles.gridItemLarge}
                      onPress={() => {
                        setSelectedImageIndex(0);
                        setIsViewerOpen(true);
                      }}
                    >
                      <Image source={{ uri: imageUrls?.[0] }} style={styles.image} />
                    </TouchableOpacity>
                    <View style={styles.gridCol}>
                      {imageUrls?.slice(1, 3).map((url, i) => (
                        <TouchableOpacity 
                          key={i} 
                          style={styles.gridItemSmall}
                          onPress={() => {
                            setSelectedImageIndex(i + 1);
                            setIsViewerOpen(true);
                          }}
                        >
                          <Image source={{ uri: url }} style={styles.image} />
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}

                {mediaKeys.length >= 4 && (
                  <View style={styles.grid2x2}>
                    {imageUrls?.slice(0, 4).map((url, i) => (
                      <TouchableOpacity 
                        key={i} 
                        style={styles.gridItemQuarter}
                        onPress={() => {
                          setSelectedImageIndex(i);
                          setIsViewerOpen(true);
                        }}
                      >
                        <Image source={{ uri: url }} style={styles.image} />
                        {i === 3 && mediaKeys.length > 4 && (
                          <View style={styles.moreOverlay}>
                            <Text style={styles.moreText}>+{mediaKeys.length - 3}</Text>
                          </View>
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
                        <Text style={styles.imageTime}>{formatMessageTime(message.sentAt)}</Text>
                        {isMe && (
                          <Ionicons
                            name={message.id.startsWith('temp-') ? 'time-outline' : (message.readAt ? 'checkmark-done' : 'checkmark')}
                            size={13}
                            color={message.readAt ? '#0ea5e9' : 'rgba(255,255,255,0.7)'}
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
        {message.replyToId && <View style={styles.quote}><Text style={styles.quoteText} numberOfLines={2}>{replyPreview ?? 'Original message is unavailable'}</Text></View>}
        {!!message.content && !isVoiceNote && (
          <View style={[
            styles.textContentWrapper, 
            mediaKeys.length > 0 && { 
              backgroundColor: '#064e3b', 
              paddingTop: 8, 
              width: width * 0.72,
            }
          ]}>
            <View style={{ position: 'relative', alignSelf: mediaKeys.length > 0 ? 'stretch' : 'flex-start' }}>
              {isEditing ? <View style={styles.editRow}><TextInput value={editText} onChangeText={setEditText} maxLength={2000} autoFocus style={styles.editInput} /><TouchableOpacity onPress={saveEdit}><Ionicons name="checkmark-circle" size={24} color={colors.primary} /></TouchableOpacity></View> : <Text style={[
                styles.bubbleText, 
                isMe ? styles.bubbleTextSent : styles.bubbleTextReceived, 
                mediaKeys.length > 0 ? { marginTop: 0 } : {}, 
              ]}>
                {message.content}
                {message.editedAt ? <Text style={styles.edited}> edited</Text> : null}
                <View style={{ width: 65, height: 18 }} />
              </Text>}

              {/* Message Meta for Text (Time & Status) */}
              <View style={[styles.bubbleMeta, { position: 'absolute', bottom: -2, right: -4 }]}>
                <Text style={[styles.bubbleTime, isMe ? styles.bubbleTimeSent : styles.bubbleTimeReceived]}>
                  {formatMessageTime(message.sentAt)}
                </Text>
                {isMe && (
                  <Ionicons
                    name={
                      message.id.startsWith('temp-')
                        ? 'time-outline'
                        : message.readAt
                          ? 'checkmark-done'
                          : 'checkmark'
                    }
                    size={message.id.startsWith('temp-') ? 13 : 14}
                    color={
                      message.id.startsWith('temp-')
                        ? 'rgba(255,255,255,0.35)'
                        : message.readAt
                          ? '#60a5fa'
                          : 'rgba(255,255,255,0.4)'
                    }
                    style={{ marginLeft: 4 }}
                  />
                )}
              </View>
            </View>
          </View>
        )}
        {message.reactions && Object.keys(message.reactions).length > 0 && <Text style={styles.reactionSummary}>{Object.values(message.reactions).join(' ')}</Text>}

        <ImageModal 
          isVisible={isViewerOpen} 
          imageUrls={imageUrls || []} 
          initialIndex={selectedImageIndex ?? 0}
          caption={message.content}
          onClose={() => {
            setIsViewerOpen(false);
            setSelectedImageIndex(null);
          }} 
        />

        <MessageOptionsSheet
          isVisible={isOptionsOpen}
          onClose={() => setIsOptionsOpen(false)}
          onDeleteForMe={handleDeleteForMe}
          onDeleteForEveryone={handleDeleteForEveryone}
          onCopy={handleCopyText}
          onReport={handleReportMessage}
          onReaction={handleReaction}
          onEdit={() => { setIsOptionsOpen(false); setEditText(message.content); setIsEditing(true); }}
          onReply={() => { setIsOptionsOpen(false); onReply?.(message); }}
          isMe={isMe}
        />
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  reactionSummary: { alignSelf: 'flex-end', color: '#fff', backgroundColor: '#2a2227', borderRadius: 12, paddingHorizontal: 7, paddingVertical: 2, marginTop: -4, fontSize: 13 },
  editRow: { flexDirection: 'row', alignItems: 'center', minWidth: 180 }, editInput: { flex: 1, color: '#fff', fontSize: 16, paddingVertical: 4 },
  edited: { color: 'rgba(255,255,255,.5)', fontSize: 10 },
  quote: { borderLeftWidth: 2, borderLeftColor: colors.primary, backgroundColor: 'rgba(255,255,255,.06)', paddingHorizontal: 8, paddingVertical: 5, margin: 4, borderRadius: 5 }, quoteText: { color: colors.text.secondary, fontSize: 12 },
  messageRow: {
    marginBottom: 4,
  },
  messageRowRight: {
    alignItems: 'flex-end',
  },
  messageRowLeft: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: width * 0.75,
    paddingHorizontal: 4, // Extremely tight gap
    paddingVertical: 8,
    borderRadius: 20,
  },
  imageOnlyBubble: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  bubbleSent: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  bubbleReceived: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 21,
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
  bubbleTime: {
    fontSize: 10,
  },
  bubbleTimeSent: {
    color: 'rgba(255,255,255,0.6)',
  },
  bubbleTimeReceived: {
    color: colors.text.tertiary,
  },
  textContentWrapper: {
    paddingBottom: 6,
    paddingTop: 2,
    paddingHorizontal: 12,
  },
  contentDivider: {
    height: 1.5,
    backgroundColor: '#064e3b', // Matches the Forest Green bubble border
    marginHorizontal: -4,
    marginVertical: 6,
    opacity: 0.8,
  },
  // WhatsApp Photo Grid Styles
  gridContainer: {
    width: width * 0.72,
    borderRadius: 20, // Matches bubble outer corner rounding Radius
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderWidth: 2,
    borderColor: '#064e3b', // Forest Green signature border
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
    backgroundColor: '#064e3b',
  },
  singleImageWrapper: {
    width: '100%',
    aspectRatio: 3 / 4,
  },
  gridRow: {
    flexDirection: 'row',
    width: '100%',
    aspectRatio: 1, // Square overall
    gap: 2,
    backgroundColor: '#064e3b',
  },
  gridCol: {
    flex: 1,
    gap: 2,
    backgroundColor: '#064e3b',
  },
  gridItemHalf: {
    flex: 1,
    height: '100%',
  },
  gridItemLarge: {
    flex: 2,
    height: '100%',
  },
  gridItemSmall: {
    flex: 1,
    height: '100%',
  },
  grid2x2: {
    width: '100%',
    aspectRatio: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
    backgroundColor: '#064e3b',
  },
  gridItemQuarter: {
    width: '49.5%', // Slightly less than 50% for gap
    height: '49.5%',
    position: 'relative',
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
  image: {
    width: '100%',
    height: '100%',
    borderRadius: 2,
  },
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
  voiceSent: {
    backgroundColor: 'transparent',
  },
  voiceReceived: {
    backgroundColor: 'transparent',
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
