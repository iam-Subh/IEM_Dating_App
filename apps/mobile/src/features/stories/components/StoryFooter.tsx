import React, { useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';

/** Instagram's eight quick reactions, in its order. */
export const QUICK_REACTIONS = ['😂', '😮', '😍', '😢', '👏', '🔥', '🎉', '💯'] as const;

type Props = {
  liked: boolean;
  bottomInset: number;
  inputRef: React.RefObject<TextInput | null>;
  onToggleLike: () => void;
  onSend: (content: string) => Promise<unknown>;
  onReact: (emoji: string) => void;
  onFocusChange: (focused: boolean) => void;
  /** False when the owner does not take replies from you: only the heart shows. */
  canReply?: boolean;
  /** A short reason shown in place of the message bar, only when it helps ("Match to reply"). */
  replyHint?: string | null;
};

/**
 * The footer on someone else's Story: "Send message", and a heart that likes
 * the Story privately. With the keyboard open and nothing typed, the quick
 * reactions appear above it. There is no share button, because Stories here
 * are followers-only and Instagram shows none on a private account's Story.
 */
export function StoryFooter({ liked, bottomInset, inputRef, onToggleLike, onSend, onReact, onFocusChange, canReply = true, replyHint }: Props) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const sendingRef = useRef(false);
  const heart = useSharedValue(1);
  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: heart.value }] }));

  const like = () => {
    heart.value = withSequence(withTiming(1.35, { duration: 110 }), withSpring(1, { damping: 8, stiffness: 220 }));
    onToggleLike();
  };
  const submit = async () => {
    const content = text.trim();
    if (!content || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setFailed(false);
    try {
      const sent = await onSend(content);
      if (sent === false) setFailed(true);
      else { setText(''); inputRef.current?.blur(); }
    } catch {
      setFailed(true);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const heartButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={liked ? 'Unlike Story' : 'Like Story'}
      accessibilityState={{ selected: liked }}
      onPress={like}
      hitSlop={8}
      style={styles.iconButton}
    >
      <Animated.View style={heartStyle}>
        <Ionicons name={liked ? 'heart' : 'heart-outline'} size={28} color={liked ? '#FF3040' : '#fff'} />
      </Animated.View>
    </Pressable>
  );

  // Replies off, limited to a list, or no match: no message bar or reactions, the heart stays.
  if (!canReply) {
    return (
      <View style={styles.wrap}>
        <View style={[styles.row, { paddingBottom: bottomInset + 10 }]}>
          <View style={styles.noReply}>{replyHint ? <Text style={styles.noReplyText}>{replyHint}</Text> : null}</View>
          {heartButton}
        </View>
      </View>
    );
  }

  return (
    <KeyboardStickyView style={styles.wrap}>
      {failed ? <Text accessibilityLiveRegion="polite" style={{ color: '#FFD1D8', fontSize: 12, paddingHorizontal: 18, paddingBottom: 6 }}>Reply not sent. Tap Retry.</Text> : null}
      {focused && !text ? (
        <View style={styles.reactions}>
          {QUICK_REACTIONS.map((emoji) => (
            <Pressable
              key={emoji}
              accessibilityRole="button"
              accessibilityLabel={`React with ${emoji}`}
              onPress={() => {
                inputRef.current?.blur();
                onReact(emoji);
              }}
              style={styles.reaction}
            >
              <Text style={styles.reactionEmoji}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={[styles.row, { paddingBottom: focused ? 10 : bottomInset + 10 }]}>
        <TextInput
          ref={inputRef}
          accessibilityLabel="Reply to Story"
          value={text}
          onChangeText={value => { setText(value); setFailed(false); }}
          editable={!sending}
          placeholder="Send message"
          placeholderTextColor="rgba(255,255,255,0.85)"
          style={styles.input}
          returnKeyType="send"
          submitBehavior="submit"
          onSubmitEditing={submit}
          onFocus={() => {
            setFocused(true);
            onFocusChange(true);
          }}
          onBlur={() => {
            setFocused(false);
            onFocusChange(false);
          }}
        />
        {text.trim() ? (
          <Pressable accessibilityRole="button" accessibilityLabel={failed ? 'Retry reply' : 'Send reply'} accessibilityState={{ busy: sending, disabled: sending }} disabled={sending} onPress={submit} hitSlop={8} style={styles.iconButton}>
            <Text style={styles.send}>{sending ? 'Sending' : failed ? 'Retry' : 'Send'}</Text>
          </Pressable>
        ) : heartButton}
      </View>
    </KeyboardStickyView>
  );
}

/** Inactive cube faces show the same controls without mounting a keyboard input. */
export function StoryFooterPreview({ liked, bottomInset, canReply = true, replyHint }: { liked: boolean; bottomInset: number; canReply?: boolean; replyHint?: string | null }) {
  return (
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={styles.wrap}>
      <View style={[styles.row, { paddingBottom: bottomInset + 10 }]}>
        {canReply ? (
          <View style={[styles.input, { justifyContent: 'center' }]}>
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 15 }}>Send message</Text>
          </View>
        ) : (
          <View style={styles.noReply}>{replyHint ? <Text style={styles.noReplyText}>{replyHint}</Text> : null}</View>
        )}
        <View style={styles.iconButton}>
          <Ionicons name={liked ? 'heart' : 'heart-outline'} size={28} color={liked ? '#FF3040' : '#fff'} />
        </View>
      </View>
    </View>
  );
}

/** The footer on your own Story: who has seen and liked it. */
export function OwnStoryFooter({ avatars = [], viewCount, likeCount, bottomInset, onOpenActivity }: {
  /** Up to three of the first viewers, shown overlapping as Instagram does. */
  avatars?: string[];
  viewCount: number;
  likeCount: number;
  bottomInset: number;
  onOpenActivity: () => void;
}) {
  const shown = avatars.slice(0, 3);
  return (
    <View style={[styles.ownRow, { paddingBottom: bottomInset + 14 }]}>
      {/* One button that reads as one: who saw it, how many, and where to look. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Activity: ${viewCount} ${viewCount === 1 ? 'view' : 'views'}, ${likeCount} ${likeCount === 1 ? 'like' : 'likes'}`}
        onPress={onOpenActivity}
        hitSlop={8}
        style={({ pressed }) => [styles.activity, pressed && styles.activityPressed]}
      >
        {shown.length ? (
          <View style={[styles.avatars, { width: 26 + (shown.length - 1) * 15 }]}>
            {shown.map((uri, index) => (
              <Image key={`${uri}-${index}`} source={{ uri }} style={[styles.viewerAvatar, { left: index * 15, zIndex: 3 - index }]} />
            ))}
          </View>
        ) : null}
        {viewCount > 0 ? (
          <View style={styles.stats}>
            <View style={styles.stat}>
              <Ionicons name="eye-outline" size={17} color="#fff" />
              <Text style={styles.activityText}>{viewCount}</Text>
            </View>
            {likeCount > 0 ? (
              <View style={styles.stat}>
                <Ionicons name="heart" size={15} color="#FF3040" />
                <Text style={styles.activityText}>{likeCount}</Text>
              </View>
            ) : null}
          </View>
        ) : <Text style={styles.noViews}>No views yet</Text>}
        <View style={styles.activityDivider} />
        <Text style={styles.activityLabel}>Activity</Text>
        <Ionicons name="chevron-up" size={16} color="rgba(255,255,255,0.85)" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingTop: 10 },
  input: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    paddingHorizontal: 18,
    color: '#fff',
    fontSize: 15,
  },
  iconButton: { minWidth: 36, height: 46, alignItems: 'center', justifyContent: 'center' },
  noReply: { flex: 1, height: 46, justifyContent: 'center' },
  noReplyText: { color: 'rgba(255,255,255,0.8)', fontSize: 14 },
  send: { color: '#fff', fontSize: 16, fontWeight: '700' },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: 24, marginBottom: 18 },
  reaction: { width: '25%', alignItems: 'center', paddingVertical: 12 },
  reactionEmoji: { fontSize: 40 },
  ownRow: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingTop: 12 },
  activity: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 10, height: 44, paddingLeft: 8, paddingRight: 14,
    borderRadius: 22, backgroundColor: 'rgba(20,20,22,0.55)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)',
  },
  activityPressed: { backgroundColor: 'rgba(20,20,22,0.75)' },
  stats: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 4 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  activityText: { color: '#fff', fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  noViews: { color: 'rgba(255,255,255,0.85)', fontSize: 13, paddingLeft: 6 },
  activityDivider: { width: StyleSheet.hairlineWidth, height: 18, backgroundColor: 'rgba(255,255,255,0.3)' },
  activityLabel: { color: '#fff', fontSize: 14, fontWeight: '600', marginRight: -4 },
  avatars: { height: 26 },
  viewerAvatar: { position: 'absolute', top: 0, width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: '#141416' },
});
