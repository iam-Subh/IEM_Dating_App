import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { markedMessagePreview, type MarkedMessage } from '../messageMarks';

export function PinnedMessageBar({ messages, onSelect, onOpenList }: {
  messages: MarkedMessage[]; onSelect: (id: string) => void; onOpenList: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (!messages.length) return null;
  const index = Math.max(0, messages.findIndex(message => message.id === selectedId));
  const message = messages[index];
  const preview = markedMessagePreview(message);
  return <View style={styles.bar}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Pinned message ${index + 1} of ${messages.length}. ${preview.text}. Open message.`}
      style={({ pressed }) => [styles.target, pressed && styles.pressed]}
      onPress={() => { onSelect(message.id); setSelectedId(messages[(index + 1) % messages.length].id); }}>
      <View style={styles.position} pointerEvents="none">
        {Array.from({ length: Math.min(messages.length, 4) }, (_, item) => <View key={item} style={[styles.segment, item === index % 4 && styles.segmentActive]} />)}
      </View>
      <View style={styles.copy}>
        <View style={styles.titleRow}><Ionicons name="pin" size={12} color="#F3C1CA" /><Text style={styles.title}>Pinned message</Text>
          {messages.length > 1 ? <Text style={styles.count}>{index + 1} / {messages.length}</Text> : null}</View>
        <Text style={styles.preview} numberOfLines={1}>{preview.icon ? <Ionicons name={preview.icon} size={13} color="#BDB8BA" /> : null}{preview.icon ? ' ' : ''}{preview.text}</Text>
      </View>
    </Pressable>
    <Pressable onPress={onOpenList} accessibilityRole="button" accessibilityLabel="View all pinned messages" style={({ pressed }) => [styles.listButton, pressed && styles.pressed]}>
      <Ionicons name="list-outline" size={23} color="#DDD6DA" />
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  bar: { height: 55, backgroundColor: '#211D1F', flexDirection: 'row' },
  target: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingVertical: 8, gap: 11 },
  position: { width: 3, height: 36, gap: 3 }, segment: { flex: 1, borderRadius: 2, backgroundColor: '#59434B' }, segmentActive: { backgroundColor: '#F3C1CA' },
  copy: { flex: 1, minWidth: 0, gap: 3 }, titleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  title: { color: '#F3C1CA', fontSize: 13, fontWeight: '600' }, count: { color: '#AAA0A5', fontSize: 11, marginLeft: 4 },
  preview: { color: '#DDD6DA', fontSize: 13, lineHeight: 17 },
  listButton: { width: 48, alignItems: 'center', justifyContent: 'center' }, pressed: { backgroundColor: '#30292D' },
});
