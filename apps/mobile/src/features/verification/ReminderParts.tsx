import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { dismissNudge, isNudgeDismissed } from './nudges';
import { useVerificationPreview } from './VerificationPreviewContext';
import { ReminderArt, type ReminderArtName } from './ReminderArt';

/**
 * The building blocks of every verify reminder, quietest first
 * (REMINDER_DESIGN.md):
 *
 * - `ReminderRow` - a settings-style row for the always-there spots
 *   (Profile, Edit college).
 * - `ReminderBanner` - one slim line at the top of a list or the deck,
 *   with a text button and, for nudges, a close.
 *
 * Pink is for the action only; amber marks a deadline, red a problem.
 */
export const reminderColors = {
  surface: '#1D1B1E',
  surfacePressed: '#262327',
  line: 'rgba(255,255,255,0.07)',
  text: '#F6F4F6',
  secondary: '#BDB7C0',
  muted: '#8E8A90',
  accent: '#F3C1CA',
  accentText: '#331C23',
  amber: '#F0C17A',
  amberSurface: '#2A231A',
  danger: '#FF9AA2',
  dangerSurface: '#2E1F22',
  success: '#9BD8B4',
};

export type ReminderTone = 'neutral' | 'warn' | 'danger';
type IconName = React.ComponentProps<typeof Ionicons>['name'];

const toneColor = (tone: ReminderTone) => (tone === 'warn' ? reminderColors.amber : tone === 'danger' ? reminderColors.danger : reminderColors.secondary);
const toneSurface = (tone: ReminderTone) => (tone === 'warn' ? reminderColors.amberSurface : tone === 'danger' ? reminderColors.dangerSurface : reminderColors.surface);

/** Hides a closable reminder for `days` after its close is tapped (never in a preview). */
export function useDismissible(key?: string, days = 7) {
  const preview = useVerificationPreview();
  const [hidden, setHidden] = useState(!!key && !preview);
  useEffect(() => {
    if (!key || preview) { setHidden(false); return; }
    let live = true;
    void isNudgeDismissed(key).then((dismissed) => { if (live) setHidden(dismissed); });
    return () => { live = false; };
  }, [key, preview]);
  const dismiss = () => {
    setHidden(true);
    if (key && !preview) void dismissNudge(key, days);
  };
  return { hidden, dismiss };
}

/**
 * One slim line: an icon, what it is, a text button. Closable when it has a
 * `dismissKey`; a deadline or a lock has none.
 */
export function ReminderBanner({ icon = 'school-outline', art, title, text, action = 'Verify', onPress, tone = 'neutral', dismissKey, dismissDays = 7, flush = false, style }: {
  icon?: IconName;
  /** A small 3D thumbnail in place of the icon. */
  art?: ReminderArtName;
  title?: string;
  text: string;
  /** Empty: a line to read, with nothing to tap. */
  action?: string;
  onPress?: () => void;
  tone?: ReminderTone;
  dismissKey?: string;
  dismissDays?: number;
  /** Inside a screen that already has side padding. */
  flush?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { hidden, dismiss } = useDismissible(dismissKey, dismissDays);
  if (hidden) return null;
  return <View style={[styles.banner, { backgroundColor: toneSurface(tone) }, flush && styles.flush, style]}>
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : 'text'} accessibilityLabel={`${title ? `${title}. ` : ''}${text} ${action}`}
      style={({ pressed }) => [styles.bannerMain, pressed && styles.pressed]}>
      {art ? <ReminderArt name={art} size={36} /> : <Ionicons name={icon} size={18} color={toneColor(tone)} style={styles.bannerIcon} />}
      <Text style={styles.bannerText} numberOfLines={title ? 3 : 2}>
        {title ? <Text style={styles.bannerTitle}>{title}{'\n'}</Text> : null}{text}
      </Text>
      {action && onPress ? <Text style={[styles.bannerAction, tone === 'warn' && { color: reminderColors.amber }]}>{action}</Text> : null}
    </Pressable>
    {dismissKey ? <Pressable onPress={dismiss} accessibilityRole="button" accessibilityLabel="Close reminder" hitSlop={6}
      style={({ pressed }) => [styles.bannerClose, pressed && styles.pressed]}>
      <Ionicons name="close" size={16} color={reminderColors.muted} />
    </Pressable> : null}
  </View>;
}

/** A settings-style row: a leading mark, a title and a line under it, a value and a chevron. */
export function ReminderRow({ leading, title, subtitle, value, onPress, tone = 'neutral', flush = false }: {
  leading: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
  value?: string;
  onPress: () => void;
  tone?: ReminderTone;
  flush?: boolean;
}) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={[title, typeof subtitle === 'string' ? subtitle : '', value].filter(Boolean).join('. ')}
    style={({ pressed }) => [styles.row, flush && styles.flush, pressed && { backgroundColor: reminderColors.surfacePressed }]}>
    <View style={styles.rowLeading}>{leading}</View>
    <View style={styles.rowCopy}>
      <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
      {subtitle ? (typeof subtitle === 'string'
        ? <Text style={[styles.rowSubtitle, tone !== 'neutral' && { color: toneColor(tone) }]} numberOfLines={2}>{subtitle}</Text>
        : subtitle) : null}
    </View>
    {value ? <Text style={[styles.rowValue, tone !== 'neutral' && { color: toneColor(tone) }]}>{value}</Text> : null}
    <Ionicons name="chevron-forward" size={18} color={reminderColors.muted} />
  </Pressable>;
}

/** The two steps of the blue badge as one line: "✓ College email · ○ Selfie check". */
export function BadgeSteps({ steps }: { steps: { label: string; done: boolean; note?: string; tone?: ReminderTone }[] }) {
  return <View style={styles.steps}>
    {steps.map((step, index) => <React.Fragment key={step.label}>
      {index > 0 ? <Text style={styles.stepDot}>·</Text> : null}
      <View style={styles.step}>
        <Ionicons name={step.done ? 'checkmark-circle' : step.tone && step.tone !== 'neutral' ? 'time-outline' : 'ellipse-outline'} size={14}
          color={step.done ? reminderColors.success : step.tone ? toneColor(step.tone) : reminderColors.muted} />
        <Text style={[styles.stepText, step.done && { color: reminderColors.secondary }, !step.done && step.tone && step.tone !== 'neutral' && { color: toneColor(step.tone) }]}>
          {step.note ?? step.label}
        </Text>
      </View>
    </React.Fragment>)}
  </View>;
}

// --- Daily limits ------------------------------------------------------------

const IST_OFFSET_MS = 5.5 * 60 * 60_000;

/** Milliseconds until the next midnight in India, when daily limits reset. */
export function msUntilReset(now = Date.now()) {
  const ist = now + IST_OFFSET_MS;
  const next = Math.floor(ist / 86_400_000 + 1) * 86_400_000;
  return next - ist;
}

/** "08:42:10" */
export function formatCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(Math.floor(total / 3600))}:${two(Math.floor(total / 60) % 60)}:${two(total % 60)}`;
}

/** Ticks once a second while shown. */
export function useResetCountdown(active = true) {
  const [left, setLeft] = useState(() => msUntilReset());
  useEffect(() => {
    if (!active) return;
    setLeft(msUntilReset());
    const timer = setInterval(() => setLeft(msUntilReset()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return formatCountdown(left);
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginVertical: 6, borderRadius: 14, minHeight: 48, overflow: 'hidden' },
  flush: { marginHorizontal: 0 },
  bannerMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 12, paddingRight: 12, paddingVertical: 8, minHeight: 52 },
  bannerIcon: { flexShrink: 0 },
  bannerText: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 18, color: reminderColors.secondary },
  bannerTitle: { fontFamily: 'DMSans_700Bold', color: reminderColors.text },
  bannerAction: { fontFamily: 'DMSans_700Bold', fontSize: 13, color: reminderColors.accent, flexShrink: 0 },
  bannerClose: { width: 36, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: reminderColors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 62, paddingHorizontal: 14, paddingVertical: 11, marginHorizontal: 16, marginVertical: 6, borderRadius: 16, backgroundColor: reminderColors.surface },
  rowLeading: { minWidth: 28, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { fontFamily: 'DMSans_700Bold', fontSize: 15, lineHeight: 20, color: reminderColors.text },
  rowSubtitle: { fontFamily: 'DMSans_400Regular', fontSize: 12.5, lineHeight: 17, color: reminderColors.secondary },
  rowValue: { fontFamily: 'DMSans_500Medium', fontSize: 12.5, color: reminderColors.muted },
  steps: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 2 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepDot: { color: reminderColors.muted, fontSize: 12 },
  stepText: { fontFamily: 'DMSans_500Medium', fontSize: 12.5, lineHeight: 17, color: reminderColors.text },
  pressed: { opacity: 0.7 },
});
