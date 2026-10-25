import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { RootState } from '../../../store';
import { colors } from '../../../core/theme/colors';
import { BottomSheet } from './BottomSheet';
import { conversationApi } from '../conversationControls';

const DEFAULT_AVATAR = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop';

type Props = {
  visible: boolean;
  onClose: () => void;
  matchId: string;
  messageId: string;
};

/**
 * Who reacted, with an "All" tab and one tab per emoji: Telegram's reacted-users
 * list, opened by long-pressing a reaction or from the message menu.
 */
export function ReactionsSheet({ visible, onClose, matchId, messageId }: Props) {
  const currentUserId = useSelector((state: RootState) => state.auth.user?.id);
  const [filter, setFilter] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['message-reactions', matchId, messageId],
    queryFn: () => conversationApi.reactions(matchId, messageId),
    enabled: visible,
    staleTime: 0,
  });

  useEffect(() => {
    if (visible) setFilter(null);
  }, [visible]);

  const reactors = useMemo(
    () => (data?.reactors ?? []).filter((reactor) => !filter || reactor.emoji === filter),
    [data, filter],
  );

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        <Pressable
          onPress={() => setFilter(null)}
          style={[styles.tab, !filter && styles.tabActive]}
          accessibilityRole="tab"
          accessibilityState={{ selected: !filter }}
        >
          <Ionicons name="heart" size={15} color={!filter ? colors.primary : '#FFFFFF'} />
          <Text style={[styles.tabText, !filter && styles.tabTextActive]}>{data?.total ?? 0}</Text>
        </Pressable>
        {(data?.counts ?? []).map((count) => {
          const active = filter === count.emoji;
          return (
            <Pressable
              key={count.emoji}
              onPress={() => setFilter(count.emoji)}
              style={[styles.tab, active && styles.tabActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={styles.tabEmoji}>{count.emoji}</Text>
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{count.count}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {isLoading ? (
        <ActivityIndicator style={styles.state} color={colors.primary} />
      ) : isError ? (
        <Pressable onPress={() => refetch()} style={styles.state} accessibilityRole="button">
          <Text style={styles.stateText}>Could not load reactions. Tap to retry.</Text>
        </Pressable>
      ) : (
        <FlatList
          data={reactors}
          keyExtractor={(reactor) => reactor.userId}
          style={styles.list}
          ListEmptyComponent={<Text style={[styles.stateText, styles.state]}>No reactions yet</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Image source={{ uri: item.avatar || DEFAULT_AVATAR }} style={styles.avatar} />
              <Text style={styles.name} numberOfLines={1}>{item.userId === currentUserId ? 'You' : item.name}</Text>
              <Text style={styles.emoji}>{item.emoji}</Text>
            </View>
          )}
        />
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  tabs: { paddingHorizontal: 16, gap: 8, paddingBottom: 10 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.07)' },
  tabActive: { backgroundColor: 'rgba(255,90,95,0.16)' },
  tabEmoji: { fontSize: 16 },
  tabText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: colors.primary },
  list: { maxHeight: 360 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, height: 56 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface, marginRight: 14 },
  name: { flex: 1, color: '#FFFFFF', fontSize: 16 },
  emoji: { fontSize: 22, marginLeft: 12 },
  state: { paddingVertical: 28, alignSelf: 'center' },
  stateText: { color: colors.text.secondary, fontSize: 14, textAlign: 'center' },
});
