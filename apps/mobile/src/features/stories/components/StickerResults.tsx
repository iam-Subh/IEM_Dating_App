import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../../services/api';

const ON_SURFACE = '#E6E0E9';
const ON_SURFACE_VARIANT = '#CAC4D0';
const OUTLINE_VARIANT = '#49454F';

type Person = { id: string; name: string; avatarUrl: string | null } | null;
type ResultItem = { id: string; value?: { option?: number; value?: number }; text?: string; createdAt: string; person: Person };

const LABELS: Record<string, string> = {
  poll: 'Poll', quiz: 'Quiz', slider: 'Emoji slider', question: 'Questions', countdown: 'Countdown', link: 'Link', reveal: 'Reveal', addYours: 'Add Yours',
};
export const STICKERS_WITH_RESULTS = Object.keys(LABELS);
const WITH_RESULTS = new Set(Object.keys(LABELS));

function Avatar({ person }: { person: Person }) {
  return person?.avatarUrl
    ? <Image source={{ uri: person.avatarUrl }} style={styles.avatar} />
    : <View style={[styles.avatar, styles.avatarFallback]}><Ionicons name="person" size={16} color={ON_SURFACE_VARIANT} /></View>;
}

/**
 * Responses to your story's stickers, as Instagram's Activity shows them: who
 * voted for what, quiz answers, slider ratings, question replies (each can be
 * shared as a new story), countdown reminders and link taps.
 */
export function StickerResults({ storyId, onShareReply }: { storyId: string; onShareReply: (prompt: string, text: string) => void }) {
  const [stickers, setStickers] = useState<any[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [items, setItems] = useState<ResultItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    api.get(`/stories/${storyId}/stickers`)
      .then((response) => {
        if (!active) return;
        const list = (response.data.data.stickers ?? []).filter((sticker: any) => WITH_RESULTS.has(sticker.type));
        setStickers(list);
        setActiveId(list[0]?.id ?? null);
      })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [storyId]);

  useEffect(() => {
    let active = true;
    setItems(null);
    if (!activeId) return;
    api.get(`/stories/${storyId}/stickers/${activeId}/results`)
      .then((response) => { if (active) setItems(response.data.data.items ?? []); })
      .catch(() => { if (active) setItems([]); });
    return () => { active = false; };
  }, [activeId, storyId]);

  const sticker = useMemo(() => stickers?.find((entry) => entry.id === activeId) ?? null, [activeId, stickers]);

  if (failed) return <Text style={styles.empty}>Could not load responses.</Text>;
  if (!stickers) return <ActivityIndicator color={ON_SURFACE} style={{ marginTop: 32 }} />;
  if (!stickers.length) return <Text style={styles.empty}>This story has no stickers with responses.</Text>;

  const config = sticker?.config ?? {};

  return (
    <View style={{ flex: 1 }}>
      {stickers.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={{ flexGrow: 0 }}>
          {stickers.map((entry) => (
            <Pressable key={entry.id} onPress={() => setActiveId(entry.id)} style={[styles.chip, entry.id === activeId && styles.chipActive]}>
              <Text style={[styles.chipText, entry.id === activeId && styles.chipTextActive]}>{LABELS[entry.type]}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {config.question || config.prompt || config.title ? (
          <Text style={styles.heading}>{config.question || config.prompt || config.title}</Text>
        ) : null}

        {(sticker?.type === 'poll' || sticker?.type === 'quiz') && Array.isArray(config.options) ? (
          <View style={styles.bars}>
            {config.options.map((option: string, index: number) => {
              const counts: number[] = sticker.results?.counts ?? [];
              const total = sticker.results?.total ?? 0;
              const share = total ? Math.round(((counts[index] ?? 0) / total) * 100) : 0;
              const correct = sticker.type === 'quiz' && config.correctIndex === index;
              return (
                <View key={`${index}-${option}`} style={styles.bar}>
                  <View style={[styles.barFill, { width: `${share}%` }, correct && { backgroundColor: 'rgba(112,192,80,0.45)' }]} />
                  <Text style={styles.barText} numberOfLines={1}>{correct ? '✓ ' : ''}{option}</Text>
                  <Text style={styles.barCount}>{counts[index] ?? 0} · {share}%</Text>
                </View>
              );
            })}
          </View>
        ) : null}

        {sticker?.type === 'slider' && sticker.results?.average != null ? (
          <Text style={styles.average}>{config.emoji} Average {Math.round(sticker.results.average * 100)}% · {sticker.results.total} {sticker.results.total === 1 ? 'rating' : 'ratings'}</Text>
        ) : null}

        {items === null ? <ActivityIndicator color={ON_SURFACE} style={{ marginTop: 20 }} /> : null}
        {items && !items.length ? <Text style={styles.empty}>No responses yet.</Text> : null}

        {items?.map((item) => {
          if (sticker?.type === 'question') {
            return (
              <View key={item.id} style={styles.reply}>
                <View style={styles.replyHeader}>
                  <Avatar person={item.person} />
                  <Text style={styles.name} numberOfLines={1}>{item.person?.name ?? 'Someone'}</Text>
                  <Pressable onPress={() => onShareReply(String(config.prompt ?? ''), String(item.text ?? ''))} style={styles.share} accessibilityRole="button" accessibilityLabel="Share reply to your story">
                    <Text style={styles.shareText}>Share</Text>
                  </Pressable>
                </View>
                <Text style={styles.replyText}>{item.text}</Text>
              </View>
            );
          }
          let detail = '';
          if (sticker?.type === 'poll' || sticker?.type === 'quiz') {
            const option = item.value?.option ?? -1;
            detail = config.options?.[option] ?? '';
            if (sticker.type === 'quiz') detail = `${option === config.correctIndex ? '✓' : '✗'} ${detail}`;
          } else if (sticker?.type === 'slider') {
            detail = `${config.emoji ?? ''} ${Math.round((item.value?.value ?? 0) * 100)}%`;
          } else if (sticker?.type === 'countdown') {
            detail = 'Reminder set';
          } else if (sticker?.type === 'link') {
            detail = 'Tapped the link';
          } else if (sticker?.type === 'reveal') {
            detail = 'Messaged you';
          } else if (sticker?.type === 'addYours') {
            detail = 'Joined';
          }
          return (
            <View key={item.id} style={styles.row}>
              <Avatar person={item.person} />
              <Text style={styles.name} numberOfLines={1}>{item.person?.name ?? 'Someone'}</Text>
              <Text style={styles.detail} numberOfLines={1}>{detail}</Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { paddingHorizontal: 20, paddingVertical: 10, gap: 8 },
  chip: { paddingHorizontal: 14, height: 32, borderRadius: 8, borderWidth: 1, borderColor: OUTLINE_VARIANT, justifyContent: 'center' },
  chipActive: { backgroundColor: '#4A4458', borderColor: '#4A4458' },
  chipText: { color: ON_SURFACE_VARIANT, fontSize: 14, fontWeight: '500' },
  chipTextActive: { color: ON_SURFACE },
  content: { paddingHorizontal: 24, paddingBottom: 120 },
  heading: { color: ON_SURFACE, fontSize: 16, fontWeight: '600', marginTop: 8, marginBottom: 12 },
  bars: { gap: 8, marginBottom: 16 },
  average: { color: ON_SURFACE, fontSize: 15, marginBottom: 12 },
  bar: { height: 44, borderRadius: 10, backgroundColor: '#2B2930', overflow: 'hidden', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  barFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(208,188,255,0.28)' },
  barText: { flex: 1, color: ON_SURFACE, fontSize: 15 },
  barCount: { color: ON_SURFACE_VARIANT, fontSize: 13 },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#36343B' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  name: { flex: 1, color: ON_SURFACE, fontSize: 15 },
  detail: { color: ON_SURFACE_VARIANT, fontSize: 14, maxWidth: '45%' },
  reply: { backgroundColor: '#2B2930', borderRadius: 14, padding: 14, marginBottom: 10, gap: 10 },
  replyHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  replyText: { color: ON_SURFACE, fontSize: 16, lineHeight: 22 },
  share: { paddingHorizontal: 14, height: 32, borderRadius: 16, backgroundColor: '#D0BCFF', justifyContent: 'center' },
  shareText: { color: '#381E72', fontWeight: '600' },
  empty: { color: ON_SURFACE_VARIANT, textAlign: 'center', marginTop: 32, fontSize: 14 },
});
