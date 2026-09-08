import React, { useCallback, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../services/api';
import { colors } from '../../core/theme/colors';

export const ActiveSessionsScreen = () => {
  const navigation = useNavigation();
  const [items, setItems] = useState<any[]>([]);
  const load = useCallback(async () => { const response = await api.get('/auth/sessions'); setItems(response.data.data); }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const revoke = (item: any) => Alert.alert('Sign out this device?', 'This session will lose access.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: async () => { await api.delete(`/auth/sessions/${item.id}`); await load(); } }]);
  return <View style={styles.container}><View style={styles.header}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()}><Ionicons name="chevron-back" size={28} color={colors.text.primary} /></TouchableOpacity><Text style={styles.title}>Active sessions</Text><View style={{ width: 28 }} /></View><FlatList accessibilityLabel="Active sessions" data={items} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} renderItem={({ item }) => <View style={styles.row}><View style={styles.copy}><Text style={styles.name}>{item.current ? 'This device' : 'Signed-in device'}</Text><Text style={styles.meta}>{item.deviceInfo?.platform ?? item.deviceInfo?.userAgent ?? 'Device details unavailable'}</Text><Text style={styles.meta}>Last used {new Date(item.lastUsedAt ?? item.createdAt).toLocaleString()}</Text></View>{!item.current && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Sign out this device" onPress={() => revoke(item)}><Text style={styles.remove}>Sign out</Text></TouchableOpacity>}</View>} ListEmptyComponent={<Text style={styles.empty}>No active sessions.</Text>} /></View>;
};
const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: colors.background }, header: { paddingTop: 58, paddingHorizontal: 20, paddingBottom: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border }, title: { color: colors.text.primary, fontSize: 20, fontWeight: '700' }, list: { padding: 20, gap: 12 }, row: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 14, backgroundColor: colors.surface }, copy: { flex: 1 }, name: { color: colors.text.primary, fontWeight: '700', fontSize: 16 }, meta: { color: colors.text.tertiary, marginTop: 5 }, remove: { color: colors.error, fontWeight: '700' }, empty: { color: colors.text.tertiary, textAlign: 'center', marginTop: 60 } });
