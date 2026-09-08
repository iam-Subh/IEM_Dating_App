import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../../services/api';
import { colors } from '../../core/theme/colors';

export const FollowRequestsScreen = ({ navigation }: any) => {
  const [requests, setRequests] = useState<any[]>([]);
  const load = useCallback(() => api.get('/stories/follow-requests').then((response) => setRequests(response.data.data)), []);
  useEffect(() => { load(); }, [load]);
  const respond = async (id: string, accept: boolean) => {
    await api.patch(`/stories/follows/${id}`, { accept });
    setRequests((items) => items.filter((item) => item.id !== id));
  };
  return <View style={styles.container}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()}><Text style={styles.back}>Back</Text></Pressable><Text style={styles.title}>Follow requests</Text></View>
    <FlatList accessibilityLabel="Pending follow requests" data={requests} keyExtractor={(item) => item.id} contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>No pending requests.</Text>}
      renderItem={({ item }) => <View style={styles.item}>
        <Image accessible={false} source={{ uri: item.requester?.avatarUrl ?? undefined }} style={styles.avatar} />
        <Text style={styles.name}>{item.requester?.name ?? 'IEM student'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Delete follow request from ${item.requester?.name ?? 'this student'}`} onPress={() => respond(item.id, false)} style={styles.secondary}><Text style={styles.secondaryText}>Delete</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Accept follow request from ${item.requester?.name ?? 'this student'}`} onPress={() => respond(item.id, true)} style={styles.primary}><Text style={styles.primaryText}>Accept</Text></Pressable>
      </View>} />
  </View>;
};
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: 58 }, header: { paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 20 }, back: { color: colors.primary }, title: { color: colors.text.primary, fontSize: 24, fontWeight: '800' }, list: { padding: 20 },
  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 10 }, avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface }, name: { flex: 1, color: colors.text.primary, fontWeight: '600' },
  primary: { backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 }, primaryText: { color: '#fff', fontWeight: '700' }, secondary: { paddingHorizontal: 8, paddingVertical: 8 }, secondaryText: { color: colors.text.secondary }, empty: { color: colors.text.secondary, textAlign: 'center', marginTop: 70 },
});
