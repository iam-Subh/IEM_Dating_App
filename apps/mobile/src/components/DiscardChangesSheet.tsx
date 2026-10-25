import React, { useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { settingsPalette as palette } from '../core/settings/SettingsLayout';
import { finishDiscardRequest } from './discardChangesRequests';

/** Content for the native form sheet. The platform owns drag and dismissal. */
export function DiscardChangesSheet() {
  const navigation = useNavigation();
  const route = useRoute();
  const { requestId } = route.params as { requestId: string };
  const insets = useSafeAreaInsets();
  const discard = useRef(false);
  const closing = useRef(false);
  const completionFrame = useRef<number | null>(null);

  useEffect(() => {
    if (completionFrame.current !== null) cancelAnimationFrame(completionFrame.current);
    const unsubscribe = navigation.addListener('transitionEnd' as any, (event: any) => {
      if (event.data.closing) finishDiscardRequest(requestId, discard.current);
    });
    return () => {
      unsubscribe();
      // Native drag dismissal can unmount the route before transitionEnd reaches JS.
      // Defer until navigation commits. Effect re-entry cancels Strict Mode's cleanup.
      completionFrame.current = requestAnimationFrame(() => finishDiscardRequest(requestId, discard.current));
    };
  }, [requestId, navigation]);

  const close = (confirmed: boolean) => {
    if (closing.current) return;
    closing.current = true;
    discard.current = confirmed;
    navigation.goBack();
  };

  return <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 12 }]}>
    {Platform.OS === 'android' && <View style={styles.handle} />}
    <Text style={styles.title} accessibilityRole="header">Discard changes?</Text>
    <Text style={styles.message}>Your changes are not saved.</Text>
    <Pressable onPress={() => close(false)} accessibilityRole="button"
      style={({ pressed }) => [styles.button, styles.keep, pressed && styles.pressed]}>
      <Text style={styles.keepText}>Keep editing</Text>
    </Pressable>
    <Pressable onPress={() => close(true)} accessibilityRole="button"
      style={({ pressed }) => [styles.button, styles.discard, pressed && styles.pressed]}>
      <Text style={styles.discardText}>Discard and exit</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: palette.card, paddingHorizontal: 20, paddingTop: 10 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#716A70', alignSelf: 'center', marginBottom: 14 },
  title: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 21, marginTop: 4 },
  message: { color: '#DDD0D5', fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 20, marginTop: 6, marginBottom: 20 },
  button: { minHeight: 46, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  keep: { backgroundColor: palette.accent },
  keepText: { color: palette.accentText, fontFamily: 'DMSans_700Bold', fontSize: 14 },
  discard: { backgroundColor: '#FFDAD8', marginTop: 8 },
  discardText: { color: '#C9272D', fontFamily: 'DMSans_700Bold', fontSize: 14 },
  pressed: { opacity: 0.75 },
});
