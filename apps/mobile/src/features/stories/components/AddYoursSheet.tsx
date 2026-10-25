import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../../services/api';
import type { InteractiveSticker } from '../create/composition/types';
import type { StoryOwner, TrayGroup } from '../storyTypes';

type AddYoursSticker = Extract<InteractiveSticker, { type: 'addYours' }>;
type Thread = { thread: { id: string; prompt: string; music: boolean; count: number; creator: StoryOwner | null }; groups: TrayGroup[] };

/**
 * An Add Yours thread, opened from its sticker: the prompt, how many joined,
 * the stories you may watch, and "Add yours" to join with your own story.
 */
export function AddYoursSheet({ sticker, onClose, onJoin, onWatch }: {
  sticker: AddYoursSticker | null;
  onClose: () => void;
  onJoin: (sticker: AddYoursSticker) => void;
  onWatch: (groups: TrayGroup[], index: number) => void;
}) {
  const [data, setData] = useState<Thread | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setData(null);
    setFailed(false);
    if (!sticker?.threadId) return;
    let active = true;
    api.get(`/stories/add-yours/${sticker.threadId}`)
      .then((response) => { if (active) setData(response.data.data); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [sticker?.threadId]);

  const music = data?.thread.music ?? sticker?.music ?? false;

  return (
    <Modal visible={sticker !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.grabber} />
          <View style={styles.badge}>
            <Ionicons name={music ? 'musical-notes' : 'camera'} size={16} color="#fff" />
            <Text style={styles.badgeText}>{music ? 'Add Yours Music' : 'Add Yours'}</Text>
          </View>
          <Text style={styles.prompt}>{data?.thread.prompt ?? sticker?.prompt}</Text>
          {data ? (
            <Text style={styles.meta}>
              {data.thread.count} {data.thread.count === 1 ? 'participant' : 'participants'}
              {data.thread.creator ? ` · started by ${data.thread.creator.name}` : ''}
            </Text>
          ) : null}
          {!sticker?.threadId ? <Text style={styles.meta}>This prompt is still being posted.</Text> : null}
          {sticker?.threadId && !data && !failed ? <ActivityIndicator color="#262626" style={{ marginVertical: 16 }} /> : null}
          {failed ? <Text style={styles.meta}>This Add Yours is unavailable.</Text> : null}

          {data?.groups.length ? (
            <FlatList
              style={styles.list}
              data={data.groups}
              keyExtractor={(group) => group.owner.id}
              renderItem={({ item, index }) => (
                <Pressable style={styles.row} onPress={() => onWatch(data.groups, index)} accessibilityRole="button" accessibilityLabel={`Watch ${item.owner.name}'s story`}>
                  {item.owner.avatarUrl
                    ? <Image source={{ uri: item.owner.avatarUrl }} style={[styles.avatar, item.hasUnseen && styles.unseen]} />
                    : <View style={[styles.avatar, styles.avatarEmpty, item.hasUnseen && styles.unseen]}><Ionicons name="person" size={18} color="#999" /></View>}
                  <Text style={styles.name} numberOfLines={1}>{item.isOwn ? 'Your story' : item.owner.name}</Text>
                  <Ionicons name="chevron-forward" size={18} color="#8E8E8E" />
                </Pressable>
              )}
            />
          ) : null}

          {sticker ? (
            <Pressable style={styles.join} onPress={() => onJoin(sticker)} accessibilityRole="button">
              <Text style={styles.joinText}>Add yours</Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 10, paddingBottom: 30, paddingHorizontal: 20, alignItems: 'center', gap: 10, maxHeight: '80%' },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#DBDBDB', marginBottom: 6 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#C13584', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5 },
  badgeText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  prompt: { fontSize: 20, fontWeight: '700', color: '#262626', textAlign: 'center' },
  meta: { fontSize: 14, color: '#8E8E8E', textAlign: 'center' },
  list: { alignSelf: 'stretch', maxHeight: 300 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EFEFEF' },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  unseen: { borderWidth: 2, borderColor: '#C13584' },
  name: { flex: 1, fontSize: 15, fontWeight: '600', color: '#262626' },
  join: { alignSelf: 'stretch', backgroundColor: '#3897F0', borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 6 },
  joinText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
