import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Share, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDispatch, useSelector } from 'react-redux';
import { updateUser } from '../../store/authSlice';
import { colors } from '../../core/theme/colors';
import { useNavigation } from '@react-navigation/native';
import { RootState } from '../../store';
import { api } from '../../services/api';
import { clearLocalSession, logoutSession } from '../../services/sessionLogout';

export const SettingsScreen = () => {
  const dispatch = useDispatch();
  const navigation = useNavigation<any>();
  const authUser = useSelector((state: RootState) => state.auth.user);
  const [accountBusy, setAccountBusy] = useState(false);

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            const result = await logoutSession();
            if (!result.localCleared || !result.serverRevoked) {
              Alert.alert('Logout incomplete', 'Local access was closed. Some stored data or server session cleanup failed.');
            }
          },
        },
      ]
    );
  };

  const handleExport = async () => {
    setAccountBusy(true);
    try {
      const created = await api.post('/account/exports');
      const request = await api.get(`/account/requests/${created.data.data.id}`);
      await Share.share({
        title: 'My IEM Dating data',
        message: JSON.stringify(request.data.data.result, null, 2),
      });
    } catch {
      Alert.alert('Export failed', 'The app could not create your data export. Try again.');
    } finally { setAccountBusy(false); }
  };

  const handleDeletion = () => {
    Alert.alert(
      'Delete account',
      'Your profile will leave discovery now. The app will erase your personal data after 30 days. Sign in during this period to cancel the request.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            setAccountBusy(true);
            try {
              await api.post('/account/deletion', { confirmation: 'DELETE' });
              if (!await clearLocalSession()) {
                Alert.alert('Storage cleanup failed', 'Account deletion was scheduled and local access was closed. Some stored data could not be removed.');
              }
            } catch {
              Alert.alert('Request failed', 'The app could not schedule account deletion. Try again.');
            } finally { setAccountBusy(false); }
          },
        },
      ],
    );
  };

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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color={colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        
        {authUser?.distancePreference && (
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Ionicons name="navigate-outline" size={20} color={colors.text.secondary} />
              <Text style={styles.rowText}>Distance Preference</Text>
            </View>
            <Text style={styles.rowValue}>{authUser.distancePreference} km</Text>
          </View>
        )}

        <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Ionicons name="time-outline" size={20} color={colors.text.secondary} />
              <Text style={styles.rowText}>Member Since</Text>
            </View>
            <Text style={styles.rowValue}>
                {authUser?.createdAt ? new Date(authUser.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : ''}
            </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Privacy and security</Text>
        <TouchableOpacity style={styles.dataButton} onPress={() => navigation.navigate('ActiveSessions')}>
          <Ionicons name="phone-portrait-outline" size={20} color={colors.text.primary} />
          <Text style={styles.rowText}>Active sessions</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dataButton} onPress={() => navigation.navigate('BlockedAccounts')}>
          <Ionicons name="ban-outline" size={20} color={colors.text.primary} />
          <Text style={styles.rowText}>Blocked accounts</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your data</Text>
        <TouchableOpacity style={styles.dataButton} onPress={handleExport} disabled={accountBusy}>
          <Ionicons name="download-outline" size={20} color={colors.text.primary} />
          <Text style={styles.rowText}>Export my data</Text>
        </TouchableOpacity>
        {authUser?.accountStatus === 'deletion_pending' ? (
          <TouchableOpacity style={styles.dataButton} onPress={handleCancelDeletion} disabled={accountBusy}>
            <Ionicons name="refresh-outline" size={20} color={colors.text.primary} />
            <Text style={styles.rowText}>Cancel account deletion</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.dataButton} onPress={handleDeletion} disabled={accountBusy}>
            <Ionicons name="trash-outline" size={20} color={colors.error} />
            <Text style={styles.deleteText}>Delete account</Text>
          </TouchableOpacity>
        )}
        {accountBusy && <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />}
      </View>

      <View style={styles.section}>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    marginLeft: -8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text.primary,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text.secondary,
    marginBottom: 16,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowText: {
    fontSize: 16,
    color: colors.text.primary,
  },
  rowValue: {
    fontSize: 16,
    color: colors.text.secondary,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.2)',
    gap: 8,
    marginTop: 20,
  },
  dataButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  deleteText: {
    fontSize: 16,
    color: colors.error,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.error,
  },
});
