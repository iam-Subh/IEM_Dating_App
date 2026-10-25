import React, { useContext, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { initialWindowMetrics, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { settingsPalette as palette } from '../../core/settings/SettingsLayout';
import { navigationRef } from '../../navigation/navigationRef';
import { api } from '../../services/api';
import { appVersion } from './diagnostics';
import { markInAppRatingShown, maybeAskForPlayReview, shouldShowInAppRating } from './engagement';

/**
 * "How's IEM Connect so far?" (docs/FEEDBACK.md): our own rating, for our own
 * numbers - never a step before Google Play's card. A low score asks what went
 * wrong and offers the bug report; a high one just says thank you.
 */
const FACES = [
  { score: 1, face: '😞', label: 'Bad' },
  { score: 2, face: '😕', label: 'Not great' },
  { score: 3, face: '😐', label: 'Okay' },
  { score: 4, face: '🙂', label: 'Good' },
  { score: 5, face: '😍', label: 'Love it' },
];
const FOLLOW_UP: Record<'low' | 'mid' | 'high', { title: string; placeholder: string }> = {
  low: { title: 'Sorry to hear that. What went wrong?', placeholder: 'Tell us what to fix' },
  mid: { title: 'What would make it better?', placeholder: 'One thing we could do better' },
  high: { title: 'Thank you! What do you like most?', placeholder: 'Optional' },
};

let show: ((preview?: boolean) => void) | null = null;
let considering = false;

/**
 * Explore or Matches came into view: the calm moment for either ask. Google
 * Play's card after something good; otherwise our own card when it is due.
 */
export async function considerRatingPrompts(screen: string) {
  if (considering) return;
  considering = true;
  try {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const still = () => navigationRef.isReady() && navigationRef.getCurrentRoute()?.name === screen;
    if (!still()) return;
    if (await maybeAskForPlayReview()) return;
    if (still() && (await shouldShowInAppRating())) show?.();
  } finally { considering = false; }
}

/** The card, in development, from Settings (to see it without waiting a week). */
export const previewRatingPrompt = () => show?.(true);

export function RatingPromptHost() {
  // Mounted beside the navigator, outside the safe-area provider: read the
  // context directly, as the report sheet does (features/safety/ReportSheet.tsx).
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets ?? { top: 0, bottom: 0, left: 0, right: 0 };
  const [visible, setVisible] = useState(false);
  const [preview, setPreview] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [thanked, setThanked] = useState(false);

  useEffect(() => {
    show = (isPreview = false) => {
      setScore(null); setComment(''); setThanked(false); setPreview(isPreview); setVisible(true);
      if (!isPreview) void markInAppRatingShown();
    };
    return () => { show = null; };
  }, []);

  const close = () => setVisible(false);
  const tone = score === null ? null : score <= 2 ? 'low' : score === 3 ? 'mid' : 'high';

  const send = async () => {
    if (score === null) return;
    setSending(true);
    if (!preview) await api.post('/feedback/rating', { score, comment: comment.trim() || null, appVersion: appVersion() }).catch(() => undefined);
    setSending(false);
    setThanked(true);
    setTimeout(close, 1400);
  };
  const reportProblem = () => {
    const words = comment.trim();
    if (score !== null && !preview) void api.post('/feedback/rating', { score, comment: words || null, appVersion: appVersion() }).catch(() => undefined);
    close();
    navigationRef.navigate('ReportProblem', { source: 'rating', description: words });
  };

  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
    <Pressable style={styles.scrim} onPress={close} accessibilityLabel="Close">
      <Pressable style={[styles.card, { marginBottom: insets.bottom + 16 }]} onPress={() => undefined} accessibilityViewIsModal>
        {thanked ? <View style={styles.thanks}>
          <Text style={styles.thanksFace}>💛</Text>
          <Text style={styles.title}>Thanks for telling us</Text>
          <Text style={styles.body}>It helps us make IEM Connect better.</Text>
        </View> : <>
          <Text style={styles.title}>How's IEM Connect so far?</Text>
          <Text style={styles.body}>Your answer goes to our team, not the Play Store.</Text>
          <View style={styles.faces} accessibilityRole="radiogroup">
            {FACES.map((item) => <Pressable key={item.score} onPress={() => setScore(item.score)}
              style={[styles.face, score === item.score && styles.faceOn, score !== null && score !== item.score && styles.faceDim]}
              accessibilityRole="radio" accessibilityState={{ selected: score === item.score }} accessibilityLabel={item.label}>
              <Text style={styles.faceEmoji}>{item.face}</Text>
              <Text style={styles.faceLabel} numberOfLines={1}>{item.label}</Text>
            </Pressable>)}
          </View>
          {tone && <>
            <Text style={styles.followTitle}>{FOLLOW_UP[tone].title}</Text>
            <TextInput value={comment} onChangeText={(text) => setComment(text.slice(0, 1000))} multiline textAlignVertical="top"
              placeholder={FOLLOW_UP[tone].placeholder} placeholderTextColor={palette.muted} style={styles.input} />
          </>}
          <View style={styles.actions}>
            <Pressable onPress={close} style={styles.later} accessibilityRole="button"><Text style={styles.laterText}>Not now</Text></Pressable>
            {tone === 'low' && <Pressable onPress={reportProblem} style={styles.later} accessibilityRole="button"><Text style={styles.reportText}>Report a problem</Text></Pressable>}
            <Pressable onPress={() => void send()} disabled={score === null || sending} style={[styles.send, score === null && styles.sendOff]} accessibilityRole="button">
              {sending ? <ActivityIndicator color={palette.accentText} /> : <Text style={styles.sendText}>Send</Text>}
            </Pressable>
          </View>
        </>}
      </Pressable>
    </Pressable>
  </Modal>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end', paddingHorizontal: 12 },
  card: { borderRadius: 24, backgroundColor: '#1E1D1C', padding: 20, width: '100%', maxWidth: 520, alignSelf: 'center' },
  title: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 20, textAlign: 'center' },
  body: { color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 13, textAlign: 'center', marginTop: 4 },
  faces: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18, gap: 6 },
  face: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 16, gap: 4 },
  faceOn: { backgroundColor: 'rgba(243,193,202,0.16)' },
  faceDim: { opacity: 0.45 },
  faceEmoji: { fontSize: 32 },
  faceLabel: { color: palette.secondary, fontFamily: 'DMSans_500Medium', fontSize: 11 },
  followTitle: { color: palette.text, fontFamily: 'DMSans_700Bold', fontSize: 15, marginTop: 16, marginBottom: 8 },
  input: { minHeight: 76, borderRadius: 14, backgroundColor: palette.card, color: palette.text, padding: 12, fontFamily: 'DMSans_400Regular', fontSize: 14 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginTop: 18 },
  later: { height: 44, paddingHorizontal: 12, justifyContent: 'center' },
  laterText: { color: palette.secondary, fontFamily: 'DMSans_500Medium', fontSize: 15 },
  reportText: { color: palette.accent, fontFamily: 'DMSans_500Medium', fontSize: 15 },
  send: { height: 44, minWidth: 92, paddingHorizontal: 20, borderRadius: 22, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.45 },
  sendText: { color: palette.accentText, fontFamily: 'DMSans_700Bold', fontSize: 15 },
  thanks: { alignItems: 'center', paddingVertical: 12, gap: 6 },
  thanksFace: { fontSize: 40 },
});
