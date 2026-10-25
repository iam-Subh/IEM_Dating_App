import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { colors } from '../../../core/theme/colors';

type Props = {
  message: string;
  /** Telegram gives destructive chat actions five seconds. */
  seconds?: number;
  bottom: number;
  onUndo: () => void;
  onTimeout: () => void;
};

/**
 * Telegram's undo bar: a countdown, what just happened, and UNDO.
 *
 * Give it a fresh `key` per action. The countdown belongs to one action; reusing
 * the same instance for the next would carry the old timer over.
 */
export function UndoSnackbar({ message, seconds = 5, bottom, onUndo, onTimeout }: Props) {
  const [remaining, setRemaining] = useState(seconds);
  const timeoutRef = useRef(onTimeout);
  timeoutRef.current = onTimeout;

  useEffect(() => {
    const startedAt = Date.now();
    // Measured against the start time rather than counted per tick, so a busy JS
    // thread delays the redraw but never stretches the five seconds.
    const tick = setInterval(() => {
      const left = seconds - Math.floor((Date.now() - startedAt) / 1000);
      if (left <= 0) {
        clearInterval(tick);
        timeoutRef.current();
      } else {
        setRemaining(left);
      }
    }, 200);
    return () => clearInterval(tick);
  }, [seconds]);

  return (
    <Animated.View entering={FadeInDown.duration(180)} exiting={FadeOutDown.duration(150)} style={[styles.bar, { bottom }]}>
      <View style={styles.countdown}>
        <Text style={styles.countdownText}>{remaining}</Text>
      </View>
      <Text style={styles.message} numberOfLines={1}>{message}</Text>
      <Pressable onPress={onUndo} hitSlop={12} accessibilityRole="button" accessibilityLabel="Undo">
        <Text style={styles.undo}>UNDO</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 12,
    right: 12,
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: '#2C2C2E',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 12,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  countdown: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  countdownText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  message: { flex: 1, color: '#FFFFFF', fontSize: 15 },
  undo: { color: colors.primary, fontSize: 14, fontWeight: '800', letterSpacing: 0.4 },
});
