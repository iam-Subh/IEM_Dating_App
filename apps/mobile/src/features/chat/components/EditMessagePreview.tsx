import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../../core/theme/colors';

export function EditMessagePreview({ content, error, saving, onCancel }: {
  content: string; error: string | null; saving: boolean; onCancel: () => void;
}) {
  return <View>
    <View style={styles.row}>
      <View style={styles.line} pointerEvents="none" />
      <View style={styles.quote}>
        <Text style={styles.title} numberOfLines={1}>Edit message</Text>
        <Text style={styles.preview} numberOfLines={1}>{content}</Text>
      </View>
      <Pressable onPress={onCancel} disabled={saving} accessibilityRole="button"
        accessibilityLabel="Cancel message edit" accessibilityState={{ disabled: saving }}
        style={({ pressed }) => [styles.close, pressed && styles.pressed, saving && styles.disabled]}>
        <Ionicons name="close" size={21} color="#A7A6AD" />
      </Pressable>
    </View>
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'stretch', backgroundColor: 'rgba(83,105,118,0.18)', borderRadius: 13, marginTop: 4, marginHorizontal: 4, paddingRight: 4, overflow: 'hidden' },
  line: { width: 4, backgroundColor: colors.primary, marginRight: 9, borderTopLeftRadius: 13, borderBottomLeftRadius: 13 },
  quote: { flex: 1, minWidth: 0, justifyContent: 'center', paddingVertical: 7 },
  title: { color: colors.primary, fontSize: 14, lineHeight: 18, fontWeight: '600', includeFontPadding: false },
  preview: { color: '#D0CFD5', fontSize: 14, lineHeight: 18, includeFontPadding: false },
  close: { width: 40, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: '#343032' },
  disabled: { opacity: 0.4 },
  error: { color: '#F5A5A6', fontSize: 12, lineHeight: 17, paddingHorizontal: 16, paddingBottom: 6 },
});
