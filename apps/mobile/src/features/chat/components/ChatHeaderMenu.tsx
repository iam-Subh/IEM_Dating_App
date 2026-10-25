import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../../core/theme/colors';
import { formatDuration } from '../conversationControls';

type Props = {
  muted: boolean;
  ttlSeconds: number | null;
  onMute: () => void;
  onUnmute: () => void;
  onAutoDelete: () => void;
  onMarked: (kind: 'pin' | 'star') => void;
  onClear: () => void;
  onDelete: () => void;
};

/**
 * Android shows a second modal badly while the first is still fading out: the
 * new one can lose window focus. The follow-up sheet or dialog waits this long.
 */
const MENU_DISMISS_MS = 220;

/** The chat header's overflow menu, with Telegram's chat-level actions. */
export function ChatHeaderMenu({ muted, ttlSeconds, onMute, onUnmute, onAutoDelete, onMarked, onClear, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();

  const run = (action: () => void) => {
    setOpen(false);
    setTimeout(action, MENU_DISMISS_MS);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Chat options"
        onPress={() => setOpen(true)}
        style={styles.trigger}
      >
        <Ionicons name="ellipsis-vertical" size={22} color="#FFFFFF" />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityLabel="Close chat options" />
        <View style={[styles.menu, { top: insets.top + 8 }]} accessibilityViewIsModal>
          <Row icon={muted ? 'notifications-outline' : 'notifications-off-outline'} label={muted ? 'Unmute' : 'Mute'} onPress={() => run(muted ? onUnmute : onMute)} />
          <Row icon="timer-outline" label="Auto-delete" detail={ttlSeconds ? formatDuration(ttlSeconds) : 'Off'} onPress={() => run(onAutoDelete)} />
          <Row icon="pin-outline" label="Pinned messages" onPress={() => run(() => onMarked('pin'))} />
          <Row icon="star-outline" label="Starred messages" onPress={() => run(() => onMarked('star'))} />
          <Row icon="brush-outline" label="Clear history" onPress={() => run(onClear)} />
          <Row icon="trash-outline" label="Delete chat" danger onPress={() => run(onDelete)} />
        </View>
      </Modal>
    </>
  );
}

function Row({ icon, label, detail, danger, onPress }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  detail?: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} accessibilityRole="button">
      <Ionicons name={icon} size={21} color={danger ? '#FF666C' : '#FFFFFF'} />
      <Text style={[styles.label, danger && styles.danger]} numberOfLines={1}>{label}</Text>
      {detail ? <Text style={styles.detail} numberOfLines={1}>{detail}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: { width: 40, height: 48, alignItems: 'center', justifyContent: 'center' },
  menu: {
    position: 'absolute',
    right: 10,
    minWidth: 220,
    backgroundColor: '#242424',
    borderRadius: 14,
    paddingVertical: 6,
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  row: { height: 46, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16 },
  rowPressed: { backgroundColor: 'rgba(255,255,255,0.06)' },
  label: { flex: 1, color: '#FFFFFF', fontSize: 15 },
  danger: { color: '#FF666C' },
  detail: { color: colors.text.secondary, fontSize: 13, marginLeft: 8 },
});
