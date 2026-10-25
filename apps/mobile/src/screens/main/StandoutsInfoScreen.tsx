import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StandoutsIcon } from '../../features/discovery/components/StandoutsIcon';

/** Explain our own selection and Rose rules, without promising a match or a date. */
export function StandoutsInfoContent({ onClose, weeklyGrant, trial = false, topInset = 0, bottomInset = 0 }: {
  onClose: () => void;
  weeklyGrant?: number | null;
  trial?: boolean;
  topInset?: number;
  bottomInset?: number;
}) {
  const grant = typeof weeklyGrant === 'number' && Number.isFinite(weeklyGrant) && weeklyGrant > 0 ? Math.floor(weeklyGrant) : null;
  return <View style={[styles.page, { paddingTop: topInset + 4 }]}>
    <View style={styles.header}>
      <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close Standouts information"
        style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
        <Ionicons name="close" size={24} color="#F6F1EC" />
      </Pressable>
      <Text accessibilityRole="header" style={styles.navTitle}>Learn more</Text>
      <View style={styles.headerSpace} />
    </View>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset + 24 }]}>
      <View style={styles.content}>
        <View style={styles.section}>
          <View style={styles.art}><StandoutsIcon size={152} color="#D9C5A5" heartColor="#F2BDC9" illustrated /></View>
          <Text accessibilityRole="header" style={styles.heading}>Welcome to Standouts</Text>
          <Text style={styles.body}>A fresh set of profiles, picked for you each day. Your preferences, shared interests and recent activity help shape your selection.</Text>
          <Text style={styles.note}>You can also find these people in Explore.</Text>
        </View>
        <View style={styles.section}>
          <View style={styles.art}>
            <Image source={require('../../../assets/illustrations/standouts-rose-bouquet.png')}
              style={styles.bouquet} resizeMode="contain" accessible={false} />
          </View>
          <Text accessibilityRole="header" style={styles.heading}>{'Get noticed\nwith a Rose'}</Text>
          <Text style={styles.body}>A Rose puts your profile at the top of their Likes. Add a short note about something you noticed in their profile.</Text>
          <Text style={styles.note}>{trial
            ? 'You can send one trial Rose before verifying. Verify your college for weekly Rose top-ups.'
            : grant
              ? `Your weekly Rose top-up is ${grant}. Your Rose balance shows when the next top-up arrives.`
              : 'Your Rose balance shows how many you have and when the next top-up arrives.'}</Text>
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Got it, return to Standouts"
          style={({ pressed }) => [styles.done, pressed && styles.pressed]}>
          <Text style={styles.doneText}>Got it</Text>
        </Pressable>
      </View>
    </ScrollView>
  </View>;
}

export function StandoutsInfoScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  return <StandoutsInfoContent onClose={() => navigation.goBack()} weeklyGrant={route.params?.weeklyGrant}
    trial={route.params?.trial} topInset={insets.top} bottomInset={insets.bottom} />;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#100F0D' },
  header: { height: 52, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerSpace: { width: 44 },
  navTitle: { flex: 1, color: '#F6F1EC', fontFamily: 'DMSans_700Bold', fontSize: 17, textAlign: 'center' },
  scroll: { flexGrow: 1, paddingHorizontal: 28 },
  content: { width: '100%', maxWidth: 440, alignSelf: 'center', paddingTop: 22 },
  section: { alignItems: 'center', paddingBottom: 36 },
  art: { height: 202, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  bouquet: { width: 212, height: 202 },
  heading: { color: '#F4EEE5', fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 33, lineHeight: 39,
    textAlign: 'center', paddingBottom: 6, marginBottom: 12, includeFontPadding: true },
  body: { color: '#C7BFB6', fontFamily: 'DMSans_400Regular', fontSize: 15, lineHeight: 24, textAlign: 'center' },
  note: { color: '#9D958D', fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 21, textAlign: 'center', marginTop: 14 },
  done: { alignSelf: 'center', minWidth: 140, minHeight: 48, paddingHorizontal: 26, borderRadius: 24,
    backgroundColor: '#F7D8E0', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  doneText: { color: '#3A222B', fontFamily: 'DMSans_700Bold', fontSize: 15 },
  pressed: { opacity: 0.72 },
});
