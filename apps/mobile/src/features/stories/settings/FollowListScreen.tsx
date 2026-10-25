import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { SettingsEmptyState, SettingsPage, SettingsPersonRow, settingsLayout, settingsPalette as palette } from '../../../core/settings/SettingsLayout';
import { STORY_SETTINGS_QUERY_KEY, storyErrorMessage } from './storySettings';

type Row = { followId: string; user: { id: string; name: string; avatarUrl: string | null }; followedAt: string | null };

/**
 * Your followers (with Remove) or the people you follow (with Unfollow).
 * Following decides who sees "Your story", so both lists live with the other
 * Story controls. Nobody is told they were removed.
 */
export function FollowListScreen() {
  const route = useRoute<any>();
  const direction: 'followers' | 'following' = route.params?.direction === 'following' ? 'following' : 'followers';
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const response = await api.get(`/stories/${direction}`);
      setRows(response.data.data as Row[]);
    } catch (error) {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [direction]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const remove = (row: Row) => {
    const isFollower = direction === 'followers';
    Alert.alert(
      isFollower ? 'Remove follower?' : `Unfollow ${row.user.name}?`,
      isFollower
        ? `${row.user.name} won't be told they were removed. They will stop seeing your stories unless you have matched.`
        : "Their stories will leave your tray unless you have matched. They won't be told.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isFollower ? 'Remove' : 'Unfollow',
          style: 'destructive',
          onPress: async () => {
            setRows((current) => current.filter((entry) => entry.followId !== row.followId));
            try {
              await api.delete(`/stories/follows/${row.user.id}`, { params: isFollower ? { direction: 'follower' } : undefined });
              void queryClient.invalidateQueries({ queryKey: STORY_SETTINGS_QUERY_KEY });
              void queryClient.invalidateQueries({ queryKey: ['stories', 'tray'] });
            } catch (error) {
              setRows((current) => [row, ...current]);
              Alert.alert('Could not update', storyErrorMessage(error));
            }
          },
        },
      ],
    );
  };

  return (
    <SettingsPage title={direction === 'followers' ? 'Followers' : 'Following'}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.followId}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[settingsLayout.content, settingsLayout.peopleList, { paddingBottom: insets.bottom + 20 }]}
        ListHeaderComponent={<View style={settingsLayout.listIntro}>
          <Text style={settingsLayout.intro}>{direction === 'followers' ? 'People who follow your stories. You can remove a follower here.' : 'People whose stories you follow. Manage your list here.'}</Text>
          {rows.length > 0 && <Text style={settingsLayout.listHeading}>{rows.length} {rows.length === 1 ? 'person' : 'people'}</Text>}
          {failed && rows.length > 0 && <Pressable onPress={load} accessibilityRole="button"><Text style={styles.retry}>Could not refresh. Tap to retry.</Text></Pressable>}
        </View>}
        ListEmptyComponent={loading
          ? <ActivityIndicator color={palette.accent} style={{ marginTop: 24 }} />
          : <SettingsEmptyState icon={failed ? 'cloud-offline-outline' : 'people-outline'} title={failed ? 'Could not load this list' : direction === 'followers' ? 'No followers yet' : 'Not following anyone'}
            message={failed ? 'Check your connection and try again.' : direction === 'followers' ? 'People who follow your stories will appear here.' : 'People you follow will appear here.'} onRetry={failed ? load : undefined} />}
        renderItem={({ item, index }) => (
          <SettingsPersonRow name={item.user.name} uri={item.user.avatarUrl} note={direction === 'followers' ? 'Follows your stories' : 'Following'} first={index === 0} last={index === rows.length - 1}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${direction === 'followers' ? 'Remove' : 'Unfollow'} ${item.user.name}`}
              onPress={() => remove(item)}
              style={({ pressed }) => [settingsLayout.personAction, settingsLayout.personSecondary, pressed && settingsLayout.pressed]}
            >
              <Text style={[settingsLayout.personActionText, settingsLayout.personSecondaryText]}>{direction === 'followers' ? 'Remove' : 'Unfollow'}</Text>
            </Pressable>
          </SettingsPersonRow>
        )}
      />
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  retry: { color: palette.accent, fontFamily: 'DMSans_500Medium', fontSize: 12 },
});
