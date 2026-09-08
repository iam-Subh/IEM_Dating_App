import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Image, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { api } from '../../services/api';
import { colors } from '../../core/theme/colors';

export const MatchesScreen = () => {
  const navigation = useNavigation<any>();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { const response = await api.get('/matches/pending'); setItems(response.data.data); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  return <View style={styles.container}>
    <Text style={styles.title}>Matches</Text>
    <Text style={styles.subtitle}>People who matched with you</Text>
    {loading && !items.length ? <ActivityIndicator accessibilityLabel="Loading matches" color={colors.primary} /> : <FlatList accessibilityLabel="Your matches" data={items} keyExtractor={(item) => item.matchId} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />} contentContainerStyle={styles.list} renderItem={({ item }) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Open chat with ${item.user.name}`} style={styles.card} onPress={() => navigation.navigate('ChatScreen', { matchId: item.matchId, userId: item.user.id, userName: item.user.name, userAvatar: item.user.avatar })}><Image accessible={false} source={{ uri: item.user.avatar ?? undefined }} style={styles.avatar} /><View style={styles.copy}><Text style={styles.name}>{item.user.name}{item.user.age ? `, ${item.user.age}` : ''}</Text><Text style={styles.meta}>{item.user.department ?? 'IEM student'}</Text><Text style={styles.message}>{item.lastMessage?.content ?? 'Start a conversation'}</Text></View></TouchableOpacity>} ListEmptyComponent={<Text style={styles.empty}>Your matches will appear here.</Text>} />}
  </View>;
};

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: colors.background, paddingTop: 58 }, title: { color: colors.text.primary, fontSize: 30, fontWeight: '800', paddingHorizontal: 22 }, subtitle: { color: colors.text.tertiary, paddingHorizontal: 22, marginTop: 5 }, list: { padding: 18, paddingBottom: 120, gap: 12 }, card: { flexDirection: 'row', padding: 14, backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border }, avatar: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.background }, copy: { flex: 1, marginLeft: 14, justifyContent: 'center' }, name: { color: colors.text.primary, fontSize: 17, fontWeight: '700' }, meta: { color: colors.text.secondary, marginTop: 3 }, message: { color: colors.text.tertiary, marginTop: 7 }, empty: { color: colors.text.tertiary, textAlign: 'center', marginTop: 80 } });
