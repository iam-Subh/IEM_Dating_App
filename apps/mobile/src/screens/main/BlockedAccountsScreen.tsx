import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../services/api';
import { colors } from '../../core/theme/colors';

export const BlockedAccountsScreen = () => {
  const navigation = useNavigation();
  const [items, setItems] = useState<any[]>([]);
  const load = useCallback(async () => { const response = await api.get('/block'); setItems(response.data.data); }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const unblock = (item: any) => Alert.alert('Unblock account?', `${item.name} can appear again when discovery rules allow it.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Unblock', onPress: async () => { await api.delete(`/block/${item.userId}`); await load(); } }]);
  return <View style={styles.container}><View style={styles.header}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()}><Ionicons name="chevron-back" size={28} color={colors.text.primary} /></TouchableOpacity><Text style={styles.title}>Blocked accounts</Text><View style={{ width: 28 }} /></View><FlatList accessibilityLabel="Blocked accounts" data={items} keyExtractor={(item) => item.userId} contentContainerStyle={styles.list} renderItem={({ item }) => <View style={styles.row}><Image accessible={false} source={{ uri: item.avatar ?? undefined }} style={styles.avatar} /><Text style={styles.name}>{item.name}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel={`Unblock ${item.name}`} onPress={() => unblock(item)}><Text style={styles.action}>Unblock</Text></TouchableOpacity></View>} ListEmptyComponent={<Text style={styles.empty}>You have no blocked accounts.</Text>} /></View>;
};
const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: colors.background }, header: { paddingTop: 58, paddingHorizontal: 20, paddingBottom: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border }, title: { color: colors.text.primary, fontSize: 20, fontWeight: '700' }, list: { padding: 20, gap: 10 }, row: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14, backgroundColor: colors.surface }, avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.background }, name: { flex: 1, color: colors.text.primary, fontSize: 16, fontWeight: '600', marginLeft: 12 }, action: { color: colors.primary, fontWeight: '700' }, empty: { color: colors.text.tertiary, textAlign: 'center', marginTop: 60 } });
