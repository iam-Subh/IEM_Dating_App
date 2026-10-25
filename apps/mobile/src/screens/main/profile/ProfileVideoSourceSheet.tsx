import React, { useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { settingsPalette as palette } from '../../../core/settings/SettingsLayout';
import { selectVideoSource, type ProfileVideoSource } from './profileVideoSourceRequests';

export function ProfileVideoSourceSheet() {
  const navigation = useNavigation();
  const route = useRoute();
  const { requestId, replacing } = route.params as { requestId: string; replacing: boolean };
  const insets = useSafeAreaInsets();
  const closing = useRef(false);
  const close = (source?: ProfileVideoSource) => {
    if (closing.current) return;
    closing.current = true;
    if (source) selectVideoSource(requestId, source);
    navigation.goBack();
  };
  return <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 12 }]}>
    {Platform.OS === 'android' && <View style={styles.handle} />}
    <Text style={styles.title} accessibilityRole="header">{replacing ? 'Replace your video' : 'Add your video'}</Text>
    <Text style={styles.hint}>Choose a video of up to 60 seconds.</Text>
    <SourceRow icon="videocam-outline" title="Record a video" detail="Use your camera" onPress={() => close('camera')} />
    <SourceRow icon="film-outline" title="Choose from gallery" detail="Use a saved video" onPress={() => close('library')} />
    <Pressable onPress={() => close()} style={({ pressed }) => [styles.cancel, pressed && styles.pressed]} accessibilityRole="button">
      <Text style={styles.cancelText}>Cancel</Text>
    </Pressable>
  </View>;
}

function SourceRow({ icon, title, detail, onPress }: {
  icon: React.ComponentProps<typeof Ionicons>['name']; title: string; detail: string; onPress: () => void;
}) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}
    style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
    <View style={styles.icon}><Ionicons name={icon} size={22} color={palette.accent} /></View>
    <View style={styles.copy}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.detail}>{detail}</Text></View>
    <Ionicons name="chevron-forward" size={18} color="#DDD0D5" />
  </Pressable>;
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 20, paddingTop: 10, backgroundColor: palette.card },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 14, backgroundColor: '#716A70' },
  title: { color: '#FFB8C7', fontFamily: 'DMSans_700Bold', fontSize: 20, marginTop: 4 },
  hint: { color: '#DDD0D5', fontFamily: 'DMSans_400Regular', fontSize: 13, marginTop: 6, marginBottom: 16 },
  row: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: '#343034', marginBottom: 8 },
  icon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#493039' },
  copy: { flex: 1, minWidth: 0 },
  rowTitle: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 14 },
  detail: { color: '#DDD0D5', fontFamily: 'DMSans_400Regular', fontSize: 12, marginTop: 3 },
  cancel: { minHeight: 44, marginTop: 4, borderRadius: 22, backgroundColor: '#343034', alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 14 },
  pressed: { opacity: 0.7 },
});
