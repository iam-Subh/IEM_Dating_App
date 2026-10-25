import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { ReminderArt } from '../../verification/ReminderArt';
import { reminderColors } from '../../verification/ReminderParts';
import { recordGoodMoment } from '../../feedback/engagement';

export type MatchMoment = { name: string; verifyNudge: boolean };

/**
 * "It's a match!" - a celebration, not a system alert: the two hearts, who it
 * is, Say hi. When the match is verified and you are not, one quiet line
 * offers the same badge (reminder 41).
 */
export function MatchSheet({ match, onSayHi, onClose, onVerify }: {
  match: MatchMoment | null;
  onSayHi: () => void;
  onClose: () => void;
  onVerify: () => void;
}) {
  // A match is the good moment a Play rating may follow (features/feedback/engagement.ts).
  React.useEffect(() => { if (match) void recordGoodMoment(); }, [match]);
  return <Modal visible={!!match} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      {match ? <View accessibilityViewIsModal style={styles.card}>
        <ReminderArt name="match" size={168} motion="lively" bounce glow="#FF7FA0" delay={120} />
        <Text accessibilityRole="header" style={styles.title}>It’s a match!</Text>
        <Text style={styles.body}>You and {match.name} liked each other.</Text>
        {match.verifyNudge ? <Pressable onPress={onVerify} accessibilityRole="button" style={({ pressed }) => [styles.nudge, pressed && styles.pressed]}>
          <ReminderArt name="badge" size={34} delay={400} />
          <Text style={styles.nudgeText}>{match.name} has verified their college. <Text style={styles.nudgeLink}>Verify yours</Text></Text>
        </Pressable> : null}
        <Pressable onPress={onSayHi} accessibilityRole="button" style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
          <Text style={styles.primaryText}>Say hi</Text>
        </Pressable>
        <Pressable onPress={onClose} accessibilityRole="button" style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
          <Text style={styles.secondaryText}>Keep swiping</Text>
        </Pressable>
      </View> : null}
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: 24 },
  card: { alignSelf: 'center', width: '100%', maxWidth: 380, backgroundColor: '#1D1B1E', borderRadius: 28, paddingHorizontal: 22, paddingTop: 18, paddingBottom: 10, alignItems: 'center' },
  title: { fontFamily: 'DMSans_700Bold', fontSize: 26, lineHeight: 32, color: reminderColors.text, marginTop: 4 },
  body: { fontFamily: 'DMSans_400Regular', fontSize: 15, lineHeight: 21, color: reminderColors.secondary, marginTop: 4, textAlign: 'center' },
  nudge: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch', marginTop: 16, padding: 10, borderRadius: 14, backgroundColor: '#262327' },
  nudgeText: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 18, color: reminderColors.secondary },
  nudgeLink: { fontFamily: 'DMSans_700Bold', color: reminderColors.accent },
  primary: { alignSelf: 'stretch', minHeight: 52, borderRadius: 26, backgroundColor: reminderColors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  primaryText: { fontFamily: 'DMSans_700Bold', fontSize: 15, color: reminderColors.accentText },
  secondary: { alignSelf: 'stretch', minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: reminderColors.secondary },
  pressed: { opacity: 0.75 },
});
