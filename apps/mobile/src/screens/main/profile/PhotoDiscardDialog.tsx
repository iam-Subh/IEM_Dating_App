import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { settingsPalette as palette } from '../../../core/settings/SettingsLayout';

export function PhotoDiscardDialog({ visible, crop = false, embedded = false, light = false, onKeepEditing, onDiscard }: {
  visible: boolean;
  crop?: boolean;
  embedded?: boolean;
  light?: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
}) {
  if (!visible) return null;
  const content = <View style={[styles.overlay, embedded && styles.embedded]}>
    <Pressable style={StyleSheet.absoluteFill} onPress={onKeepEditing} accessibilityLabel="Keep editing" />
    <View style={[styles.card, light && {backgroundColor: '#F2F3EE'}]} accessibilityViewIsModal>
      <Text style={[styles.title, light && {color: '#352335'}]} accessibilityRole="header">{crop ? 'Discard crop changes?' : 'Discard photo changes?'}</Text>
      <Text style={[styles.message, light && {color: '#715365'}]}>{crop ? 'Your crop changes are not saved.' : 'Your added, removed or reordered photos are not saved.'}</Text>
      <Pressable onPress={onKeepEditing} accessibilityRole="button"
        style={({ pressed }) => [styles.button, styles.keep, light && {backgroundColor: '#712C48'}, pressed && styles.pressed]}>
        <Text style={[styles.keepText, light && {color: '#FFF'}]}>Keep editing</Text>
      </Pressable>
      <Pressable onPress={onDiscard} accessibilityRole="button"
        style={({ pressed }) => [styles.button, styles.discard, light && {backgroundColor: '#F5E1E3'}, pressed && styles.pressed]}>
        <Text style={[styles.discardText, light && {color: '#AE2646'}]}>Discard and exit</Text>
      </Pressable>
    </View>
  </View>;
  return embedded ? content : <Modal visible transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onKeepEditing}>
    {content}
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.6)' },
  embedded: { ...StyleSheet.absoluteFill, zIndex: 100 },
  card: { width: '100%', maxWidth: 360, alignSelf: 'center', padding: 20, borderRadius: 22, backgroundColor: palette.card },
  title: { color: palette.text, fontFamily: 'DMSans_700Bold', fontSize: 20 },
  message: { color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 20 },
  button: { minHeight: 46, borderRadius: 23, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 },
  keep: { backgroundColor: palette.accent },
  keepText: { color: palette.accentText, fontFamily: 'DMSans_700Bold', fontSize: 14 },
  discard: { marginTop: 8, backgroundColor: palette.dangerSurface },
  discardText: { color: palette.danger, fontFamily: 'DMSans_700Bold', fontSize: 14 },
  pressed: { opacity: 0.7 },
});
