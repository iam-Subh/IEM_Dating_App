import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { reminderColors } from './ReminderParts';
import { ReminderArt } from './ReminderArt';

/**
 * The chat's message allowance (REMINDER_DESIGN.md, pattern C): a small chip
 * over the composer while a few are left, then - like WhatsApp's "You can't
 * send messages" - a bar in the composer's place.
 */
export function ChatVerificationReminder({ remaining, limit = 30, onVerify }: { remaining: number; limit?: number; onVerify: () => void }) {
  if (remaining <= 0) {
    return <View style={styles.lockedWrap}>
      <View style={styles.locked}>
        <ReminderArt name="lock" size={34} />
        <Text style={styles.lockedText} numberOfLines={2}>You’ve used your {limit} messages. Verify your college to keep chatting.</Text>
        <Pressable onPress={onVerify} accessibilityRole="button" accessibilityLabel="Verify your college to keep chatting"
          style={({ pressed }) => [styles.lockedButton, pressed && styles.pressed]}>
          <Text style={styles.lockedButtonText}>Verify</Text>
        </Pressable>
      </View>
    </View>;
  }
  return <Pressable onPress={onVerify} accessibilityRole="button" accessibilityLabel={`${remaining} ${remaining === 1 ? 'message' : 'messages'} left. Verify for unlimited chat.`}
    style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
    <Text style={styles.chipText}><Text style={styles.chipCount}>{remaining}</Text> {remaining === 1 ? 'message' : 'messages'} left</Text>
    <Text style={styles.chipDot}>·</Text>
    <Text style={styles.chipLink}>Verify</Text>
  </Pressable>;
}

/** A WhatsApp-style centred note: the other person has used theirs. */
export function ChatVerificationWaiting({ name }: { name: string }) {
  return <View style={styles.pill}>
    <Ionicons name="time-outline" size={13} color={reminderColors.secondary} />
    <Text accessibilityLiveRegion="polite" style={styles.pillText}>{name} can reply after verifying their college</Text>
  </View>;
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 6, minHeight: 32, marginBottom: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: 'rgba(29,27,30,0.94)', borderWidth: StyleSheet.hairlineWidth, borderColor: reminderColors.line },
  chipText: { fontFamily: 'DMSans_400Regular', fontSize: 12.5, color: reminderColors.secondary },
  chipCount: { fontFamily: 'DMSans_700Bold', color: reminderColors.amber },
  chipDot: { color: reminderColors.muted, fontSize: 12 },
  chipLink: { fontFamily: 'DMSans_700Bold', fontSize: 12.5, color: reminderColors.accent },
  lockedWrap: { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 8 },
  locked: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingLeft: 10, paddingRight: 6, paddingVertical: 6, borderRadius: 26, backgroundColor: reminderColors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: reminderColors.line },
  lockedText: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 18, color: reminderColors.secondary },
  lockedButton: { minHeight: 40, paddingHorizontal: 18, borderRadius: 20, backgroundColor: reminderColors.accent, alignItems: 'center', justifyContent: 'center' },
  lockedButtonText: { fontFamily: 'DMSans_700Bold', fontSize: 14, color: reminderColors.accentText },
  pill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 6, maxWidth: '86%', marginBottom: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: 'rgba(29,27,30,0.94)' },
  pillText: { flexShrink: 1, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 16, color: reminderColors.secondary, textAlign: 'center' },
  pressed: { opacity: 0.75 },
});
