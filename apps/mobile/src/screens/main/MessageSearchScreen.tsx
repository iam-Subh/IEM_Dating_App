import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { api } from '../../services/api';
import { colors } from '../../core/theme/colors';

export const MessageSearchScreen = ({ route }: any) => {
  const navigation = useNavigation<any>();
  const matchId = route.params?.matchId as string | undefined;
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setItems([]);
    setError(null);
    if (query.trim().length < 2) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const path = matchId ? `/chat/${matchId}/search` : '/chat/search';
        const response = await api.get(path, { params: { q: query.trim(), limit: 100 }, signal: controller.signal });
        if (active) setItems(response.data.data);
      } catch {
        if (active) setError('Messages could not load. Check your connection and search again.');
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [matchId, query]);
return <View style={styles.container}><View style={styles.header}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()}><Ionicons name="chevron-back" size={28} color={colors.text.primary} /></TouchableOpacity><Text style={styles.title}>{matchId ? 'Search chat' : 'Search messages'}</Text><View style={{ width: 28 }} /></View><View style={styles.search}><Ionicons accessible={false} name="search" size={19} color={colors.text.tertiary} /><TextInput accessibilityLabel={matchId ? 'Search this chat' : 'Search all messages'} accessibilityHint="Enter at least two characters" maxLength={100} autoFocus value={query} onChangeText={setQuery} placeholder="Enter at least 2 characters" placeholderTextColor={colors.text.tertiary} style={styles.input} /></View><FlatList accessibilityLabel="Message search results" data={items} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} renderItem={({ item }) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Open message sent ${new Date(item.sentAt).toLocaleString()}: ${item.content}`} style={styles.result} onPress={() => navigation.navigate('ChatScreen', { matchId: item.matchId, focusMessageId: item.id })}><Text style={styles.content} numberOfLines={3}>{item.content}</Text><Text style={styles.time}>{new Date(item.sentAt).toLocaleString()}</Text></TouchableOpacity>} ListEmptyComponent={query.trim().length >= 2 ? <Text accessibilityLiveRegion="polite" style={styles.empty}>{loading ? 'Searching messages…' : error ?? 'No messages found.'}</Text> : null} /></View>;
};
const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: colors.background }, header: { paddingTop: 58, paddingHorizontal: 20, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, title: { color: colors.text.primary, fontSize: 20, fontWeight: '700' }, search: { marginHorizontal: 20, height: 46, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.surface }, input: { flex: 1, color: colors.text.primary }, list: { padding: 20, gap: 10 }, result: { padding: 15, borderRadius: 14, backgroundColor: colors.surface }, content: { color: colors.text.primary, fontSize: 15, lineHeight: 21 }, time: { color: colors.text.tertiary, fontSize: 12, marginTop: 8 }, empty: { color: colors.text.tertiary, textAlign: 'center', marginTop: 55 } });
