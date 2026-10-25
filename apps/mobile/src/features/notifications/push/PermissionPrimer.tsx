import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../../core/theme/colors';
import { acceptPrimer, declinePrimer, onPrimer, type PrimerMoment } from './permission';

/**
 * Our own question before Android's (NOTIFICATIONS_PLAN.md 12): says what
 * notifications are for, so "Turn on" means something. Mounted once, at the
 * root; `askAtMoment` decides when it appears.
 */
export function PermissionPrimer() {
  const [moment, setMoment] = useState<PrimerMoment | null>(null);
  useEffect(() => onPrimer(setMoment), []);
  if (!moment) return null;
  const copy = moment.kind === 'reply'
    ? { icon: 'chatbubble-ellipses' as const, title: `Want to know when ${moment.name} replies?`, body: "Turn on notifications so you don't miss it. You choose what comes through in Settings." }
    : { icon: 'notifications' as const, title: 'Know when someone likes you or messages you 💬', body: 'We tell you about matches, messages and likes - nothing at night unless you want it. You choose what comes through in Settings.' };
  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => void declinePrimer()} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.iconWrap}>
            <Ionicons name={copy.icon} size={30} color={colors.primary} />
          </View>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.body}>{copy.body}</Text>
          <Pressable accessibilityRole="button" onPress={() => void acceptPrimer()}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
            <Text style={styles.primaryText}>Turn on</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => void declinePrimer()} hitSlop={8}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
            <Text style={styles.secondaryText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1B1A1C', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 36, alignItems: 'center' },
  iconWrap: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,90,95,0.14)', marginBottom: 16 },
  title: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 20, textAlign: 'center', lineHeight: 26 },
  body: { color: 'rgba(255,255,255,0.7)', fontFamily: 'DMSans_400Regular', fontSize: 14, textAlign: 'center', lineHeight: 20, marginTop: 8, marginBottom: 22 },
  primary: { alignSelf: 'stretch', backgroundColor: colors.primary, borderRadius: 28, paddingVertical: 15, alignItems: 'center' },
  primaryText: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 16 },
  secondary: { marginTop: 14, paddingVertical: 6 },
  secondaryText: { color: 'rgba(255,255,255,0.6)', fontFamily: 'DMSans_500Medium', fontSize: 14 },
  pressed: { opacity: 0.8 },
});
