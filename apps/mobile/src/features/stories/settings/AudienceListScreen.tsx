import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { SettingsEmptyState, SettingsPage, SettingsPersonRow, settingsLayout, settingsPalette as palette } from '../../../core/settings/SettingsLayout';
import {
  CLOSE_FRIENDS_GREEN, STORY_SETTINGS_QUERY_KEY, storyAudienceApi, storyErrorMessage, useStorySettings,
  type AudienceList, type AudiencePerson, type StorySettings,
} from './storySettings';

const COPY: Record<AudienceList, { title: string; explanation: string; empty: string; accent: string }> = {
  close_friends: {
    title: 'Close Friends',
    explanation: "Only people on your list can see stories you share to Close Friends. Nobody is notified when you change your list.",
    empty: 'Nobody here yet. Follow people or match to add them.',
    accent: CLOSE_FRIENDS_GREEN,
  },
  hidden: {
    title: 'Hide story from',
    explanation: "People you choose won't see your stories, including Close Friends stories. They won't be notified.",
    empty: 'Nobody to choose yet. Your followers and matches appear here.',
    accent: palette.accent,
  },
};

/**
 * One editor for Close Friends and Hide story from: search your followers and
 * matches, and tap to add or remove. Each tap saves at once and rolls back if
 * the server refuses. People already on the list come first.
 */
export function AudienceListScreen() {
  const route = useRoute<any>();
  const list: AudienceList = route.params?.list === 'hidden' ? 'hidden' : 'close_friends';
  const copy = COPY[list];
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<AudiencePerson[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const changing = useRef(new Set<string>());
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());

  // The count under the title comes from the settings summary, adjusted at once on each tap.
  const { data: settings } = useStorySettings();
  const countKey = list === 'close_friends' ? 'closeFriends' : 'hidden';
  const onListCount = settings?.counts?.[countKey] ?? 0;
  const setCount = (change: (count: number) => number) => {
    queryClient.setQueryData<StorySettings>(STORY_SETTINGS_QUERY_KEY, (current) => (current?.counts
      ? { ...current, counts: { ...current.counts, [countKey]: Math.max(0, change(current.counts[countKey])) } }
      : current));
  };

  const load = useCallback(async (q: string, next: string | null) => {
    const id = ++request.current;
    if (!next) setLoading(true);
    try {
      const page = await storyAudienceApi.people(list, q, next);
      if (id !== request.current) return;
      setPeople((current) => (next ? [...current, ...page.people.filter((person) => !current.some((entry) => entry.id === person.id))] : page.people));
      setCursor(page.nextCursor);
      setFailed(false);
    } catch {
      if (id === request.current) setFailed(true);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [list]);

  // Search as you type, after a short pause.
  useEffect(() => {
    const timer = setTimeout(() => void load(query.trim(), null), query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  const toggle = async (person: AudiencePerson) => {
    if (changing.current.has(person.id)) return;
    changing.current.add(person.id);
    setBusyIds(new Set(changing.current));
    const adding = !person.onList;
    const apply = (value: boolean) => {
      setPeople((current) => current.map((entry) => (entry.id === person.id ? { ...entry, onList: value } : entry)));
      setCount((count) => count + (value ? 1 : -1));
    };
    apply(adding);
    try {
      if (adding) await storyAudienceApi.add(list, person.id);
      else await storyAudienceApi.remove(list, person.id);
      void queryClient.invalidateQueries({ queryKey: STORY_SETTINGS_QUERY_KEY });
      // A change here changes who sees which stories.
      void queryClient.invalidateQueries({ queryKey: ['stories', 'tray'] });
    } catch (error) {
      apply(!adding);
      Alert.alert(adding ? 'Could not add' : 'Could not remove', storyErrorMessage(error));
    } finally {
      changing.current.delete(person.id);
      setBusyIds(new Set(changing.current));
    }
  };

  const clear = () => {
    Alert.alert('Clear your Close Friends list?', 'Nobody will be able to see your Close Friends stories until you add people again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear list',
        style: 'destructive',
        onPress: async () => {
          try {
            await storyAudienceApi.clearCloseFriends();
            setPeople((current) => current.map((entry) => ({ ...entry, onList: false })));
            setCount(() => 0);
            void queryClient.invalidateQueries({ queryKey: STORY_SETTINGS_QUERY_KEY });
            void queryClient.invalidateQueries({ queryKey: ['stories', 'tray'] });
          } catch (error) {
            Alert.alert('Could not clear the list', storyErrorMessage(error));
          }
        },
      },
    ]);
  };

  const subtitle = (person: AudiencePerson) => {
    if (person.onList && !person.inAudience) return 'Not following you';
    if (person.isMatch) return 'Match';
    return null;
  };

  return (
    <SettingsPage title={copy.title}>
      <FlatList
        data={people}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (cursor && !loading) void load(query.trim(), cursor); }}
        contentContainerStyle={[settingsLayout.content, settingsLayout.peopleList, { paddingBottom: insets.bottom + 20 }]}
        ListHeaderComponent={(
          <View style={settingsLayout.listIntro}>
            <Text style={settingsLayout.intro}>{copy.explanation}</Text>
            <View style={settingsLayout.search}>
              <Ionicons name="search" size={17} color={palette.secondary} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search people"
                accessibilityLabel={`Search ${copy.title.toLowerCase()}`}
                placeholderTextColor={palette.secondary}
                selectionColor={palette.accent}
                style={settingsLayout.searchInput}
                autoCorrect={false}
                returnKeyType="search"
              />
              {query.length > 0 && <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={palette.secondary} />
              </Pressable>}
            </View>
            <Text style={settingsLayout.listHeading}>{onListCount} {onListCount === 1 ? 'person selected' : 'people selected'}</Text>
            {loading && !people.length ? <ActivityIndicator color={copy.accent} style={{ marginTop: 12 }} /> : null}
            {failed ? (
              <Pressable accessibilityRole="button" onPress={() => void load(query.trim(), null)}>
                <Text style={styles.empty}>Could not load. Tap to try again.</Text>
              </Pressable>
            ) : null}
          </View>
        )}
        ListEmptyComponent={!loading && !failed ? <SettingsEmptyState icon={query ? 'search-outline' : list === 'close_friends' ? 'star-outline' : 'eye-off-outline'}
          title={query ? 'No one found' : 'No people to select'} message={query ? 'Try another name.' : copy.empty} /> : null}
        ListFooterComponent={list === 'close_friends' && onListCount > 0 && !query ? (
          <Pressable accessibilityRole="button" onPress={clear} style={styles.clear}>
            <Ionicons name="trash-outline" size={17} color={palette.danger} /><Text style={styles.clearText}>Clear list</Text>
          </Pressable>
        ) : null}
        renderItem={({ item, index }) => {
          const note = subtitle(item);
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !!item.onList, disabled: busyIds.has(item.id) }}
              accessibilityLabel={item.name}
              onPress={() => void toggle(item)}
              disabled={busyIds.has(item.id)}
              style={({ pressed }) => pressed && settingsLayout.pressed}
            >
              <SettingsPersonRow name={item.name} uri={item.avatarUrl} note={note} inactive={!!item.onList && !item.inAudience} first={index === 0} last={index === people.length - 1}>
              <View style={[styles.tick, item.onList && { backgroundColor: copy.accent, borderColor: copy.accent }]}>
                {item.onList ? <Ionicons name="checkmark" size={16} color={list === 'hidden' ? palette.accentText : '#FFFFFF'} /> : null}
              </View>
              </SettingsPersonRow>
            </Pressable>
          );
        }}
      />
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  tick: { width: 25, height: 25, borderRadius: 13, borderWidth: 1.5, borderColor: palette.muted, alignItems: 'center', justifyContent: 'center' },
  empty: { color: palette.danger, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 14 },
  clear: { minHeight: 44, borderRadius: 14, backgroundColor: palette.dangerSurface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14 },
  clearText: { color: palette.danger, fontFamily: 'DMSans_700Bold', fontSize: 13 },
});
