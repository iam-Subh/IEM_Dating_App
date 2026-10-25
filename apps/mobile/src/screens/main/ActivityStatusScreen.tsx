import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../store';
import { updateUser } from '../../store/authSlice';
import { api } from '../../services/api';
import { getSocket } from '../../services/socket';
import { SettingsCard, SettingsPage, SettingsToggle, settingsLayout, settingsPalette as palette } from '../../core/settings/SettingsLayout';
import { createSettingsSwitchQueue, type SettingsSwitchValues } from '../../core/settings/settingsSwitchQueue';
import { ActivityPill } from '../../features/discovery/components/ActivityStatus';

/**
 * Settings > Activity status. Two audiences, two switches, both on by default
 * and both two-way: whatever you hide, you don't see on anyone else either.
 */

const valuesOf = (user: any): SettingsSwitchValues => ({
  searchDiscoverable: user?.searchDiscoverable !== false,
  notifyLikes: user?.notifyLikes !== false,
  showOnlineStatus: user?.showOnlineStatus !== false,
  showRecentlyActive: user?.showRecentlyActive !== false,
  searchByUnverified: user?.searchByUnverified === true,
});

export const ActivityStatusScreen = () => {
  const dispatch = useDispatch();
  const insets = useSafeAreaInsets();
  const user = useSelector((state: RootState) => state.auth.user);
  const [values, setValues] = useState(() => valuesOf(user));
  const [queue] = useState(() => createSettingsSwitchQueue(valuesOf(user), {
    save: async (field, value) => {
      const response = await api.put('/profile', { [field]: value });
      const saved = response.data?.data?.[field];
      return typeof saved === 'boolean' ? saved : value;
    },
    onChange: setValues,
    onConfirm: (field, value) => {
      dispatch(updateUser({ [field]: value }));
      // Matches' chats update at once: online, or hidden.
      if (field === 'showOnlineStatus') getSocket()?.emit('presence_privacy_changed', {});
    },
    onError: () => Alert.alert('Update failed', 'The app could not change your activity status. Try again.'),
  }));
  useEffect(() => { queue.sync(valuesOf(user)); }, [user?.showOnlineStatus, user?.showRecentlyActive, queue]);

  return <SettingsPage title="Activity status">
    <ScrollView contentContainerStyle={[settingsLayout.content, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
      <Text style={settingsLayout.intro}>Choose who can tell when you're around. Whatever you turn off, you won't see for other people either.</Text>

      <SettingsCard title="In chats" icon="chatbubbles-outline">
        <ToggleRow title="Show activity status"
          detail="Your matches see when you're online and when you were last active."
          value={values.showOnlineStatus} onChange={(value) => void queue.change('showOnlineStatus', value)} />
      </SettingsCard>
      <View style={styles.preview}>
        <View style={styles.chatAvatar}><View style={[styles.onlineDot, !values.showOnlineStatus && styles.hidden]} /></View>
        <View style={styles.previewCopy}>
          <Text style={styles.previewName}>Your match sees</Text>
          <Text style={styles.previewDetail}>{values.showOnlineStatus ? 'Online · Last seen 5 min ago' : 'Nothing - and you see nothing of theirs'}</Text>
        </View>
      </View>

      <SettingsCard title="On your profile card" icon="albums-outline">
        <ToggleRow title="Show recently active status"
          detail='People who see your card in Discover, Explore, Standouts and Likes You see "Active now" or "Recently active". Never an exact time.'
          value={values.showRecentlyActive} onChange={(value) => void queue.change('showRecentlyActive', value)} />
      </SettingsCard>
      <View style={styles.preview}>
        <View style={styles.cardThumb}>
          {values.showRecentlyActive ? <ActivityPill activity="now" compact /> : <Ionicons name="eye-off-outline" size={18} color={palette.muted} />}
        </View>
        <View style={styles.previewCopy}>
          <Text style={styles.previewName}>On your card</Text>
          <Text style={styles.previewDetail}>{values.showRecentlyActive
            ? '"Active now" within 10 minutes, "Recently active" within a day'
            : "Nothing - and you won't see it on anyone else's card"}</Text>
        </View>
      </View>

      <View style={styles.info}>
        <Ionicons name="information-circle-outline" size={17} color={palette.secondary} />
        <Text style={styles.infoText}>You count as active while the app is open on your screen. Changes apply straight away.</Text>
      </View>
    </ScrollView>
  </SettingsPage>;
};

function ToggleRow({ title, detail, value, onChange }: { title: string; detail: string; value: boolean; onChange: (value: boolean) => void }) {
  return <View style={styles.toggleRow}>
    <View style={styles.toggleBody}>
      <Text style={styles.toggleTitle}>{title}</Text>
      <Text style={styles.toggleDetail}>{detail}</Text>
    </View>
    <SettingsToggle label={title} hint={detail} value={value} onChange={onChange} />
  </View>;
}

const styles = StyleSheet.create({
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  toggleBody: { flex: 1 },
  toggleTitle: { color: palette.text, fontFamily: 'DMSans_700Bold', fontSize: 14 },
  toggleDetail: { color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 17, marginTop: 4 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16, borderWidth: 1, borderColor: palette.separator, marginTop: -4 },
  chatAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#3B2B34' },
  onlineDot: { position: 'absolute', right: 0, bottom: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: '#3DDC84', borderWidth: 2, borderColor: '#100F0D' },
  hidden: { opacity: 0 },
  cardThumb: { width: 92, height: 38, borderRadius: 10, backgroundColor: '#3B2B34', alignItems: 'center', justifyContent: 'center', paddingTop: 6 },
  previewCopy: { flex: 1, minWidth: 0 },
  previewName: { color: palette.text, fontFamily: 'DMSans_500Medium', fontSize: 12 },
  previewDetail: { color: palette.muted, fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 16, marginTop: 2 },
  info: { flexDirection: 'row', gap: 8, paddingHorizontal: 4 },
  infoText: { flex: 1, color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 17 },
});
