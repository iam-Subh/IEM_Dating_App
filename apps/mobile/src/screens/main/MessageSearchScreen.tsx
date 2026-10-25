import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSelector } from 'react-redux';
import { api } from '../../services/api';
import { colors } from '../../core/theme/colors';
import { RootState } from '../../store';
import { openChatAtMessage } from '../../features/chat/openChatAtMessage';

function HighlightedText({ value, query }: { value: string; query: string }) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = escaped ? value.split(new RegExp(`(${escaped})`, 'ig')) : [value];
  return <Text style={styles.content} numberOfLines={3}>{parts.map((part, index) => part.toLowerCase() === query.toLowerCase() ? <Text key={index} style={styles.highlight}>{part}</Text> : part)}</Text>;
}

export const MessageSearchScreen = ({ route }: any) => {
  const navigation = useNavigation<any>();
  const listRef = useRef<FlatList>(null);
  const currentUserId = useSelector((state: RootState) => state.auth.user?.id);
  const matchId = route.params?.matchId as string | undefined;
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<'all' | 'mine' | 'theirs'>('all');
  const [activeIndex, setActiveIndex] = useState(0);
  const visibleItems = useMemo(() => items.filter((item) => scope === 'all' || (scope === 'mine' ? item.senderId === currentUserId : item.senderId !== currentUserId)), [currentUserId, items, scope]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setItems([]); setError(null); setActiveIndex(0);
    if (query.trim().length < 2) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const path = matchId ? `/chat/${matchId}/search` : '/chat/search';
        const response = await api.get(path, { params: { q: query.trim(), limit: 100 }, signal: controller.signal });
        if (active) setItems(response.data.data);
      } catch { if (active) setError('Messages could not load. Check your connection and search again.'); }
      finally { if (active) setLoading(false); }
    }, 250);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [matchId, query]);

  const move = (delta: number) => {
    if (!visibleItems.length) return;
    const next = (activeIndex + delta + visibleItems.length) % visibleItems.length;
    setActiveIndex(next);
    listRef.current?.scrollToIndex({ index: next, animated: true, viewPosition: 0.45 });
  };

  return <View style={styles.container}>
    <View style={styles.header}><TouchableOpacity accessibilityLabel="Back" onPress={() => navigation.goBack()}><Ionicons name="chevron-back" size={28} color={colors.text.primary} /></TouchableOpacity><Text style={styles.title}>{matchId ? 'Search chat' : 'Search messages'}</Text><View style={{ width: 28 }} /></View>
    <View style={styles.search}><Ionicons name="search" size={19} color={colors.text.tertiary} /><TextInput accessibilityLabel="Search messages" maxLength={100} autoFocus value={query} onChangeText={setQuery} placeholder="Search" placeholderTextColor={colors.text.tertiary} style={styles.input} />{query ? <TouchableOpacity onPress={() => setQuery('')}><Ionicons name="close-circle" size={20} color={colors.text.tertiary} /></TouchableOpacity> : null}</View>
    {matchId && query.trim().length >= 2 ? <View style={styles.tools}>
      {(['all', 'mine', 'theirs'] as const).map((item) => <TouchableOpacity key={item} style={[styles.scope, scope === item && styles.scopeActive]} onPress={() => { setScope(item); setActiveIndex(0); }}><Text style={[styles.scopeText, scope === item && styles.scopeTextActive]}>{item === 'all' ? 'All' : item === 'mine' ? 'Mine' : 'Theirs'}</Text></TouchableOpacity>)}
      <Text style={styles.count}>{visibleItems.length ? `${activeIndex + 1}/${visibleItems.length}` : '0/0'}</Text>
      <TouchableOpacity onPress={() => move(-1)} style={styles.arrow}><Ionicons name="chevron-up" size={20} color="#fff" /></TouchableOpacity><TouchableOpacity onPress={() => move(1)} style={styles.arrow}><Ionicons name="chevron-down" size={20} color="#fff" /></TouchableOpacity>
    </View> : null}
    <FlatList ref={listRef} data={visibleItems} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} onScrollToIndexFailed={({ index }) => setTimeout(() => listRef.current?.scrollToOffset({ offset: index * 92, animated: true }), 50)} renderItem={({ item, index }) => <TouchableOpacity style={[styles.result, activeIndex === index && styles.resultActive]} onPress={() => openChatAtMessage(navigation, { matchId: item.matchId, focusMessageId: item.id })}><HighlightedText value={item.content} query={query.trim()} /><Text style={styles.time}>{new Date(item.sentAt).toLocaleString()}</Text></TouchableOpacity>} ListEmptyComponent={query.trim().length >= 2 ? <Text style={styles.empty}>{loading ? 'Searching…' : error ?? 'No messages found.'}</Text> : null} />
  </View>;
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingTop: 58, paddingHorizontal: 20, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, title: { color: colors.text.primary, fontSize: 20, fontWeight: '700' },
  search: { marginHorizontal: 20, height: 46, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.surface }, input: { flex: 1, color: colors.text.primary },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingTop: 10 }, scope: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 13, backgroundColor: colors.surface }, scopeActive: { backgroundColor: colors.primary }, scopeText: { color: colors.text.secondary, fontSize: 12 }, scopeTextActive: { color: '#fff' }, count: { flex: 1, color: colors.text.tertiary, textAlign: 'right', marginRight: 4 }, arrow: { padding: 5 },
  list: { padding: 20, gap: 10 }, result: { padding: 15, borderRadius: 14, backgroundColor: colors.surface }, resultActive: { borderWidth: 1, borderColor: colors.primary }, content: { color: colors.text.primary, fontSize: 15, lineHeight: 21 }, highlight: { backgroundColor: colors.primary, color: '#fff' }, time: { color: colors.text.tertiary, fontSize: 12, marginTop: 8 }, empty: { color: colors.text.tertiary, textAlign: 'center', marginTop: 55 },
});
