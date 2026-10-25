import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

/** An embedded dialog also works inside the demo creator's native modal. */
export function StoryDiscardDialog({ visible, count, canSave, saving, error, onKeepEditing, onSave, onDiscard, onExited }: {
  visible: boolean; count: number; canSave: boolean; saving: boolean; error: string | null;
  onKeepEditing: () => void; onSave: () => void; onDiscard: () => void; onExited: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const shown = useRef(visible);
  const exited = useRef(onExited);
  exited.current = onExited;
  const progress = useSharedValue(0);
  const finishClosing = useCallback(() => {
    shown.current = false;
    setMounted(false);
    exited.current();
  }, []);
  useEffect(() => {
    if (visible) {
      shown.current = true;
      setMounted(true);
      progress.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic) });
    } else if (shown.current) {
      progress.value = withTiming(0, { duration: 150, easing: Easing.in(Easing.cubic) }, finished => {
        if (finished) runOnJS(finishClosing)();
      });
    }
  }, [finishClosing, progress, visible]);
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.96 + 0.04 * progress.value }, { translateY: 12 * (1 - progress.value) }],
  }));
  if (!mounted) return null;
  const disabled = saving || !visible;
  const plural = count > 1;

  return <View style={[s.overlay, { paddingTop: Math.max(insets.top, 20), paddingBottom: Math.max(insets.bottom, 20) }]}>
    <Animated.View style={[StyleSheet.absoluteFill, s.backdrop, backdropStyle]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Keep editing" disabled={disabled}
        onPress={onKeepEditing} style={StyleSheet.absoluteFill} />
    </Animated.View>
    <Animated.View style={[s.card, cardStyle]} accessibilityViewIsModal onAccessibilityEscape={onKeepEditing}>
      <ScrollView bounces={false} showsVerticalScrollIndicator={false} style={s.scroll} contentContainerStyle={s.content}>
        <View style={s.heading}>
          <View style={s.icon}><Ionicons name="create-outline" size={20} color="#F3C1CA" /></View>
          <Text accessibilityRole="header" style={s.title}>{plural ? 'Discard stories?' : 'Discard story?'}</Text>
        </View>
        <Text style={s.message}>{canSave ? 'Save your edits as a draft, or discard them.' : 'Discarding will remove your edits.'}</Text>
        {error && <Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
        <View style={s.actions}>
          <Pressable accessibilityRole="button" disabled={disabled} onPress={onKeepEditing}
            style={({ pressed }) => [s.button, s.keep, disabled && s.disabled, pressed && s.pressed]}>
            <Text style={s.keepText}>Keep editing</Text>
          </Pressable>
          <View style={s.secondaryActions}>
            {canSave && <Pressable accessibilityRole="button" accessibilityLabel={saving ? 'Saving draft' : 'Save draft'}
              accessibilityState={{ busy: saving, disabled }} disabled={disabled} onPress={onSave}
              style={({ pressed }) => [s.button, s.secondaryButton, s.save, pressed && s.pressed]}>
              {saving ? <ActivityIndicator size="small" color="#F3C1CA" /> : <Ionicons name="bookmark-outline" size={16} color="#F3C1CA" />}
              <Text style={s.saveText}>{saving ? 'Saving…' : 'Save draft'}</Text>
            </Pressable>}
            <Pressable accessibilityRole="button" accessibilityLabel={plural ? 'Discard stories' : 'Discard story'} disabled={disabled} onPress={onDiscard}
              style={({ pressed }) => [s.button, s.secondaryButton, s.discard, disabled && s.disabled, pressed && s.pressed]}>
              <Ionicons name="trash-outline" size={16} color="#FF9FA5" />
              <Text style={s.discardText}>Discard</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </Animated.View>
  </View>;
}

const s = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 100, paddingHorizontal: 24, justifyContent: 'center', alignItems: 'center' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.6)' },
  card: { width: '100%', maxWidth: 360, maxHeight: '100%', backgroundColor: '#252325', borderRadius: 22, overflow: 'hidden' },
  scroll: { flexGrow: 0 },
  content: { padding: 18 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#393036', alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: '#FFF4F6', fontSize: 19, fontWeight: '700' },
  message: { color: '#D8CFD2', fontSize: 14, lineHeight: 20, marginTop: 10, marginBottom: 16 },
  error: { color: '#FF9FA5', fontSize: 13, lineHeight: 19, marginBottom: 16 },
  actions: { gap: 8 },
  secondaryActions: { flexDirection: 'row', gap: 8 },
  secondaryButton: { flex: 1, paddingHorizontal: 10 },
  button: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  keep: { backgroundColor: '#F3C1CA' },
  keepText: { color: '#332027', fontSize: 14, fontWeight: '700' },
  save: { backgroundColor: '#373236' },
  saveText: { flexShrink: 1, color: '#FFF4F6', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  discard: { backgroundColor: '#38272A' },
  discardText: { flexShrink: 1, color: '#FF9FA5', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
});
