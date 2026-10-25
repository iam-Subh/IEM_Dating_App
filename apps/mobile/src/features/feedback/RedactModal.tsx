import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { initialWindowMetrics, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { settingsPalette as palette } from '../../core/settings/SettingsLayout';
import { captureView } from './capture';

type Box = { x: number; y: number; width: number; height: number };

/**
 * "Hide private details": drag across a screenshot to cover what shouldn't be
 * sent - someone's photo, a message, a name. The covered copy replaces the
 * original; nothing under a box leaves the phone.
 */
export function RedactModal({ uri, onDone, onCancel }: { uri: string | null; onDone: (uri: string) => void; onCancel: () => void }) {
  // Read directly, with a fallback, so the editor never depends on where it is mounted.
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets ?? { top: 0, bottom: 0, left: 0, right: 0 };
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [ratio, setRatio] = useState<number | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [drawing, setDrawing] = useState<Box | null>(null);
  const [saving, setSaving] = useState(false);
  const canvas = useRef<View>(null);
  const start = useRef({ x: 0, y: 0 });

  useEffect(() => {
    setBoxes([]); setDrawing(null); setRatio(null);
    if (uri) Image.getSize(uri, (width, height) => setRatio(width / height), () => setRatio(9 / 19.5));
  }, [uri]);

  const area = { width: screenWidth - 32, height: screenHeight - insets.top - insets.bottom - 170 };
  const size = ratio ? (area.width / area.height > ratio ? { width: area.height * ratio, height: area.height } : { width: area.width, height: area.width / ratio }) : null;

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      start.current = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
      setDrawing({ ...start.current, width: 0, height: 0 });
    },
    onPanResponderMove: (_event, gesture) => {
      const x = Math.min(start.current.x, start.current.x + gesture.dx);
      const y = Math.min(start.current.y, start.current.y + gesture.dy);
      setDrawing({ x, y, width: Math.abs(gesture.dx), height: Math.abs(gesture.dy) });
    },
    onPanResponderRelease: () => {
      setDrawing((box) => {
        // A tap, not a drag: a small square where the finger was.
        const next = box && (box.width < 12 || box.height < 12) ? { x: box.x - 24, y: box.y - 24, width: 48, height: 48 } : box;
        if (next) setBoxes((items) => [...items, next]);
        return null;
      });
    },
  }), []);

  const done = async () => {
    if (!boxes.length) { onCancel(); return; }
    setSaving(true);
    const covered = await captureView(canvas.current);
    setSaving(false);
    if (covered) onDone(covered); else onCancel();
  };

  return <Modal visible={!!uri} animationType="slide" statusBarTranslucent onRequestClose={onCancel}>
    <View style={[styles.page, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.header}>
        <Pressable onPress={onCancel} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancel"><Text style={styles.headerAction}>Cancel</Text></Pressable>
        <Text style={styles.title}>Hide private details</Text>
        <Pressable onPress={() => void done()} disabled={saving} hitSlop={10} accessibilityRole="button" accessibilityLabel="Done">
          {saving ? <ActivityIndicator color={palette.accent} /> : <Text style={[styles.headerAction, styles.done]}>Done</Text>}
        </Pressable>
      </View>
      <Text style={styles.hint}>Drag over anything private - a photo, a name, a message.</Text>
      <View style={styles.stage}>
        {uri && size ? <View ref={canvas} collapsable={false} style={size} {...responder.panHandlers}>
          <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
          {[...boxes, ...(drawing ? [drawing] : [])].map((box, index) => <View key={index} pointerEvents="none" style={[styles.box, { left: box.x, top: box.y, width: box.width, height: box.height }]} />)}
        </View> : <ActivityIndicator color={palette.accent} />}
      </View>
      <View style={styles.tools}>
        <Pressable onPress={() => setBoxes((items) => items.slice(0, -1))} disabled={!boxes.length} style={[styles.tool, !boxes.length && styles.disabled]} accessibilityRole="button" accessibilityLabel="Undo">
          <Ionicons name="arrow-undo-outline" size={18} color={palette.text} /><Text style={styles.toolText}>Undo</Text>
        </Pressable>
        <Pressable onPress={() => setBoxes([])} disabled={!boxes.length} style={[styles.tool, !boxes.length && styles.disabled]} accessibilityRole="button" accessibilityLabel="Clear all">
          <Ionicons name="trash-outline" size={18} color={palette.text} /><Text style={styles.toolText}>Clear</Text>
        </Pressable>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#0E0D0C', paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 44 },
  title: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 17 },
  headerAction: { color: palette.secondary, fontFamily: 'DMSans_500Medium', fontSize: 15, minWidth: 56 },
  done: { color: palette.accent, fontFamily: 'DMSans_700Bold', textAlign: 'right' },
  hint: { color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 13, textAlign: 'center', marginTop: 4, marginBottom: 12 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  box: { position: 'absolute', backgroundColor: '#000000', borderRadius: 4 },
  tools: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginTop: 14 },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)' },
  toolText: { color: palette.text, fontFamily: 'DMSans_500Medium', fontSize: 14 },
  disabled: { opacity: 0.4 },
});
