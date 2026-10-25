import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { api } from '../../../services/api';
import type { Message } from '../../../store/chatSlice';

type Card = NonNullable<Message['story']>;

const unavailable = (id: string): Card => ({ id, available: false, thumbnailUrl: null, closeFriends: false });

// Signed thumbnails last 15 minutes; a card is refreshed well before that.
const FRESH_MS = 10 * 60_000;
const cache = new Map<string, { card: Card; at: number }>();
const pending = new Map<string, Promise<Card>>();

/** The card for a Story reply that arrived live, one request per Story. */
function fetchCard(storyId: string): Promise<Card> {
  const cached = cache.get(storyId);
  if (cached && Date.now() - cached.at < FRESH_MS) return Promise.resolve(cached.card);
  let request = pending.get(storyId);
  if (!request) {
    request = api.get('/stories/reply-cards', { params: { ids: storyId } })
      .then((response) => {
        const cards = (response.data?.data?.cards ?? []) as Card[];
        const card = cards.find((entry) => entry.id === storyId) ?? unavailable(storyId);
        cache.set(storyId, { card, at: Date.now() });
        return card;
      })
      .finally(() => pending.delete(storyId));
    pending.set(storyId, request);
  }
  return request;
}

/**
 * Above a Story reply: which Story it answers, as Instagram shows it. A small
 * thumbnail with "Replied to your story", a green star on a Close Friends
 * Story, and "Story unavailable" once it has expired or can no longer be seen.
 * Tapping a live Story opens it.
 */
export function StoryReplyCard({ message, isMe }: { message: Message; isMe: boolean }) {
  const navigation = useNavigation<any>();
  const storyId = message.story?.id ?? message.storyId ?? null;
  const [card, setCard] = useState<Card | null>(message.story ?? null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    if (message.story) {
      cache.set(message.story.id, { card: message.story, at: Date.now() });
      setCard(message.story);
      return;
    }
    if (!storyId) return;
    let alive = true;
    fetchCard(storyId).then((next) => { if (alive) setCard(next); }).catch(() => { if (alive) setCard(unavailable(storyId)); });
    return () => { alive = false; };
  }, [message.story, storyId]);

  const label = isMe ? 'You replied to their story' : 'Replied to your story';
  const available = !!card?.available && !!storyId;
  const loading = card === null;

  return (
    <Pressable
      disabled={!available}
      onPress={() => navigation.navigate('StoryViewer', { storyId })}
      accessibilityRole="button"
      accessibilityLabel={available ? `${label}. Open story` : `${label}. ${loading ? 'Loading' : 'Story unavailable'}`}
      style={[styles.wrap, isMe ? styles.alignEnd : styles.alignStart]}
    >
      <Text style={[styles.label, isMe && styles.labelEnd]}>{label}</Text>
      <View style={[styles.row, isMe && styles.rowReverse]}>
        <View style={styles.bar} />
        {available && card?.thumbnailUrl && !imageFailed ? (
          <View>
            <Image source={{ uri: card.thumbnailUrl }} style={styles.thumb} onError={() => setImageFailed(true)} />
            {card.closeFriends ? (
              <View style={styles.star} accessible accessibilityLabel="Close Friends story">
                <Ionicons name="star" size={9} color="#fff" />
              </View>
            ) : null}
          </View>
        ) : (
          <View style={[styles.thumb, styles.placeholder]}>
            <Ionicons name={loading || available ? 'image-outline' : 'time-outline'} size={18} color="#8E8E8E" />
            {!loading && !available ? <Text style={styles.placeholderText}>Story unavailable</Text> : null}
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 6, maxWidth: 220 },
  alignEnd: { alignSelf: 'flex-end' },
  alignStart: { alignSelf: 'flex-start' },
  label: { color: '#A8A8A8', fontSize: 12, marginBottom: 6 },
  labelEnd: { textAlign: 'right' },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  rowReverse: { flexDirection: 'row-reverse' },
  bar: { width: 3, borderRadius: 2, backgroundColor: '#5A5A5E' },
  thumb: { width: 60, height: 100, borderRadius: 10, backgroundColor: '#2A2A2D' },
  placeholder: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, gap: 4 },
  placeholderText: { color: '#8E8E8E', fontSize: 9, textAlign: 'center' },
  star: {
    position: 'absolute', right: 4, bottom: 4, width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#1DBF3A', alignItems: 'center', justifyContent: 'center',
  },
});
