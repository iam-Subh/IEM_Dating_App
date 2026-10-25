import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../services/api';
import { SettingsEmptyState, SettingsPage, settingsLayout, settingsPalette as palette } from '../../core/settings/SettingsLayout';

/**
 * The people you have blocked, and a way back. Blocking hides two people from
 * each other everywhere - discovery, Search, Stories, Likes, chat - and ends a
 * match. Unblocking lifts that, but restores nothing: a match, follows and
 * Close Friends stay ended, so it is never a way to undo a block quietly.
 */

type BlockedAccount = { userId: string; name: string; avatar?: string | null; department?: string | null; blockedAt?: string };

function AccountAvatar({ item }: { item: BlockedAccount }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.avatar]);
  return <View style={styles.avatar}>
    {item.avatar && !failed ? <Image source={{ uri: item.avatar }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setFailed(true)} accessible={false} />
      : <Text style={styles.initial}>{item.name?.trim().charAt(0).toUpperCase() || '?'}</Text>}
  </View>;
}

function blockedOn(iso?: string) {
  if (!iso) return 'Blocked';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Blocked' : `Blocked ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export const BlockedAccountsScreen = () => {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<BlockedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try { const response = await api.get('/block'); setItems(response.data.data ?? []); }
    catch { setFailed(true); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? items.filter((item) => item.name.toLowerCase().includes(needle)) : items;
  }, [items, query]);

  const unblock = (item: BlockedAccount) => {
    if (busyId) return;
    const first = item.name.split(/\s+/)[0];
    Alert.alert(
      `Unblock ${item.name}?`,
      `${first} won't be told. You may see each other again in discovery, Search and Stories if you both qualify. Your earlier match, chat and follows stay ended.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unblock', onPress: async () => {
          setBusyId(item.userId);
          // Gone from the list at once; back if the server says no.
          setItems((current) => current.filter((entry) => entry.userId !== item.userId));
          try {
            await api.delete(`/block/${item.userId}`);
          } catch {
            setItems((current) => (current.some((entry) => entry.userId === item.userId) ? current : [item, ...current]));
            Alert.alert('Could not unblock', 'Check your connection and try again.');
          } finally { setBusyId(null); }
        } },
      ],
    );
  };

  return <SettingsPage title="Blocked accounts">
    <FlatList accessibilityLabel="Blocked accounts" data={shown} keyExtractor={(item) => item.userId} showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[settingsLayout.content, styles.list, { paddingBottom: insets.bottom + 20 }]}
      ListHeaderComponent={<View style={styles.intro}>
        <View style={styles.explainer}>
          <Ionicons name="shield-checkmark-outline" size={18} color={palette.accent} />
          <Text style={styles.explainerText}>
            People you block can't see you, find you in Search, like you, or message you, and they aren't told. Block anyone from their profile or a chat.
          </Text>
        </View>
        {items.length > 0 && <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>Blocked</Text><Text style={styles.count}>{items.length}</Text>
        </View>}
        {items.length > 6 && <View style={styles.search}>
          <Ionicons name="search" size={16} color={palette.secondary} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search blocked accounts" placeholderTextColor={palette.secondary}
            style={styles.searchInput} autoCorrect={false} accessibilityLabel="Search blocked accounts" />
          {query.length > 0 && <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={16} color={palette.secondary} />
          </Pressable>}
        </View>}
        {failed && items.length > 0 && <Pressable onPress={load} accessibilityRole="button" style={styles.refreshError}>
          <Ionicons name="refresh-outline" size={16} color={palette.accent} /><Text style={styles.refreshText}>Could not refresh. Tap to retry.</Text>
        </Pressable>}
      </View>}
      renderItem={({ item, index }) => <View style={[styles.row, index === 0 && styles.firstRow, index === shown.length - 1 && styles.lastRow]}>
        <AccountAvatar item={item} />
        <View style={styles.copy}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.blockedLabel} numberOfLines={1}>{[item.department, blockedOn(item.blockedAt)].filter(Boolean).join(' · ')}</Text>
        </View>
        <Pressable onPress={() => unblock(item)} disabled={busyId !== null} accessibilityRole="button" accessibilityLabel={`Unblock ${item.name}`}
          accessibilityState={{ disabled: busyId !== null, busy: busyId === item.userId }}
          style={({ pressed }) => [styles.unblock, pressed && settingsLayout.pressed, busyId && busyId !== item.userId && styles.disabled]}>
          {busyId === item.userId ? <ActivityIndicator size="small" color={palette.accentText} /> : <Text style={styles.action}>Unblock</Text>}
        </Pressable>
      </View>}
      ListEmptyComponent={loading ? <View style={settingsLayout.loading}><ActivityIndicator color={palette.accent} /><Text style={settingsLayout.intro}>Loading blocked accounts…</Text></View>
        : query.trim() && items.length > 0 ? <Text style={styles.noMatch}>No blocked account matches “{query.trim()}”.</Text>
        : failed ? <SettingsEmptyState icon="cloud-offline-outline" title="Could not load accounts"
          message="Check your connection and try again." onRetry={load} />
        : <View style={[settingsLayout.empty, styles.kittenEmpty]}>
          <Image source={require('../../../assets/illustrations/blocked-kitten-v2.png')}
            style={styles.blockedKitten} resizeMode="contain" fadeDuration={0} accessible={false} />
          <Text style={settingsLayout.emptyTitle}>No blocked accounts</Text>
          <Text style={settingsLayout.emptyMessage}>Accounts you block will appear here.</Text>
        </View>}
    />
  </SettingsPage>;
};
const styles = StyleSheet.create({
  list: { gap: 0 },
  kittenEmpty: { paddingTop: 24 },
  blockedKitten: { width: 132, height: 198, marginBottom: 12 },
  intro: { paddingBottom: 14, gap: 12 },
  explainer: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 16, backgroundColor: palette.card },
  explainerText: { flex: 1, color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 16 },
  count: { color: palette.accent, fontFamily: 'DMSans_700Bold', fontSize: 14 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 42, paddingHorizontal: 12, borderRadius: 14, backgroundColor: palette.card },
  searchInput: { flex: 1, color: palette.text, fontFamily: 'DMSans_400Regular', fontSize: 14, paddingVertical: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: palette.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.separator },
  firstRow: { borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  lastRow: { borderBottomLeftRadius: 18, borderBottomRightRadius: 18, borderBottomWidth: 0 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#3B2B34', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initial: { color: palette.accent, fontFamily: 'DMSans_700Bold', fontSize: 19 },
  copy: { flex: 1, minWidth: 0 },
  name: { color: palette.text, fontFamily: 'DMSans_700Bold', fontSize: 14 },
  blockedLabel: { color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 11, marginTop: 3 },
  unblock: { minWidth: 84, minHeight: 44, paddingHorizontal: 12, borderRadius: 22, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' },
  action: { color: palette.accentText, fontFamily: 'DMSans_700Bold', fontSize: 12 },
  disabled: { opacity: 0.45 },
  refreshError: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  refreshText: { flex: 1, color: palette.accent, fontFamily: 'DMSans_500Medium', fontSize: 12 },
  noMatch: { color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 13, textAlign: 'center', paddingVertical: 24 },
});
