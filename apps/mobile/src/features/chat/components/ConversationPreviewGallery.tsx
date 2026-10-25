import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { conversationPreview } from '../conversationPreview';
import { exampleInput, previewExamples } from '../conversationPreviewExamples';
import { ConversationPreviewLine } from './ConversationPreviewLine';

export function ConversationPreviewGallery({ onClose }: { onClose?: () => void }) {
  const [outgoing, setOutgoing] = useState(true);
  return <View style={styles.page}>
    <View style={styles.header}>
      <View style={styles.heading}><Text style={styles.title}>Message previews</Text><Text style={styles.note}>Sample data. No messages are sent.</Text></View>
      {onClose && <Pressable onPress={onClose} accessibilityRole="button" style={styles.close}><Text style={styles.closeText}>Close</Text></Pressable>}
    </View>
    <View style={styles.tabs}>{[true, false].map(value => <Pressable key={String(value)} accessibilityRole="tab" accessibilityState={{ selected: outgoing === value }} onPress={() => setOutgoing(value)} style={[styles.tab, outgoing === value && styles.active]}>
      <Text style={[styles.tabText, outgoing === value && styles.activeText]}>{value ? 'You sent' : 'You received'}</Text>
    </Pressable>)}</View>
    <ScrollView contentContainerStyle={styles.list}>
      {previewExamples.filter(example => outgoing || (!example.draft && !example.message?.localStatus)).map(example => <View key={example.label} style={styles.example}>
        <Text style={styles.label}>{example.label}</Text>
        <View style={styles.row}>
          <View style={styles.avatar}><Text style={styles.initial}>R</Text></View>
          <View style={styles.copy}>
            <View style={styles.top}><Text style={styles.name}>Rupsa</Text><Text style={styles.time}>2:15 pm</Text></View>
            <View style={styles.bottom}><ConversationPreviewLine preview={conversationPreview(exampleInput(example, outgoing))} unread={!outgoing} />{!outgoing && <View style={styles.count}><Text style={styles.countText}>3</Text></View>}</View>
          </View>
        </View>
      </View>)}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#100F0D', width: '100%', maxWidth: 600, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, gap: 12 }, heading: { flex: 1 },
  title: { color: '#FAF7F4', fontSize: 23, fontFamily: 'DMSans_700Bold' }, note: { color: '#A6A19F', fontSize: 12, marginTop: 6 },
  close: { padding: 12 }, closeText: { color: '#F3C1CA' },
  tabs: { flexDirection: 'row', backgroundColor: '#242321', borderRadius: 24, padding: 4, marginHorizontal: 20, marginBottom: 12 },
  tab: { flex: 1, alignItems: 'center', padding: 12, borderRadius: 22 }, active: { backgroundColor: '#F3C1CA' },
  tabText: { color: '#C6BFBA', fontWeight: '600' }, activeText: { color: '#331C23' },
  list: { paddingHorizontal: 20, paddingBottom: 40 }, example: { paddingVertical: 12 },
  label: { fontSize: 11, color: '#C49B81', marginBottom: 10 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#3B2933', alignItems: 'center', justifyContent: 'center' }, initial: { color: '#F3C1CA', fontSize: 20 },
  copy: { flex: 1, minWidth: 0 }, top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  name: { color: '#FAF7F4', fontSize: 15, fontWeight: '600' }, time: { color: '#A6A19F', fontSize: 10 },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: 10 }, count: { borderRadius: 10, minWidth: 19, height: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3C1CA' }, countText: { color: '#331C23', fontSize: 10, fontWeight: '700' },
});
