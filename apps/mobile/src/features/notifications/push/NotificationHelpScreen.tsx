import React, { useEffect } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Application from 'expo-application';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SettingsCard, SettingsPage, settingsLayout, settingsPalette as palette } from '../../../core/settings/SettingsLayout';
import { markFixOffered, phoneBrand, phoneMaker, type Maker } from './lateDelivery';

/**
 * "Notifications may be late on this phone" (NOTIFICATIONS_PLAN.md 11): two
 * steps for this phone's maker, and buttons straight to the right pages. No
 * keep-alive tricks - the phone's own settings are the fix.
 */

const STEPS: Record<Maker, { autostart: string; battery: string }> = {
  xiaomi: { autostart: 'Settings > Apps > Manage apps > IEM Connect > Autostart: on', battery: 'Battery saver: No restrictions' },
  vivo: { autostart: 'Settings > Apps > Autostart (or i Manager > App manager) > IEM Connect: on', battery: 'Battery > Background power consumption > IEM Connect: allow' },
  oppo: { autostart: 'Settings > Apps > App management > IEM Connect > Allow auto launch', battery: 'Battery usage > Allow background activity' },
  realme: { autostart: 'Settings > Apps > App management > IEM Connect > Allow auto launch', battery: 'Battery usage > Allow background activity' },
  oneplus: { autostart: 'Settings > Apps > IEM Connect > Battery', battery: 'Choose "Unrestricted" (or "Don\'t optimise")' },
  samsung: { autostart: 'Settings > Apps > IEM Connect > Battery', battery: 'Choose "Unrestricted", and take IEM Connect off "Sleeping apps"' },
  other: { autostart: 'Settings > Apps > IEM Connect > Battery', battery: 'Choose "Unrestricted" (or "Don\'t optimise")' },
};

async function openBatterySettings() {
  if (Platform.OS !== 'android') return Linking.openSettings();
  try {
    await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
  } catch {
    await Linking.openSettings();
  }
}

async function openAppDetails() {
  if (Platform.OS !== 'android') return Linking.openSettings();
  try {
    await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS, { data: `package:${Application.applicationId}` });
  } catch {
    await Linking.openSettings();
  }
}

export function NotificationHelpScreen() {
  const insets = useSafeAreaInsets();
  const maker = phoneMaker();
  const brand = phoneBrand();
  const steps = STEPS[maker];
  useEffect(() => { void markFixOffered(); }, []);
  return <SettingsPage title="Late notifications">
    <ScrollView contentContainerStyle={[settingsLayout.content, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
      <Text style={styles.lead}>
        Your {brand ? `${brand} ` : ''}phone can stop apps in the background to save battery, so messages arrive late. Two settings fix it:
      </Text>
      <SettingsCard title="1. Let IEM Connect start by itself" icon="flash-outline" showDividers={false}>
        <Text style={styles.step}>{steps.autostart}</Text>
        <Pressable onPress={() => void openAppDetails()} accessibilityRole="button" style={({ pressed }) => [styles.button, pressed && settingsLayout.pressed]}>
          <Text style={styles.buttonText}>Open app settings</Text>
        </Pressable>
      </SettingsCard>
      <SettingsCard title="2. No battery limits" icon="battery-charging-outline" showDividers={false}>
        <Text style={styles.step}>{steps.battery}</Text>
        <Pressable onPress={() => void openBatterySettings()} accessibilityRole="button" style={({ pressed }) => [styles.button, pressed && settingsLayout.pressed]}>
          <Text style={styles.buttonText}>Open battery settings</Text>
        </Pressable>
      </SettingsCard>
      <View style={styles.noteRow}>
        <Text style={styles.note}>IEM Connect doesn't run anything in the background - this only lets Android deliver your notifications on time.</Text>
      </View>
    </ScrollView>
  </SettingsPage>;
}

const styles = StyleSheet.create({
  lead: { color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 20, paddingHorizontal: 2 },
  step: { color: palette.text, fontFamily: 'DMSans_500Medium', fontSize: 14, lineHeight: 20, paddingVertical: 8 },
  button: { alignSelf: 'flex-start', backgroundColor: '#353036', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, marginBottom: 6 },
  buttonText: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 13 },
  noteRow: { paddingHorizontal: 4 },
  note: { color: palette.muted, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 17 },
});
