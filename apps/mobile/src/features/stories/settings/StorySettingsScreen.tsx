import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheet } from '../../chat/components/BottomSheet';
import { SettingsCard, SettingsEmptyState, SettingsPage, SettingsToggle, settingsLayout, settingsPalette as palette } from '../../../core/settings/SettingsLayout';
import {
  MENTION_LABELS, REPLY_LABELS, storyErrorMessage, useStorySettings, useUpdateStorySettings,
  type StoryMentions, type StoryReplies, type StorySettingsChange,
} from './storySettings';

type Option<T extends string> = { value: T; label: string; hint: string };

const REPLY_OPTIONS: Option<StoryReplies>[] = [
  { value: 'matches', label: REPLY_LABELS.matches, hint: 'People you have matched with can reply and react.' },
  { value: 'close_friends', label: REPLY_LABELS.close_friends, hint: 'Only matches on your Close Friends list can reply and react.' },
  { value: 'off', label: REPLY_LABELS.off, hint: 'Nobody can reply or react. Likes still work.' },
];

const MENTION_OPTIONS: Option<StoryMentions>[] = [
  { value: 'everyone', label: MENTION_LABELS.everyone, hint: 'Anyone who can see a story may mention you in it.' },
  { value: 'following', label: MENTION_LABELS.following, hint: 'Only people you follow may mention you.' },
  { value: 'off', label: MENTION_LABELS.off, hint: 'Nobody can mention you in a story.' },
];

function OptionSheet<T extends string>({ visible, title, options, value, onPick, onClose }: {
  visible: boolean; title: string; options: Option<T>[]; value: T; onPick: (value: T) => void; onClose: () => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle} accessibilityRole="header">{title}</Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close options"
          style={({ pressed }) => [styles.sheetClose, pressed && settingsLayout.pressed]}>
          <Ionicons name="close" size={19} color="#FFFFFF" />
        </Pressable>
      </View>
      <ScrollView style={styles.sheetChoices} contentContainerStyle={styles.sheetChoicesContent}
        showsVerticalScrollIndicator={false} bounces={false} accessibilityRole="radiogroup">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => onPick(option.value)}
              style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && settingsLayout.pressed]}
            >
              <View style={styles.rowBody}>
                <Text style={styles.optionLabel}>{option.label}</Text>
                <Text style={styles.optionHint}>{option.hint}</Text>
              </View>
              <View style={[styles.radio, selected && styles.radioOn]}>{selected && <Ionicons name="checkmark" size={15} color={palette.accentText} />}</View>
            </Pressable>
          );
        })}
      </ScrollView>
    </BottomSheet>
  );
}

function Row({ icon, label, value, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value?: string | number; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={value !== undefined ? `${label}, ${value}` : label} onPress={onPress}
      style={({ pressed }) => [styles.row, styles.rowTouch, pressed && styles.rowPressed]}>
      <Ionicons name={icon} size={20} color={palette.icon} />
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
        {typeof value === 'string' && <Text style={styles.rowValue}>{value}</Text>}
      </View>
      {typeof value === 'number' && <View style={styles.countBadge}><Text style={styles.countText}>{value}</Text></View>}
      <Ionicons name="chevron-forward" size={17} color={palette.muted} />
    </Pressable>
  );
}

function SwitchRow({ icon, label, hint, value, onChange }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; hint?: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={20} color={palette.icon} />
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <SettingsToggle label={label} hint={hint} value={value} onChange={onChange} />
    </View>
  );
}

/**
 * Every Story control in one place: who sees your stories, who can reply and
 * mention you, resharing, followers, and screenshot blocking. The custom
 * bottom navbar is not touched; this is a stack screen.
 */
export function StorySettingsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { data: settings, refetch, isLoading, isError } = useStorySettings();
  const update = useUpdateStorySettings();
  const [sheet, setSheet] = useState<'replies' | 'mentions' | null>(null);

  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));

  const save = (change: StorySettingsChange) => {
    update(change).catch((error) => Alert.alert('Could not save', storyErrorMessage(error)));
  };

  const toggleStories = (enabled: boolean) => {
    if (enabled) {
      save({ storiesEnabled: true });
      return;
    }
    Alert.alert('Turn off Stories?', 'Your live stories will be deleted, and nobody will be able to see or follow your stories until you turn this back on.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Turn off', style: 'destructive', onPress: () => save({ storiesEnabled: false }) },
    ]);
  };

  const counts = settings?.counts;

  return (
    <SettingsPage title="Story">
      {!settings ? (
        <View style={styles.center}>
          {isLoading ? <ActivityIndicator color={palette.accent} /> : null}
          {isError ? (
            <SettingsEmptyState icon="cloud-offline-outline" title="Could not load settings"
              message="Check your connection and try again." onRetry={() => void refetch()} />
          ) : null}
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}
          contentContainerStyle={[settingsLayout.content, { paddingBottom: insets.bottom + 20 }]}>
          <Text style={settingsLayout.intro}>Choose who sees your stories and how they interact.</Text>
          <SettingsCard title="Stories and privacy" icon="aperture-outline">
            <SwitchRow icon="aperture-outline" label="Stories" hint="Share stories with your followers and matches." value={settings.storiesEnabled} onChange={toggleStories} />
            <SwitchRow icon="shield-checkmark-outline" label="Block screenshots"
              hint="Blocks screenshots and recording on your phone while you watch stories. Other people control their own phones."
              value={settings.screenshotBlock} onChange={(value) => save({ screenshotBlock: value })} />
          </SettingsCard>

          <SettingsCard title="Audience" icon="eye-outline">
          <Row icon="star-outline" label="Close Friends" value={counts?.closeFriends ?? 0} onPress={() => navigation.navigate('StoryAudienceList', { list: 'close_friends' })} />
          <Row icon="eye-off-outline" label="Hide story from" value={counts?.hidden ?? 0} onPress={() => navigation.navigate('StoryAudienceList', { list: 'hidden' })} />
          <Row icon="volume-mute-outline" label="Muted accounts" value={counts?.muted ?? 0} onPress={() => navigation.navigate('StoryMutedAccounts')} />
          </SettingsCard>

          <SettingsCard title="Replies and sharing" icon="chatbubbles-outline">
          <Row icon="chatbubble-outline" label="Replies and reactions" value={REPLY_LABELS[settings.replies]} onPress={() => setSheet('replies')} />

          <Row icon="at-outline" label="Allow mentions from" value={MENTION_LABELS[settings.mentions]} onPress={() => setSheet('mentions')} />
          <SwitchRow
            icon="repeat-outline"
            label="Allow resharing to stories"
            hint="People you mention can add your story to theirs. Close Friends stories are never reshared."
            value={settings.resharing}
            onChange={(value) => save({ resharing: value })}
          />
          </SettingsCard>

          <SettingsCard title="Followers" icon="people-outline">
          <Row icon="people-outline" label="Followers" value={counts?.followers ?? 0} onPress={() => navigation.navigate('StoryFollowList', { direction: 'followers' })} />
          <Row icon="person-add-outline" label="Following" value={counts?.following ?? 0} onPress={() => navigation.navigate('StoryFollowList', { direction: 'following' })} />
          <Row icon="mail-unread-outline" label="Follow requests" value={counts?.followRequests ?? 0} onPress={() => navigation.navigate('FollowRequests')} />
          <SwitchRow icon="hand-left-outline" label="Allow follow requests" value={settings.allowFollowRequests} onChange={(value) => save({ allowFollowRequests: value })} />
          <SwitchRow
            icon="stats-chart-outline"
            label="Show follower counts"
            hint="People at your college see your followers and following numbers on your profile in Search. Never the lists."
            value={settings.showFollowerCount !== false}
            onChange={(value) => save({ showFollowerCount: value })}
          />
          </SettingsCard>

          <SettingsCard title="Archive and gallery" icon="archive-outline">
          <Row icon="archive-outline" label="Archive" onPress={() => navigation.navigate('StoryArchive')} />
          <SwitchRow
            icon="save-outline"
            label="Save story to archive"
            hint="Keep your stories privately after they end. Only you can see your archive."
            value={settings.archive}
            onChange={(value) => save({ archive: value })}
          />
          <SwitchRow
            icon="images-outline"
            label="Save story to gallery"
            hint="Save every story to your phone the moment you share it."
            value={settings.saveToGallery}
            onChange={(value) => save({ saveToGallery: value })}
          />
          </SettingsCard>
        </ScrollView>
      )}

      {settings ? <>
        <OptionSheet
          visible={sheet === 'replies'}
          title="Replies and reactions"
          options={REPLY_OPTIONS}
          value={settings.replies}
          onClose={() => setSheet(null)}
          onPick={(value) => { setSheet(null); save({ replies: value }); }}
        />
        <OptionSheet
          visible={sheet === 'mentions'}
          title="Allow mentions from"
          options={MENTION_OPTIONS}
          value={settings.mentions}
          onClose={() => setSheet(null)}
          onPick={(value) => { setSheet(null); save({ mentions: value }); }}
        />
      </> : null}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, borderRadius: 10 },
  rowTouch: { marginHorizontal: -14, paddingHorizontal: 14, borderRadius: 0 },
  rowPressed: { backgroundColor: '#2D2B2D' },
  rowBody: { flex: 1, minWidth: 0 },
  rowLabel: { color: palette.text, fontFamily: 'DMSans_500Medium', fontSize: 14 },
  rowValue: { color: palette.accent, fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 17, marginTop: 3 },
  rowHint: { color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 11, marginTop: 3, lineHeight: 16 },
  countBadge: { minWidth: 27, minHeight: 25, paddingHorizontal: 8, borderRadius: 13, backgroundColor: '#383136', alignItems: 'center', justifyContent: 'center' },
  countText: { color: palette.accent, fontFamily: 'DMSans_700Bold', fontSize: 12 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 10 },
  sheetTitle: { flex: 1, minWidth: 0, color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 18 },
  sheetClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#302D31', alignItems: 'center', justifyContent: 'center' },
  sheetChoices: { flexGrow: 0, flexShrink: 1 },
  sheetChoicesContent: { paddingHorizontal: 12, gap: 6 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16 },
  optionSelected: { backgroundColor: '#382A30' },
  optionLabel: { color: palette.text, fontFamily: 'DMSans_700Bold', fontSize: 14 },
  optionHint: { color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 17, marginTop: 4 },
  radio: { width: 23, height: 23, borderRadius: 12, borderWidth: 1.5, borderColor: palette.muted, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: palette.accent, backgroundColor: palette.accent },
});
