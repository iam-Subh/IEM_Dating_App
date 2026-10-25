import React, { useEffect, useState } from 'react';
import { Dimensions, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors } from '../../../core/theme/colors';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const DANGER = '#FF666C';

type Props = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
};

/**
 * A sheet that slides up over a dimmed backdrop, used by the chat's mute,
 * auto-delete and reactions panels.
 *
 * It stays mounted through its exit animation: unmounting the moment `visible`
 * turns false would cut the slide-down off mid-frame.
 */
export function BottomSheet({ visible, onClose, title, subtitle, children }: Props) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) });
    } else if (mounted) {
      progress.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
    // `mounted` only gates the exit; it must not re-trigger the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - progress.value) * SCREEN_HEIGHT * 0.6 }] }));

  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 4 }, sheetStyle]} accessibilityViewIsModal>
        <View style={styles.handle} />
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        {children}
      </Animated.View>
    </Modal>
  );
}

type RowProps = {
  label: string;
  onPress: () => void;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  detail?: string;
  danger?: boolean;
  checked?: boolean;
  disabled?: boolean;
};

export function SheetRow({ label, onPress, icon, detail, danger, checked, disabled }: RowProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: checked, disabled }}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed, disabled && styles.rowDisabled]}
    >
      {icon ? <Ionicons name={icon} size={22} color={danger ? DANGER : '#FFFFFF'} style={styles.rowIcon} /> : null}
      <Text style={[styles.rowLabel, danger && styles.rowDanger]} numberOfLines={1}>{label}</Text>
      {detail ? <Text style={styles.rowDetail} numberOfLines={1}>{detail}</Text> : null}
      {checked ? <Ionicons name="checkmark" size={22} color={colors.primary} style={styles.rowCheck} /> : null}
    </Pressable>
  );
}

type DurationProps = {
  days: number;
  hours: number;
  maxDays: number;
  onChange: (days: number, hours: number) => void;
};

/**
 * Days-and-hours steppers for "Mute for…" and a custom auto-delete time.
 *
 * Hours wrap into days rather than stopping at 23, so holding "+" on hours keeps
 * counting up the way a person expects instead of hitting an invisible wall.
 */
export function DurationPicker({ days, hours, maxDays, onChange }: DurationProps) {
  const set = (nextDays: number, nextHours: number) => {
    let d = nextDays;
    let h = nextHours;
    if (h > 23) { d += 1; h = 0; }
    if (h < 0) { if (d > 0) { d -= 1; h = 23; } else { h = 0; } }
    d = Math.max(0, Math.min(maxDays, d));
    if (d === maxDays) h = 0;
    onChange(d, h);
  };
  return (
    <View style={styles.duration}>
      <Stepper label={days === 1 ? 'day' : 'days'} value={days} onMinus={() => set(days - 1, hours)} onPlus={() => set(days + 1, hours)} />
      <Stepper label={hours === 1 ? 'hour' : 'hours'} value={hours} onMinus={() => set(days, hours - 1)} onPlus={() => set(days, hours + 1)} />
    </View>
  );
}

function Stepper({ label, value, onMinus, onPlus }: { label: string; value: number; onMinus: () => void; onPlus: () => void }) {
  return (
    <View style={styles.stepper}>
      <Pressable onPress={onMinus} style={styles.stepButton} accessibilityRole="button" accessibilityLabel={`Fewer ${label}`}>
        <Ionicons name="remove" size={22} color="#FFFFFF" />
      </Pressable>
      <View style={styles.stepValue}>
        <Text style={styles.stepNumber}>{value}</Text>
        <Text style={styles.stepLabel}>{label}</Text>
      </View>
      <Pressable onPress={onPlus} style={styles.stepButton} accessibilityRole="button" accessibilityLabel={`More ${label}`}>
        <Ionicons name="add" size={22} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

export function SheetActions({ onBack, onConfirm, confirmLabel, confirmDisabled }: { onBack: () => void; onConfirm: () => void; confirmLabel: string; confirmDisabled?: boolean }) {
  return (
    <View style={styles.actions}>
      <Pressable onPress={onBack} style={styles.secondaryButton} accessibilityRole="button">
        <Text style={styles.secondaryText}>Back</Text>
      </Pressable>
      <Pressable
        onPress={onConfirm}
        disabled={confirmDisabled}
        style={[styles.primaryButton, confirmDisabled && styles.rowDisabled]}
        accessibilityRole="button"
        accessibilityState={{ disabled: confirmDisabled }}
      >
        <Text style={styles.primaryText}>{confirmLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '85%',
    backgroundColor: '#1C1C1E',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
  },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)', marginBottom: 10 },
  title: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', paddingHorizontal: 22, marginBottom: 4 },
  subtitle: { color: colors.text.secondary, fontSize: 13.5, lineHeight: 19, paddingHorizontal: 22, marginBottom: 10 },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22 },
  rowPressed: { backgroundColor: 'rgba(255,255,255,0.06)' },
  rowDisabled: { opacity: 0.4 },
  rowIcon: { width: 34 },
  rowLabel: { flex: 1, color: '#FFFFFF', fontSize: 16 },
  rowDanger: { color: DANGER },
  rowDetail: { color: colors.text.secondary, fontSize: 14, marginLeft: 12 },
  rowCheck: { marginLeft: 12 },
  duration: { flexDirection: 'row', justifyContent: 'center', gap: 18, paddingVertical: 14 },
  stepper: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  stepButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  stepValue: { alignItems: 'center', minWidth: 52 },
  stepNumber: { color: '#FFFFFF', fontSize: 26, fontWeight: '700' },
  stepLabel: { color: colors.text.secondary, fontSize: 12 },
  actions: { flexDirection: 'row', gap: 12, paddingHorizontal: 22, paddingTop: 6 },
  secondaryButton: { flex: 1, height: 46, borderRadius: 23, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  primaryButton: { flex: 1, height: 46, borderRadius: 23, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
