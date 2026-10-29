import React, { useContext, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { initialWindowMetrics, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { settingsPalette as palette } from '../../core/settings/SettingsLayout';
import { navigationRef } from '../../navigation/navigationRef';
import { api } from '../../services/api';
import { appVersion } from './diagnostics';
import { markInAppRatingShown, maybeAskForPlayReview, shouldShowInAppRating } from './engagement';

/**
 * "How's IEM Connect so far?" (docs/FEEDBACK.md): our own rating, for our own
 * numbers - never a step before Google Play's card. One tap on a face, no
 * typing: a low score offers the bug report, where the details belong.
 */
const FACES = [
  { score: 1, face: '😞', label: 'Bad' },
  { score: 2, face: '😕', label: 'Not great' },
  { score: 3, face: '😐', label: 'Okay' },
  { score: 4, face: '🙂', label: 'Good' },
  { score: 5, face: '😍', label: 'Love it' },
];
/** Under a low score: the way to say what went wrong is the bug report. */
const LOW_LINE = "Sorry to hear that. Tell us what went wrong and we'll fix it.";

/** How long a calm screen has to stay in view before either ask. */
const SETTLE_MS = 1500;

let show: ((demo?: boolean) => void) | null = null;
let considering = false;

/**
 * Explore or Matches came into view: the calm moment for either ask. Google
 * Play's card after something good; otherwise our own card when it is due.
 */
export async function considerRatingPrompts(screen: string) {
  if (considering) return;
  considering = true;
  try {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const still = () => navigationRef.isReady() && navigationRef.getCurrentRoute()?.name === screen;
    if (!still()) return;
    if (await maybeAskForPlayReview()) return;
    if (still() && (await shouldShowInAppRating())) show?.();
  } finally { considering = false; }
}




/**
 * TEMPORARY, development only: the Explore demo's "Rating" chip, to check the
 * card's layout on a phone. Nothing is sent and the real schedule is not
 * touched. Remove with the chip once the layout is signed off.
 */
export const showRatingDemo = () => { if (__DEV__) show?.(true); };

export function RatingPromptHost() {
  // Mounted beside the navigator, outside the safe-area provider: read the
  // context directly, as the report sheet does (features/safety/ReportSheet.tsx).
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets ?? { top: 0, bottom: 0, left: 0, right: 0 };
  const [visible, setVisible] = useState(false);
  const [demo, setDemo] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [thanked, setThanked] = useState(false);

  useEffect(() => {
    show = (isDemo = false) => {
      setScore(null); setThanked(false); setDemo(isDemo); setVisible(true);
      if (!isDemo) void markInAppRatingShown();
    };
    return () => { show = null; };
  }, []);

  const close = () => setVisible(false);
  const record = (value: number) => api.post('/feedback/rating', { score: value, comment: null, appVersion: appVersion() }).catch(() => undefined);

  const send = async () => {
    if (score === null) return;
    setSending(true);
    if (!demo) await record(score);
    setSending(false);
    setThanked(true);
    setTimeout(close, 1400);
  };
  const reportProblem = () => {
    if (score !== null && !demo) void record(score);
    close();
    navigationRef.navigate('ReportProblem', { source: 'rating' });
  };

  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
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
          {/* A low score offers the bug report on its own full-width row, so the buttons never crowd out of the card. */}
          {score !== null && score <= 2 && <>
            <Text style={styles.lowLine}>{LOW_LINE}</Text>
            <Pressable onPress={reportProblem} style={({ pressed }) => [styles.report, pressed && styles.pressed]} accessibilityRole="button">
              <Text style={styles.reportText}>Report a problem</Text>
            </Pressable>
          </>}
          <View style={styles.actions}>
            <Pressable onPress={close} style={({ pressed }) => [styles.later, pressed && styles.pressed]} accessibilityRole="button"><Text style={styles.laterText}>Not now</Text></Pressable>
            <Pressable onPress={() => void send()} disabled={score === null || sending} style={({ pressed }) => [styles.send, score === null && styles.sendOff, pressed && styles.pressed]} accessibilityRole="button">
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
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  later: { flex: 1, height: 48, borderRadius: 24, backgroundColor: palette.card, alignItems: 'center', justifyContent: 'center' },
  lowLine: { color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 14 },
  report: { height: 48, borderRadius: 24, borderWidth: 1, borderColor: palette.accent, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  pressed: { opacity: 0.8 },
  laterText: { color: palette.secondary, fontFamily: 'DMSans_500Medium', fontSize: 15 },
  reportText: { color: palette.accent, fontFamily: 'DMSans_500Medium', fontSize: 15 },
  send: { flex: 1, height: 48, paddingHorizontal: 20, borderRadius: 24, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.45 },
  sendText: { color: palette.accentText, fontFamily: 'DMSans_700Bold', fontSize: 15 },
  thanks: { alignItems: 'center', paddingVertical: 12, gap: 6 },
  thanksFace: { fontSize: 40 },
});
