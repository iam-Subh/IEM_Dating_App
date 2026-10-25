import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * A centred notice in the conversation, such as an auto-delete change.
 *
 * Styled like the date separators rather than a bubble: nobody wrote it, so it
 * belongs to neither side of the chat and offers no replies or reactions.
 */
export function ServiceMessage({ text }: { text: string }) {
  return (
    <View style={styles.row} accessibilityRole="text">
      <View style={styles.pill}>
        <Ionicons name="timer-outline" size={13} color="rgba(255,255,255,0.85)" />
        <Text style={styles.text}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 24 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '92%',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  text: { color: 'rgba(255,255,255,0.85)', fontSize: 13, lineHeight: 17, textAlign: 'center', flexShrink: 1 },
});
