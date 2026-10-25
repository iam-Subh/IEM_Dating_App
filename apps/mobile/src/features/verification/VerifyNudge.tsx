import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { ReminderBanner, reminderColors } from './ReminderParts';
import type { ReminderArtName } from './ReminderArt';
import { useVerificationStatus } from './useVerificationStatus';

/**
 * A verify reminder in a screen: one slim banner (ReminderParts.tsx) that
 * opens college verification. `dismissKey` lets the person close it for
 * `dismissDays`; without one it stays (deadlines, always-there spots).
 */
export function VerifyNudge({ text, title, cta = 'Verify', tone = 'info', icon, art, dismissKey, dismissDays = 7, onPress, compact }: {
  text: string;
  title?: string;
  cta?: string;
  tone?: 'info' | 'warn' | 'locked';
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  art?: ReminderArtName;
  dismissKey?: string;
  dismissDays?: number;
  onPress?: () => void;
  compact?: boolean;
}) {
  const navigation = useNavigation<any>();
  return <ReminderBanner art={art} icon={icon ?? (tone === 'info' ? 'school-outline' : 'time-outline')} title={title} text={text} action={cta}
    tone={tone === 'info' ? 'neutral' : 'warn'} dismissKey={dismissKey} dismissDays={dismissDays} flush={compact}
    onPress={onPress ?? (() => navigation.navigate('VerifyCollege'))} />;
}

/** A reminder shown only before verifying (an account that never verified). */
export function UnverifiedNudge(props: React.ComponentProps<typeof VerifyNudge>) {
  const status = useVerificationStatus();
  if (!status?.limited) return null;
  return <VerifyNudge {...props} />;
}

/**
 * One quiet line over the Story share row, before verifying. Not a button -
 * sharing is what they came to do.
 */
export function StoryShareVerifyLine({ bottom }: { bottom: number }) {
  const status = useVerificationStatus();
  if (!status?.limited) return null;
  return <View pointerEvents="none" style={[lineStyles.wrap, { bottom }]}>
    <View style={lineStyles.pill}>
      <Ionicons name="school-outline" size={14} color={reminderColors.secondary} />
      <Text style={lineStyles.text}>Verify your college to add your badge to Stories</Text>
    </View>
  </View>;
}

const lineStyles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center', paddingBottom: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(20,18,21,0.82)', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  text: { color: reminderColors.secondary, fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 16 },
});
