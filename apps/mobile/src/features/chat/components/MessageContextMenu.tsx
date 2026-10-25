import React, { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet, useWindowDimensions, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../../../core/theme/colors';
import { CHAT_COMPOSER_MIN_HEIGHT, CHAT_HEADER_HEIGHT } from '../chatLayout';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';

/** Breathing room from the screen edges. */
const SCREEN_PADDING = 16;
/** Gap between the message and each of the two floating pieces. */
const GAP = 8;
/**
 * Fewest whole rows the menu will ever show. Shrinking to fit whatever space
 * happened to be beside the message made the menu a different height on every
 * message, which reads as instability rather than as adapting.
 */
const MIN_VISIBLE_ROWS = 5;
/** Must match styles.reactions.height. */
const REACTION_STRIP_HEIGHT = 54;
/** Wide enough for six quick reactions and the button that opens the full set. */
const REACTION_STRIP_WIDTH = 312;
/** Telegram's quick reactions. Anything else comes from the full picker. */
const QUICK_REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🔥'];
/**
 * The action list only has to fit an icon, a gap and a one-word label, so it is
 * narrower than the strip above it.
 */
const MENU_WIDTH = 150;
/** Must match styles.action.height. */
const ACTION_HEIGHT = 40;
/**
 * How much of the next row stays visible when the list is cut short. Enough of
 * the icon and label show through that it reads as "there is more below".
 */
const ACTION_PEEK = 24;

interface Props {
  /** The message the menu belongs to; it reads its own star and pin state. */
  matchId: string;
  messageId: string;
  currentUserId: string;
  isVisible: boolean;
  onClose: () => void;
  onDeleteForMe: () => void;
  onDeleteForEveryone: () => void;
  onCopy: () => void;
  onReport: () => void;
  onReaction: (emoji: string) => void;
  currentReaction?: string | null;
  reactionPending?: boolean;
  /** Opens the full emoji picker, for a reaction outside the quick six. */
  onOpenFullReactions: () => void;
  /** How many people have reacted; shows the "N reactions" row when non-zero. */
  reactionCount?: number;
  onShowReactions?: () => void;
  onEdit: () => void;
  canEdit?: boolean;
  onReply: () => void;
  onStar: () => void;
  onPin: () => void;
  onSelect: () => void;
  onOpenFile?: () => void;
  onSaveFile?: () => void;
  onShareFile?: () => void;
  isDocument?: boolean;
  isVoice?: boolean;
  hasText?: boolean;
  canDeleteEveryone: boolean;
  isMe: boolean;
  anchor: { x: number; y: number; width: number; height: number } | null;
}

export function MessageContextMenu(props: Props) {
  // Asked once, by the menu that shows the answer, while it is open.
  const { data: marks } = useQuery({
    queryKey: ['message-marks', props.currentUserId, props.matchId, props.messageId],
    queryFn: async () => (await api.get(`/chat/${props.matchId}/messages/${props.messageId}/marks`)).data.data as { starred: boolean; pinned: boolean },
    staleTime: 0,
  });
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [deleting, setDeleting] = useState(false);
  const [everyone, setEveryone] = useState(false);
  // Which ends of the action list currently have content hidden past them.
  const [hidden, setHidden] = useState({ above: false, below: true });
  useEffect(() => {
    if (props.isVisible) {
      setDeleting(false);
      setEveryone(false);
      // Reopening starts at the top again, so only the bottom is cut off.
      setHidden({ above: false, below: true });
    }
  }, [props.isVisible]);

  const handleMenuScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    const above = contentOffset.y > 1;
    const below = contentOffset.y + layoutMeasurement.height < contentSize.height - 1;
    // Only two booleans matter, so skip the render when neither flipped -
    // otherwise this runs on every scroll frame.
    setHidden(current => (current.above === above && current.below === below)
      ? current
      : { above, below });
  };
  if (!props.isVisible) return null;
  const current = props.currentReaction ?? null;
  // A reaction picked from the full set stays visible in the strip, as Telegram
  // keeps it, so taking it back is one tap instead of a trip through the picker.
  const quickReactions = current && !QUICK_REACTIONS.includes(current)
    ? [current, ...QUICK_REACTIONS.slice(0, 5)]
    : QUICK_REACTIONS;
  const commonActions: { label: string; icon: React.ComponentProps<typeof Ionicons>['name']; action: () => void; danger?: boolean }[] = [
    // Telegram lists who reacted from the message menu once anyone has.
    ...(props.reactionCount ? [{
      label: props.reactionCount === 1 ? '1 reaction' : `${props.reactionCount} reactions`,
      icon: 'heart-outline' as const,
      action: props.onShowReactions ?? props.onClose,
    }] : []),
    { label: 'Reply', icon: 'return-up-back-outline', action: props.onReply },
    ...(props.hasText ? [{ label: 'Copy', icon: 'copy-outline' as const, action: props.onCopy }] : []),
    { label: marks?.starred ? 'Unstar' : 'Star', icon: 'star-outline', action: props.onStar },
    { label: marks?.pinned ? 'Unpin' : 'Pin', icon: 'pin-outline', action: props.onPin },
    ...(props.isMe && props.hasText && props.canEdit !== false ? [{ label: 'Edit', icon: 'create-outline' as const, action: props.onEdit }] : !props.isMe ? [{ label: 'Report', icon: 'flag-outline' as const, action: props.onReport }] : []),
    { label: 'Select', icon: 'checkmark-circle-outline', action: props.onSelect },
    { label: 'Delete', icon: 'trash-outline', action: () => setDeleting(true), danger: true },
  ];
  const actions = props.isDocument ? [
    { label: 'Open', icon: 'open-outline' as const, action: props.onOpenFile ?? props.onClose },
    { label: 'Save', icon: 'download-outline' as const, action: props.onSaveFile ?? props.onClose },
    { label: 'Share', icon: 'share-outline' as const, action: props.onShareFile ?? props.onClose },
    ...commonActions,
  ] : props.isVoice ? [
    { label: 'Save', icon: 'download-outline' as const, action: props.onSaveFile ?? props.onClose },
    { label: 'Share', icon: 'share-outline' as const, action: props.onShareFile ?? props.onClose },
    ...commonActions,
  ] : commonActions;
  // The conversation header is drawn over the message list, so the popup has to
  // stay below the header rather than below the status bar. Clamping to
  // insets.top let it cover the header for messages near the top of the list.
  const ceiling = insets.top + CHAT_HEADER_HEIGHT + 8;
  // The composer is an absolute overlay. Reserve its visible height here so a
  // clipped action row remains above the composer instead of disappearing
  // behind it.
  const floor = height - insets.bottom - CHAT_COMPOSER_MIN_HEIGHT - 8;
  const anchor = props.anchor;

  // Sized independently: the menu only has to fit a short label, while the strip
  // has six emoji to space out. One shared width made the menu wider than it
  // needed to be.
  const menuWidth = Math.min(MENU_WIDTH, width - SCREEN_PADDING * 2);
  const stripWidth = Math.min(REACTION_STRIP_WIDTH, width - SCREEN_PADDING * 2);
  // Aligned to the same edge of the bubble as each other, then kept on screen.
  const edgeFor = (boxWidth: number) => Math.max(
    SCREEN_PADDING,
    Math.min(
      width - boxWidth - SCREEN_PADDING,
      anchor ? (props.isMe ? anchor.x + anchor.width - boxWidth : anchor.x) : SCREEN_PADDING,
    ),
  );
  const menuLeft = edgeFor(menuWidth);
  const stripLeft = edgeFor(stripWidth);

  // The strip and the menu sit together on one side of the message, the way
  // Telegram stacks them when a message is near the top of the screen.
  //
  // They used to straddle the bubble - strip above, menu below - which meant the
  // distance between them *was* the message height, so a long message pushed
  // them to opposite ends of the screen. Clamping how much they bracketed only
  // traded that gap for the strip covering the bubble. Stacked, they are always
  // GAP apart whatever the message length, and the message is never covered.
  const anchorTop = anchor ? anchor.y : height / 2;
  const anchorBottom = anchor ? anchor.y + anchor.height : height / 2;
  const roomAbove = Math.max(0, anchorTop - GAP - ceiling);
  const roomBelow = Math.max(0, floor - anchorBottom - GAP);

  // The strip is the fixed part of the group, so the menu gets what is left on
  // whichever side the group lands.
  const menuRoomAbove = Math.max(0, roomAbove - REACTION_STRIP_HEIGHT - GAP);
  const menuRoomBelow = Math.max(0, roomBelow - REACTION_STRIP_HEIGHT - GAP);
  const naturalMenuHeight = actions.length * ACTION_HEIGHT;
  // The height the menu is never allowed to drop below: five whole rows plus the
  // peek that shows the list continues.
  const minMenuHeight = MIN_VISIBLE_ROWS * ACTION_HEIGHT + ACTION_PEEK;

  // Pick the side on whether it can seat the minimum, not just on which has more
  // room. Below is preferred when both work - choosing purely by size threw the
  // group to the top of the screen whenever the space below fell a few points
  // short, which reads as a bug. But preferring below *before* checking the
  // minimum sent it to the overlap path while the other side still had room for
  // a full menu.
  const belowSeatsMinimum = menuRoomBelow >= minMenuHeight;
  const aboveSeatsMinimum = menuRoomAbove >= minMenuHeight;
  const groupBelow = belowSeatsMinimum && aboveSeatsMinimum
    ? (menuRoomBelow >= naturalMenuHeight * 0.75 || menuRoomBelow >= menuRoomAbove)
    : belowSeatsMinimum || (!aboveSeatsMinimum && menuRoomBelow >= menuRoomAbove);
  const menuRoom = groupBelow ? menuRoomBelow : menuRoomAbove;

  // A bubble tall enough to fill the screen leaves no usable room on either
  // side. There, stop trying to clear the message: pin the group inside the
  // viewport and let it overlap. Covering part of a very long message beats a
  // menu too short to use.
  const cramped = menuRoom < minMenuHeight;
  const availableRoom = cramped
    ? Math.max(0, floor - ceiling - REACTION_STRIP_HEIGHT - GAP)
    : menuRoom;

  const menuScrolls = availableRoom < naturalMenuHeight;
  // When the list has to scroll, stop on a part row rather than on an item
  // boundary. A clean edge looks like the end of the list; a sliced row is what
  // tells you to keep scrolling. The list has no padding, so the visible height
  // is exactly what the rows get: whole rows plus the peek.
  const wholeRows = Math.max(1, Math.floor((availableRoom - ACTION_PEEK) / ACTION_HEIGHT));
  const menuHeight = menuScrolls
    ? Math.min(availableRoom, wholeRows * ACTION_HEIGHT + ACTION_PEEK)
    : naturalMenuHeight;

  // The strip takes the edge nearest the bubble so the reactions stay
  // associated with the message, and the menu sits beyond it as the outer
  // layer. Above the bubble that means the menu is above the strip, not below
  // it - putting it below would drop it straight back onto the message.
  const reactionTop = cramped
    ? floor - menuHeight - GAP - REACTION_STRIP_HEIGHT
    : groupBelow
      ? anchorBottom + GAP
      : anchorTop - GAP - REACTION_STRIP_HEIGHT;
  const menuTop = (cramped || groupBelow)
    ? reactionTop + REACTION_STRIP_HEIGHT + GAP
    : reactionTop - GAP - menuHeight;
  return <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={props.onClose}>
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={props.onClose} accessibilityLabel="Close message menu" />
      {deleting ? <View style={styles.dialog} accessibilityViewIsModal>
        <Text style={styles.title}>Delete message?</Text>
        <Text style={styles.description}>This message will be removed from your chat.</Text>
        {props.canDeleteEveryone && <Pressable style={styles.checkboxRow} accessibilityRole="checkbox" accessibilityState={{ checked: everyone }} onPress={() => setEveryone(value => !value)}>
          <Ionicons name={everyone ? 'checkbox' : 'square-outline'} size={24} color={colors.primary} />
          <Text style={styles.checkboxLabel}>Also delete for the other participant</Text>
        </Pressable>}
        <View style={styles.dialogButtons}>
          <Pressable style={styles.dialogButton} onPress={props.onClose}><Text style={styles.text}>Cancel</Text></Pressable>
          <Pressable style={styles.dialogButton} onPress={everyone && props.canDeleteEveryone ? props.onDeleteForEveryone : props.onDeleteForMe}><Text style={styles.danger}>Delete</Text></Pressable>
        </View>
      </View> : <>
        <View style={[styles.reactions, { position: 'absolute', top: reactionTop, left: stripLeft, width: stripWidth }]} accessibilityViewIsModal>
          {quickReactions.map(emoji => {
            const selected = props.currentReaction === emoji;
            return (
              <Pressable
                key={emoji}
                accessibilityRole="button"
                accessibilityLabel={selected ? `Remove ${emoji} reaction` : `React ${emoji}`}
                accessibilityState={{ selected, disabled: props.reactionPending }}
                disabled={props.reactionPending}
                style={({ pressed }) => [
                  styles.reaction,
                  selected && styles.reactionSelected,
                  pressed && styles.reactionPressed,
                ]}
                onPress={() => props.onReaction(emoji)}
              >
                <Text style={styles.reactionEmoji}>{emoji}</Text>
                {selected ? <View style={styles.reactionSelectedDot} /> : null}
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose any reaction"
            accessibilityState={{ disabled: props.reactionPending }}
            disabled={props.reactionPending}
            style={({ pressed }) => [styles.reactionMore, pressed && styles.reactionPressed]}
            onPress={props.onOpenFullReactions}
          >
            <Ionicons name="chevron-down" size={20} color="#fff" />
          </Pressable>
        </View>
        <View style={[styles.menu, { position: 'absolute', top: menuTop, left: menuLeft, width: menuWidth, height: menuHeight }]} accessibilityViewIsModal>
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            scrollEnabled={menuScrolls}
            scrollEventThrottle={16}
            onScroll={handleMenuScroll}
          >
            {actions.map(action => <Pressable key={action.label} style={styles.action} onPress={action.action} accessibilityRole="button">
              <Ionicons name={action.icon} size={21} color={action.danger ? '#FF666C' : '#fff'} />
              <Text style={action.danger ? styles.danger : styles.text}>{action.label}</Text>
            </Pressable>)}
          </ScrollView>
          {/* The shadow marks the edge content is hidden behind, so it follows
              the scroll position. Pinning it to the bottom left Delete sitting
              under a permanent shadow once it had been scrolled into view. */}
          {menuScrolls && hidden.above && (
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(20,20,20,0.98)', 'rgba(36,36,36,0.85)', 'rgba(36,36,36,0)']}
              style={styles.menuFadeTop}
            />
          )}
          {menuScrolls && hidden.below && (
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(36,36,36,0)', 'rgba(36,36,36,0.85)', 'rgba(20,20,20,0.98)']}
              style={styles.menuFadeBottom}
            />
          )}
        </View>
      </>}
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.38)', justifyContent: 'center', padding: 24 },
  reactions: {
    flexDirection: 'row',
    height: REACTION_STRIP_HEIGHT,
    borderRadius: 27,
    backgroundColor: '#292929',
    paddingHorizontal: 4,
  },
  reaction: {
    flex: 1,
    height: 46,
    marginVertical: 4,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A full circular fill made the selected item look like another floating
  // button inside the strip. Keep the item flat and use the marker below it.
  reactionSelected: { backgroundColor: 'transparent' },
  reactionPressed: { transform: [{ scale: 0.9 }] },
  reactionMore: {
    width: 36,
    height: 36,
    marginVertical: 9,
    marginHorizontal: 4,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.09)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionEmoji: { fontSize: 25 },
  reactionSelectedDot: {
    position: 'absolute',
    bottom: 2,
    width: 14,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.primary,
  },
  // Fixed height comes from the caller, so the card never stretches to fill the
  // space it was offered. overflow clips the half row at the bottom edge.
  menu: {
    backgroundColor: '#242424',
    borderRadius: 14,
    overflow: 'hidden',
  },
  // The row still spans the full card width, so the tap target is unchanged -
  // only the inset before the icon shrinks.
  action: { height: ACTION_HEIGHT, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 14 },
  // Taller than the peek so the fade starts on the last whole row and is
  // already dark by the time it reaches the sliced one.
  menuFadeTop: { position: 'absolute', left: 0, right: 0, top: 0, height: ACTION_PEEK + 18 },
  menuFadeBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, height: ACTION_PEEK, opacity: 0.48 },
  text: { color: '#fff', fontSize: 15 },
  danger: { color: '#FF666C', fontSize: 15 },
  dialog: { backgroundColor: '#242424', borderRadius: 20, padding: 22, width: '100%', maxWidth: 380, alignSelf: 'center' },
  title: { color: '#fff', fontSize: 20, fontWeight: '600' },
  description: { color: '#ccc', fontSize: 15, marginTop: 12, lineHeight: 21 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20 },
  checkboxLabel: { color: '#fff', fontSize: 14, flex: 1 },
  dialogButtons: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 20, gap: 8 },
  dialogButton: { padding: 12 },
});
