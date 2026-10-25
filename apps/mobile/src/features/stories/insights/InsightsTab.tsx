import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { storyInsightsApi, type StoryInsights } from '../settings/storySettings';

const ON_SURFACE = '#E6E0E9';
const ON_SURFACE_VARIANT = '#CAC4D0';

function Row({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function Group({ title, total, children }: { title: string; total?: number; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <View style={styles.groupHeader}>
        <Text style={styles.groupTitle}>{title}</Text>
        {total !== undefined ? <Text style={styles.groupTotal}>{total}</Text> : null}
      </View>
      {children}
    </View>
  );
}

/**
 * The Activity sheet's Insights tab (STORY_ARCHIVE_SPEC.md, section 7.8):
 * plain numbers, grouped the way Instagram's own Insights are. Refreshes
 * while it stays open, since a live Story's numbers keep moving.
 */
export function InsightsTab({ storyId }: { storyId: string }) {
  const [data, setData] = useState<StoryInsights | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const load = () => storyInsightsApi.get(storyId)
      .then((result) => { if (active) { setData(result); setFailed(false); } })
      .catch(() => { if (active) setFailed(true); });
    void load();
    const timer = setInterval(load, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, [storyId]);

  if (!data) {
    return (
      <View style={styles.center}>
        {failed ? <Text style={styles.empty}>Could not load Insights.</Text> : <ActivityIndicator color={ON_SURFACE} />}
      </View>
    );
  }

  const navigationTotal = data.forwardTaps + data.backTaps + data.nextStory + data.exits;
  const interactionsTotal = data.replies + data.reactions + data.likes + data.stickerTaps + data.profileVisits;

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Group title="Overview">
        <Row label="Accounts reached" value={data.reach} />
        <Row label="Views" value={data.views} />
      </Group>
      <Group title="Navigation" total={navigationTotal}>
        <Row label="Forward" value={data.forwardTaps} />
        <Row label="Back" value={data.backTaps} />
        <Row label="Next story" value={data.nextStory} />
        <Row label="Exited" value={data.exits} />
      </Group>
      <Group title="Interactions" total={interactionsTotal}>
        <Row label="Replies" value={data.replies} />
        <Row label="Reactions" value={data.reactions} />
        <Row label="Likes" value={data.likes} />
        <Row label="Sticker taps" value={data.stickerTaps} />
        <Row label="Profile visits" value={data.profileVisits} />
      </Group>
      <Text style={styles.footnote}>
        {data.closed ? 'Viewer list is available for 48 hours.' : 'Numbers update as people watch.'}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 32 },
  center: { paddingVertical: 60, alignItems: 'center' },
  empty: { color: ON_SURFACE_VARIANT, fontSize: 14 },
  group: { marginBottom: 22 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  groupTitle: { color: ON_SURFACE_VARIANT, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  groupTotal: { color: ON_SURFACE_VARIANT, fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  label: { color: ON_SURFACE, fontSize: 15 },
  value: { color: ON_SURFACE, fontSize: 15, fontWeight: '600' },
  footnote: { color: ON_SURFACE_VARIANT, fontSize: 12, textAlign: 'center', marginTop: 8 },
});
