import { useVerificationStatus } from '../../features/verification/useVerificationStatus';
import { SUPPORT_EMAIL, writeToSupport } from '../../core/support';
import { openPlayStoreListing } from '../../features/feedback/engagement';
import { previewRatingPrompt } from '../../features/feedback/RatingPrompt';
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { updateUser } from '../../store/authSlice';
import { colors } from '../../core/theme/colors';
import { useNavigation } from '@react-navigation/native';
import { RootState } from '../../store';
import { api } from '../../services/api';
import { logoutSession } from '../../services/sessionLogout';
import { getSocket } from '../../services/socket';
import { SettingsToggle } from '../../core/settings/SettingsLayout';
import { createSettingsSwitchQueue, type SettingsSwitchValues } from '../../core/settings/settingsSwitchQueue';
import { unitOf, type DistanceUnit } from '../../features/location/distanceUnits';
import { notifyPreferencesChanged } from '../../features/discovery/preferencesEvents';

const profileSwitchValues = (user: any): SettingsSwitchValues => ({
  searchDiscoverable: user?.searchDiscoverable !== false,
  notifyLikes: user?.notifyLikes !== false,
  showOnlineStatus: user?.showOnlineStatus !== false,
  showRecentlyActive: user?.showRecentlyActive !== false,
  // Off by default: unverified accounts can't find you by name (GOOGLE_SIGNUP_PLAN.md, Search).
  searchByUnverified: user?.searchByUnverified === true,
});

export const SettingsScreen = () => {
  const dispatch = useDispatch();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const authUser = useSelector((state: RootState) => state.auth.user);
  const [accountBusy, setAccountBusy] = useState(false);
  const verification = useVerificationStatus();
  const [switchValues, setSwitchValues] = useState(() => profileSwitchValues(authUser));
  const [switchQueue] = useState(() => createSettingsSwitchQueue(profileSwitchValues(authUser), {
    save: async (field, value) => {
      const response = await api.put('/profile', { [field]: value });
      const saved = response.data?.data?.[field];
      return typeof saved === 'boolean' ? saved : value;
    },
    onChange: setSwitchValues,
    onConfirm: (field, value) => {
      // A response for one switch must not replace the other switch values.
      dispatch(updateUser({ [field]: value }));
      if (field === 'showOnlineStatus') getSocket()?.emit('presence_privacy_changed', {});
    },
    onError: (field) => {
      const label = field === 'showOnlineStatus' ? 'online status' : field === 'searchDiscoverable' ? 'search' : 'notification';
      Alert.alert('Update failed', `The app could not change your ${label} setting.`);
    },
  }));
  useEffect(() => { switchQueue.sync(profileSwitchValues(authUser)); }, [authUser?.searchDiscoverable, authUser?.searchByUnverified, authUser?.notifyLikes, authUser?.showOnlineStatus, authUser?.showRecentlyActive, switchQueue]);

  // Kilometres or miles: how distances read everywhere. Nothing about who you see changes.
  const unit = unitOf(authUser as any);
  const [unitSaving, setUnitSaving] = useState(false);
  const chooseUnit = async (next: DistanceUnit) => {
    if (next === unit || unitSaving) return;
    setUnitSaving(true);
    dispatch(updateUser({ distanceUnit: next }));
    try {
      await api.put('/profile', { distanceUnit: next });
      // Cards carry their distance band from the server: reload them in the new unit.
      notifyPreferencesChanged();
    } catch {
      dispatch(updateUser({ distanceUnit: unit }));
      Alert.alert('Update failed', 'The app could not change your distance units.');
    } finally { setUnitSaving(false); }
  };

  const handleLogout = () => {
    const leave = async (everywhere: boolean) => {
      const result = await logoutSession({ everywhere });
      if (!result.localCleared || !result.serverRevoked) {
        Alert.alert('Logout incomplete', everywhere
          ? 'This phone is signed out. Other devices may stay signed in: check Active sessions next time.'
          : 'Local access was closed. Some stored data or server session cleanup failed.');
      }
    };
    Alert.alert(
      'Log out?',
      'Log out of this phone, or of every device signed in to your account.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'All devices', style: 'destructive', onPress: () => void leave(true) },
        { text: 'This phone', style: 'destructive', onPress: () => void leave(false) },
      ],
    );
  };

  // One JSON file, saved to a folder or opened (DataExportScreen).
  const handleExport = () => navigation.navigate('DataExport');


  // What deleting does, a reason, and DELETE typed to confirm (DeleteAccountScreen).
  const handleDeletion = () => navigation.navigate('DeleteAccount');

  const handleCancelDeletion = async () => {
    setAccountBusy(true);
    try {
      await api.delete('/account/deletion');
      dispatch(updateUser({ accountStatus: 'active' }));
      Alert.alert('Deletion cancelled', 'Your account is active again.');
    } catch {
      Alert.alert('Request failed', 'The app could not cancel account deletion.');
    } finally { setAccountBusy(false); }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { height: insets.top + 52, paddingTop: insets.top }]}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={25} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <View style={styles.cardHeading}>
            <View style={styles.headingIcon}>
              <Ionicons name="heart-outline" size={18} color={colors.primaryLight} />
            </View>
            <Text style={styles.cardTitle}>Matching</Text>
          </View>
          <TouchableOpacity style={styles.linkRow} onPress={() => navigation.navigate('Preferences')}>
            <Ionicons name="options-outline" size={20} color={palette.icon} />
            <View style={styles.rowBody}>
              <Text style={styles.rowText}>Discovery preferences</Text>
              <Text style={styles.rowHint}>Who you see, age, and distance</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkRow} onPress={() => navigation.navigate('LocationSettings')}>
            <Ionicons name="location-outline" size={20} color={palette.icon} />
            <Text style={[styles.rowText, styles.rowBody]}>Location and saved places</Text>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </TouchableOpacity>
          <View style={styles.switchRow}>
            <Ionicons name="speedometer-outline" size={20} color={palette.icon} />
            <View style={styles.rowBody}>
              <Text style={styles.rowText}>Distance units</Text>
              <Text style={styles.rowHint}>How distances show on cards and in your preferences.</Text>
            </View>
            <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel="Distance units">
              {(['km', 'mi'] as const).map((option) => (
                <TouchableOpacity key={option} onPress={() => void chooseUnit(option)} disabled={unitSaving}
                  accessibilityRole="radio" accessibilityState={{ checked: unit === option }}
                  accessibilityLabel={option === 'km' ? 'Kilometres' : 'Miles'}
                  style={[styles.segmentOption, unit === option && styles.segmentSelected]}>
                  <Text style={[styles.segmentText, unit === option && styles.segmentTextSelected]}>{option}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={[styles.switchRow, !(switchValues.searchDiscoverable && verification?.verified) && styles.lastRow]}>
            <Ionicons name="search-outline" size={20} color={palette.icon} />
            <View style={styles.rowBody}>
              <Text style={styles.rowText}>Discoverable in search</Text>
              <Text style={styles.rowHint}>People at your college can find you by name.</Text>
            </View>
            <SettingsToggle label="Discoverable in search" value={switchValues.searchDiscoverable}
              onChange={(value) => void switchQueue.change('searchDiscoverable', value)} />
          </View>
          {/* "Who can find me by name" (GOOGLE_SIGNUP_PLAN.md, Search): only a verified student has the choice. */}
          {switchValues.searchDiscoverable && verification?.verified && <View style={[styles.switchRow, styles.lastRow]}>
            <Ionicons name="people-outline" size={20} color={palette.icon} />
            <View style={styles.rowBody}>
              <Text style={styles.rowText}>Unverified accounts can find me</Text>
              <Text style={styles.rowHint}>Off: only verified students find you by name. On: people who haven't verified their college yet, on your campus, can too.</Text>
            </View>
            <SettingsToggle label="Unverified accounts can find me" value={switchValues.searchByUnverified}
              onChange={(value) => void switchQueue.change('searchByUnverified', value)} />
          </View>}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeading}>
            <View style={styles.headingIcon}>
              <Ionicons name="shield-checkmark-outline" size={18} color={colors.primaryLight} />
            </View>
            <Text style={styles.cardTitle}>Privacy and security</Text>
          </View>
          <TouchableOpacity style={styles.linkRow} onPress={() => navigation.navigate('ActiveSessions')}>
            <Ionicons name="phone-portrait-outline" size={20} color={palette.icon} />
            <Text style={[styles.rowText, styles.rowBody]}>Active sessions</Text>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkRow} onPress={() => navigation.navigate('BlockedAccounts')}>
            <Ionicons name="ban-outline" size={20} color={palette.icon} />
            <Text style={[styles.rowText, styles.rowBody]}>Blocked accounts</Text>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkRow} onPress={() => navigation.navigate('StorySettings')}>
            <Ionicons name="aperture-outline" size={20} color={palette.icon} />
            <Text style={[styles.rowText, styles.rowBody]}>Story</Text>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.linkRow, styles.lastRow]} onPress={() => navigation.navigate('ActivityStatus')}>
            <Ionicons name="radio-outline" size={20} color={palette.icon} />
            <View style={styles.rowBody}>
              <Text style={styles.rowText}>Activity status</Text>
              <Text style={styles.rowHint}>
                {[switchValues.showOnlineStatus ? 'Online in chats' : null, switchValues.showRecentlyActive ? 'Recently active on cards' : null]
                  .filter(Boolean).join(' · ') || 'Hidden'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeading}>
            <View style={styles.headingIcon}>
              <Ionicons name="notifications-outline" size={18} color={colors.primaryLight} />
            </View>
            <Text style={styles.cardTitle}>Notifications</Text>
          </View>
          <TouchableOpacity style={[styles.linkRow, styles.lastRow]} onPress={() => navigation.navigate('AppSettings')}>
            <Ionicons name="options-outline" size={20} color={palette.icon} />
            <View style={styles.rowBody}>
              <Text style={styles.rowText}>Manage notifications</Text>
              <Text style={styles.rowHint}>{(authUser as any)?.notificationPrefs?.pause_all ? 'Paused' : 'Choose each kind, sound and vibration'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeading}>
            <View style={styles.headingIcon}>
              <Ionicons name="person-outline" size={18} color={colors.primaryLight} />
            </View>
            <Text style={styles.cardTitle}>Account and data</Text>
          </View>
          <TouchableOpacity style={styles.linkRow} onPress={() => navigation.navigate('Account')}>
            <Ionicons name="key-outline" size={20} color={palette.icon} />
            <View style={styles.rowBody}>
              <Text style={styles.rowText}>Account</Text>
              <Text style={styles.rowHint} numberOfLines={1}>{authUser?.email ?? 'Email and Google'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </TouchableOpacity>
          <View style={styles.infoRow}>
            <Ionicons name="time-outline" size={20} color={palette.icon} />
            <Text style={[styles.rowText, styles.rowBody]}>Member since</Text>
            <Text style={styles.rowValue}>
              {authUser?.createdAt
                ? new Date(authUser.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                : '—'}
            </Text>
          </View>
          <TouchableOpacity style={styles.linkRow} onPress={() => navigation.navigate('ChatDownloads')}>
            <Ionicons name="download-outline" size={20} color={palette.icon} />
            <Text style={[styles.rowText, styles.rowBody]}>Chat downloads</Text>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkRow} onPress={handleExport} disabled={accountBusy}>
            <Ionicons name="archive-outline" size={20} color={palette.icon} />
            <View style={styles.rowBody}>
              <Text style={styles.rowText}>Export my data</Text>
              <Text style={styles.rowHint}>Everything the app keeps about you, as one file</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </TouchableOpacity>
          {authUser?.accountStatus === 'deletion_pending' ? (
            <TouchableOpacity style={[styles.linkRow, styles.lastRow]} onPress={handleCancelDeletion} disabled={accountBusy}>
              <Ionicons name="refresh-outline" size={20} color={colors.primaryLight} />
              <Text style={[styles.rowText, styles.rowBody]}>Cancel account deletion</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.linkRow, styles.lastRow]} onPress={handleDeletion} disabled={accountBusy}>
              <Ionicons name="trash-outline" size={20} color={palette.danger} />
              <Text style={[styles.rowText, styles.rowBody, styles.dangerText]}>Delete account</Text>
            </TouchableOpacity>
          )}
          {accountBusy && <ActivityIndicator color={colors.primary} style={styles.busy} />}
        </View>

        {/* Safety, help and the published documents (docs/SAFETY_AND_LEGAL.md 6). */}
        <View style={styles.card}>
          <View style={styles.cardHeading}>
            <View style={styles.headingIcon}>
              <Ionicons name="shield-checkmark-outline" size={18} color={colors.primaryLight} />
            </View>
            <Text style={styles.cardTitle}>Safety and help</Text>
          </View>
          <TouchableOpacity style={[styles.linkRow]} onPress={() => navigation.navigate('Legal', { slug: 'safety' })} accessibilityRole="button">
            <Ionicons name="medkit-outline" size={20} color={palette.icon} />
            <View style={styles.rowBody}>
              <Text style={styles.rowText}>Safety Centre</Text>
              <Text style={styles.rowHint} numberOfLines={1}>Dating safety, scams and helplines</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.linkRow]} onPress={() => navigation.navigate('ReportSomeone')} accessibilityRole="button">
            <Ionicons name="flag-outline" size={20} color={palette.icon} />
            <View style={styles.rowBody}>
              <Text style={styles.rowText}>Report someone</Text>
              <Text style={styles.rowHint} numberOfLines={1}>Someone you unmatched or blocked</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.linkRow]} onPress={() => navigation.navigate('ReportProblem')} accessibilityRole="button">
            <Ionicons name="construct-outline" size={20} color={palette.icon} />
            <View style={styles.rowBody}>
              <Text style={styles.rowText}>Report a problem</Text>
              <Text style={styles.rowHint} numberOfLines={1}>Something in the app not working? Tell us</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.linkRow]} onPress={() => navigation.navigate('MyReports')} accessibilityRole="button">
            <Ionicons name="list-outline" size={20} color={palette.icon} />
            <View style={styles.rowBody}>
              <Text style={styles.rowText}>My reports</Text>
              <Text style={styles.rowHint} numberOfLines={1}>Follow the problems you reported</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.linkRow]} onPress={() => void openPlayStoreListing()} accessibilityRole="button">
            <Ionicons name="star-outline" size={20} color={palette.icon} />
            <View style={styles.rowBody}>
              <Text style={styles.rowText}>Rate us on Google Play</Text>
              <Text style={styles.rowHint} numberOfLines={1}>Tell others what you think</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </TouchableOpacity>
          {__DEV__ && (
            <TouchableOpacity style={[styles.linkRow]} onPress={previewRatingPrompt} accessibilityRole="button">
              <Ionicons name="happy-outline" size={20} color={palette.icon} />
              <View style={styles.rowBody}>
                <Text style={styles.rowText}>Preview rating card</Text>
                <Text style={styles.rowHint} numberOfLines={1}>Development only</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={palette.muted} />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.linkRow]} onPress={() => navigation.navigate('HiddenWords')} accessibilityRole="button">
            <Ionicons name="eye-off-outline" size={20} color={palette.icon} />
            <View style={styles.rowBody}>
              <Text style={styles.rowText}>Hidden Words</Text>
              <Text style={styles.rowHint} numberOfLines={1}>Fold away messages with words you don't want to see</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.linkRow]} onPress={() => void writeToSupport('Help')} accessibilityRole="button">
            <Ionicons name="mail-outline" size={20} color={palette.icon} />
            <View style={styles.rowBody}>
              <Text style={styles.rowText}>Contact support</Text>
              <Text style={styles.rowHint} numberOfLines={1}>{SUPPORT_EMAIL}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.linkRow, styles.lastRow]} onPress={() => navigation.navigate('Legal', { slug: 'grievance' })} accessibilityRole="button">
            <Ionicons name="chatbox-ellipses-outline" size={20} color={palette.icon} />
            <View style={styles.rowBody}>
              <Text style={styles.rowText}>Grievance redressal</Text>
              <Text style={styles.rowHint} numberOfLines={1}>Complaints answered within 15 days</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeading}>
            <View style={styles.headingIcon}>
              <Ionicons name="document-text-outline" size={18} color={colors.primaryLight} />
            </View>
            <Text style={styles.cardTitle}>Legal</Text>
          </View>
          <TouchableOpacity style={[styles.linkRow]} onPress={() => navigation.navigate('Legal', { slug: 'terms' })} accessibilityRole="button">
            <Ionicons name="reader-outline" size={20} color={palette.icon} />
            <View style={styles.rowBody}>
              <Text style={styles.rowText}>Terms of Service</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.linkRow]} onPress={() => navigation.navigate('Legal', { slug: 'privacy' })} accessibilityRole="button">
            <Ionicons name="lock-closed-outline" size={20} color={palette.icon} />
            <View style={styles.rowBody}>
              <Text style={styles.rowText}>Privacy Policy</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.linkRow]} onPress={() => navigation.navigate('Legal', { slug: 'guidelines' })} accessibilityRole="button">
            <Ionicons name="people-outline" size={20} color={palette.icon} />
            <View style={styles.rowBody}>
              <Text style={styles.rowText}>Community Guidelines</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.linkRow, styles.lastRow]} onPress={() => navigation.navigate('Legal', { slug: 'child-safety' })} accessibilityRole="button">
            <Ionicons name="heart-half-outline" size={20} color={palette.icon} />
            <View style={styles.rowBody}>
              <Text style={styles.rowText}>Child Safety Standards</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.appSettings} onPress={() => navigation.navigate('AppSettings')} accessibilityRole="button">
          <View style={styles.headingIcon}>
            <Ionicons name="settings-outline" size={18} color={colors.primaryLight} />
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.cardTitle}>App settings</Text>
            <Text style={styles.rowHint}>Notifications, sound and vibration, Team IEM Connect</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={palette.muted} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={19} color={palette.danger} />
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const palette = {
  card: '#232323',
  muted: '#89858B',
  icon: '#C1BDC4',
  danger: '#FF8C93',
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  backButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerSpacer: { width: 40 },
  headerTitle: { fontFamily: 'DMSans_700Bold', fontSize: 21, color: '#FFFFFF' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 10, gap: 12 },
  card: { backgroundColor: palette.card, borderRadius: 18, paddingHorizontal: 16, paddingTop: 13, paddingBottom: 2 },
  appSettings: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.card, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14 },
  cardHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 11, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  headingIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.055)' },
  cardTitle: { fontFamily: 'DMSans_700Bold', fontSize: 17, color: '#FFFFFF' },
  linkRow: { minHeight: 51, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  switchRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  infoRow: { minHeight: 51, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  lastRow: { borderBottomWidth: 0 },
  rowBody: { flex: 1 },
  rowText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: '#F6F4F6' },
  rowHint: { fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 15, marginTop: 2, color: '#ABA5AE' },
  rowValue: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#BDB7C0' },
  dangerText: { color: palette.danger },
  busy: { marginVertical: 8 },
  logoutButton: { height: 45, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, backgroundColor: '#3D2729' },
  logoutText: { fontFamily: 'DMSans_700Bold', fontSize: 14, color: palette.danger },
  segment: { flexDirection: 'row', backgroundColor: '#363337', borderRadius: 16, padding: 3 },
  segmentOption: { minWidth: 40, minHeight: 30, borderRadius: 13, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  segmentSelected: { backgroundColor: '#F3C1CA' },
  segmentText: { fontFamily: 'DMSans_700Bold', fontSize: 13, color: '#BDB7C0' },
  segmentTextSelected: { color: '#331C23' },
});
