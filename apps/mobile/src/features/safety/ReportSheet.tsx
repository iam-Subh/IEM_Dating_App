import React, { useContext, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, BackHandler, Easing, Linking, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { initialWindowMetrics, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { api } from '../../services/api';
import { navigationRef } from '../../navigation/navigationRef';
import { reminderColors as c } from '../verification/ReminderParts';
import { HELPLINES } from '../legal/LegalScreen';
import { REPORT_REASONS, type ReportReason } from './reportReasons';
import { recordSetback } from '../feedback/engagement';

/**
 * Reporting, the same everywhere (docs/SAFETY_AND_LEGAL.md 2.3): a bottom
 * sheet - the reason, then an optional detail and "Also block" (on), then a
 * thank-you; for an urgent reason, India's helplines too. The reported
 * person is never told who reported them.
 *
 * `openReport(target)` from any screen; `ReportHost` is mounted once at the
 * root (RootNavigator).
 */
export type ReportTarget = {
  userId: string;
  name: string;
  sourceType: 'profile' | 'message' | 'story' | 'rose';
  sourceId?: string;
  matchId?: string;
  /** Offer "Also block". Off where blocking isn't possible (they already blocked you). */
  canBlock?: boolean;
  /** Demo screens: instead of the API. */
  send?: (reason: string) => Promise<void> | void;
  block?: () => Promise<void> | void;
};
export type ReportResult = { sent: boolean; blocked: boolean };

let host: ((target: ReportTarget, done: (result: ReportResult) => void) => void) | null = null;
export function openReport(target: ReportTarget): Promise<ReportResult> {
  return new Promise((resolve) => {
    if (!host) { resolve({ sent: false, blocked: false }); return; }
    host(target, resolve);
  });
}

type Step = 'reason' | 'details' | 'done';

export function ReportHost() {
  // Mounted beside the screens, outside their safe-area provider: read the
  // insets without requiring one, falling back to the window's own.
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets ?? { top: 0, bottom: 0, left: 0, right: 0 };
  const [target, setTarget] = useState<ReportTarget | null>(null);
  const [step, setStep] = useState<Step>('reason');
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const result = useRef<ReportResult>({ sent: false, blocked: false });
  const resolver = useRef<(value: ReportResult) => void>(() => {});
  const shown = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    host = (next, done) => {
      resolver.current(result.current);
      resolver.current = done;
      result.current = { sent: false, blocked: false };
      setTarget(next); setStep('reason'); setReason(null); setDetail(null); setText('');
      setAlsoBlock(next.canBlock !== false); setError(''); setBusy(false);
      shown.setValue(0);
      Animated.timing(shown, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    };
    return () => { host = null; };
  }, [shown]);

  const close = () => {
    Animated.timing(shown, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
      setTarget(null);
      resolver.current(result.current);
      resolver.current = () => {};
    });
  };
  const back = () => {
    if (busy) return true;
    if (step === 'details') { setStep('reason'); return true; }
    close();
    return true;
  };
  useEffect(() => {
    if (!target) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', back);
    return () => listener.remove();
  });

  const choose = (next: ReportReason) => { setReason(next); setDetail(null); setStep('details'); };
  const submit = async () => {
    if (!target || !reason || busy) return;
    setBusy(true); setError('');
    try {
      const description = [detail, text.trim()].filter(Boolean).join(' - ') || undefined;
      if (target.send) await target.send(reason.code);
      else await api.post('/safety/report', {
        reportedUserId: target.userId, reason: reason.code, description,
        sourceType: target.sourceType, ...(target.sourceId ? { sourceId: target.sourceId } : {}), ...(target.matchId ? { matchId: target.matchId } : {}),
      });
      result.current.sent = true;
      void recordSetback();
      if (alsoBlock && target.canBlock !== false) {
        try {
          if (target.block) await target.block();
          else await api.post('/block', { blockedId: target.userId });
          result.current.blocked = true;
        } catch { /* the report went; blocking can be done again from their profile */ }
      }
      setStep('done');
    } catch {
      setError('Your report did not send. Check your connection and try again.');
    } finally { setBusy(false); }
  };

  if (!target) return null;
  const name = target.name || 'this person';
  const translateY = shown.interpolate({ inputRange: [0, 1], outputRange: [500, 0] });

  return <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={back}>
    <View style={styles.root}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: shown }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => { if (!busy) close(); }} accessibilityRole="button" accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: insets.bottom + 12, transform: [{ translateY }] }]}>
        <View style={styles.handle} />

        {step === 'reason' ? <>
          <Text accessibilityRole="header" style={styles.title}>Report {name}</Text>
          <Text style={styles.subtitle}>Why are you reporting? {name} won't know it was you.</Text>
          <ScrollView style={styles.reasons} showsVerticalScrollIndicator={false}>
            {REPORT_REASONS.map((item, index) => <Pressable key={item.code} accessibilityRole="button" onPress={() => choose(item)}
              style={({ pressed }) => [styles.reason, index > 0 && styles.reasonLine, pressed && styles.pressed]}>
              <Ionicons name={item.icon} size={20} color={item.urgent ? c.danger : c.secondary} />
              <Text style={styles.reasonText}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={c.muted} />
            </Pressable>)}
          </ScrollView>
        </> : null}

        {step === 'details' && reason ? <>
          <View style={styles.detailsHead}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to reasons" onPress={() => setStep('reason')} hitSlop={8} style={styles.backButton}>
              <Ionicons name="chevron-back" size={22} color={c.text} />
            </Pressable>
            <Text accessibilityRole="header" style={[styles.title, { flex: 1 }]} numberOfLines={2}>{reason.label}</Text>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
            {reason.details ? <View style={styles.chips}>
              {reason.details.map((item) => <Pressable key={item} accessibilityRole="radio" accessibilityState={{ checked: detail === item }}
                onPress={() => setDetail(detail === item ? null : item)} style={[styles.chip, detail === item && styles.chipOn]}>
                <Text style={[styles.chipText, detail === item && styles.chipTextOn]}>{item}</Text>
              </Pressable>)}
            </View> : null}
            <TextInput value={text} onChangeText={setText} placeholder="Anything else we should know? (optional)" placeholderTextColor={c.muted}
              multiline maxLength={1000} style={styles.input} accessibilityLabel="More detail, optional" />
            {target.canBlock !== false ? <View style={styles.blockRow}>
              <View style={{ flex: 1 }}><Text style={styles.blockTitle}>Also block {name}</Text><Text style={styles.blockNote}>You won't see each other anywhere in the app.</Text></View>
              <Switch value={alsoBlock} onValueChange={setAlsoBlock} trackColor={{ true: c.accent, false: '#3A363B' }} thumbColor="#FFFFFF" />
            </View> : null}
          </ScrollView>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void submit()} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
            {busy ? <ActivityIndicator color={c.accentText} /> : <Text style={styles.primaryText}>Send report</Text>}
          </Pressable>
        </> : null}

        {step === 'done' ? <>
          <View style={styles.doneMark}><Ionicons name="checkmark" size={30} color={c.success} /></View>
          <Text accessibilityRole="header" style={[styles.title, styles.center]}>Thanks for telling us</Text>
          <Text style={[styles.subtitle, styles.center]}>
            Our team reviews reports within 24 hours.{result.current.blocked ? ` ${name} is blocked.` : ''} {name} won't know it was you.
          </Text>
          {reason?.urgent ? <View style={styles.help}>
            <Text style={styles.helpTitle}>If you're in danger, get help now</Text>
            {(reason.code === 'self_harm' ? HELPLINES.filter((line) => line.number === '14416' || line.number === '112') : HELPLINES).map((line) =>
              <Pressable key={line.number} accessibilityRole="button" accessibilityLabel={`Call ${line.label}, ${line.number}`} onPress={() => void Linking.openURL(`tel:${line.number}`)}
                style={({ pressed }) => [styles.helpRow, pressed && styles.pressed]}>
                <Ionicons name="call" size={16} color={c.accent} />
                <Text style={styles.helpLabel}>{line.label}</Text>
                <Text style={styles.helpNumber}>{line.number}</Text>
              </Pressable>)}
          </View> : null}
          <Pressable accessibilityRole="button" onPress={() => { close(); if (navigationRef.isReady()) (navigationRef.navigate as (name: string, params?: object) => void)('Legal', { slug: 'safety' }); }} style={styles.link}>
            <Text style={styles.linkText}>Safety Centre</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={close} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
            <Text style={styles.primaryText}>Done</Text>
          </Pressable>
        </> : null}
      </Animated.View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { maxHeight: '92%', width: '100%', maxWidth: 560, alignSelf: 'center', backgroundColor: '#1D1B1E', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 8 },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: '#4A464C', marginBottom: 14 },
  title: { fontFamily: 'DMSans_700Bold', fontSize: 19, lineHeight: 25, color: c.text },
  subtitle: { fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 20, color: c.secondary, marginTop: 4 },
  center: { textAlign: 'center', alignSelf: 'center' },
  reasons: { marginTop: 12, maxHeight: 460 },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 50 },
  reasonLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
  reasonText: { flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 15, color: c.text },
  detailsHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  backButton: { width: 36, height: 36, marginLeft: -8, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, borderWidth: 1, borderColor: c.line, backgroundColor: '#262327' },
  chipOn: { backgroundColor: c.accent, borderColor: c.accent },
  chipText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: c.text },
  chipTextOn: { color: c.accentText },
  input: { minHeight: 96, maxHeight: 160, borderRadius: 14, backgroundColor: '#262327', color: c.text, fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 20, padding: 12, textAlignVertical: 'top' },
  blockRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, paddingVertical: 6 },
  blockTitle: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: c.text },
  blockNote: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: c.muted, marginTop: 2 },
  error: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: c.danger, marginTop: 10 },
  primary: { minHeight: 52, borderRadius: 26, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  primaryText: { fontFamily: 'DMSans_700Bold', fontSize: 15, color: c.accentText },
  doneMark: { alignSelf: 'center', width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(155,216,180,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 12, marginTop: 4 },
  help: { marginTop: 16, borderRadius: 16, backgroundColor: '#262327', paddingVertical: 6 },
  helpTitle: { fontFamily: 'DMSans_700Bold', fontSize: 13, color: c.danger, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4 },
  helpRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, minHeight: 42 },
  helpLabel: { flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 14, color: c.text },
  helpNumber: { fontFamily: 'DMSans_700Bold', fontSize: 15, color: c.text, fontVariant: ['tabular-nums'] },
  link: { alignSelf: 'center', minHeight: 40, justifyContent: 'center', marginTop: 8 },
  linkText: { fontFamily: 'DMSans_700Bold', fontSize: 14, color: c.accent },
  pressed: { opacity: 0.7 },
});
