import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { SettingsEmptyState, SettingsPage, SettingsPersonRow, settingsLayout, settingsPalette as palette } from '../../../core/settings/SettingsLayout';
import { STORY_SETTINGS_QUERY_KEY, storyAudienceApi, storyErrorMessage, type AudiencePerson } from './storySettings';

/** People whose stories you muted. They are not told, and they still see yours. */
export function MutedAccountsScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [people, setPeople] = useState<AudiencePerson[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (next: string | null) => {
    setLoading(true);
    setFailed(false);
    try {
      const page = await storyAudienceApi.muted(next);
      setPeople((current) => (next ? [...current, ...page.people] : page.people));
      setCursor(page.nextCursor);
    } catch (error) {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(null); }, [load]));

  const unmute = async (person: AudiencePerson) => {
    setPeople((current) => current.filter((entry) => entry.id !== person.id));
    try {
      await storyAudienceApi.setMuted(person.id, false);
      void queryClient.invalidateQueries({ queryKey: STORY_SETTINGS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['stories', 'tray'] });
    } catch (error) {
      setPeople((current) => [person, ...current]);
      Alert.alert('Could not unmute', storyErrorMessage(error));
    }
  };

  return (
    <SettingsPage title="Muted accounts">
      <FlatList
        data={people}
        keyExtractor={(item) => item.id}
        onEndReached={() => { if (cursor && !loading) void load(cursor); }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[settingsLayout.content, settingsLayout.peopleList, { paddingBottom: insets.bottom + 20 }]}
        ListHeaderComponent={<View style={settingsLayout.listIntro}>
          <Text style={settingsLayout.intro}>Their stories stay out of your tray. They are not told, and they can still see your stories.</Text>
          {people.length > 0 && <Text style={settingsLayout.listHeading}>Stories you muted</Text>}
          {failed && people.length > 0 && <Pressable onPress={() => void load(null)} accessibilityRole="button"><Text style={styles.retry}>Could not refresh. Tap to retry.</Text></Pressable>}
        </View>}
        ListEmptyComponent={loading ? <ActivityIndicator color={palette.accent} style={{ marginTop: 24 }} />
          : <SettingsEmptyState icon={failed ? 'cloud-offline-outline' : 'volume-mute-outline'} title={failed ? 'Could not load accounts' : 'No muted accounts'}
            message={failed ? 'Check your connection and try again.' : 'Accounts whose stories you mute will appear here.'} onRetry={failed ? () => void load(null) : undefined} />}
        ListFooterComponent={loading && people.length > 0 ? <ActivityIndicator color={palette.accent} style={{ marginTop: 16 }} /> : null}
        renderItem={({ item, index }) => (
          <SettingsPersonRow name={item.name} uri={item.avatarUrl} note="Stories muted" first={index === 0} last={index === people.length - 1}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Unmute ${item.name}`} onPress={() => void unmute(item)}
              style={({ pressed }) => [settingsLayout.personAction, pressed && settingsLayout.pressed]}>
              <Text style={settingsLayout.personActionText}>Unmute</Text>
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
