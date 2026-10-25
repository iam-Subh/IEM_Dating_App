import React, { useEffect, useRef } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { rose } from '../features/auth/onboarding/theme';
import { connectionColors as c } from '../features/auth/onboarding/ConnectionDesign';

export function LastPhotoWarningModal({ visible, imageUri, onClose, onReplace, appearance = 'dark' }: {
  visible: boolean; imageUri?: string; onClose: () => void; onReplace: () => void; appearance?: 'dark' | 'onboarding';
}) {
  const light = appearance === 'onboarding';
  const tone = light ? {surface: c.canvas, text: c.text, muted: c.muted, wash: c.wash, primary: c.primary, buttonText: '#FFF'} :
    {surface: rose.surface, text: '#FFF4F6', muted: '#D2C9CC', wash: '#393036', primary: rose.primary, buttonText: '#33212A'};
  const replacement = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (replacement.current) clearTimeout(replacement.current); }, []);
  const replace = () => {
    if (replacement.current) return;
    onClose();
    // Let the native modal window close before opening a camera or gallery.
    replacement.current = setTimeout(() => { replacement.current = null; onReplace(); }, 150);
  };
  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
    <View style={s.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Keep current photo" />
      <View style={[s.dialog, {backgroundColor: tone.surface}]} accessibilityViewIsModal>
        <View style={s.header}>
          <Text style={[s.label, {color: tone.muted}]}>Your profile photo</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close photo warning" onPress={onClose}
            style={({pressed}) => [s.close, {backgroundColor: tone.wash}, pressed && s.pressed]}>
            <Ionicons name="close" size={20} color={tone.text}/>
          </Pressable>
        </View>
        <View style={[s.preview, {backgroundColor: tone.wash}]}>
          {imageUri ? <Image source={{ uri: imageUri }} style={s.image} resizeMode="cover"/> : <Ionicons name="images-outline" size={34} color={tone.primary}/>}
          <View style={[s.photoBadge, {backgroundColor: tone.wash, borderColor: tone.surface}]}><Ionicons name="image-outline" size={17} color={tone.primary}/></View>
        </View>
        <Text accessibilityRole="header" style={[s.title, {color: tone.text}, light && s.lightTitle]}>Keep one photo</Text>
        <Text style={[s.body, {color: tone.muted}]}>Your profile needs at least one photo. You can replace this photo with a different one.</Text>
        <Pressable accessibilityRole="button" onPress={replace} style={({ pressed }) => [s.primary, {backgroundColor: tone.primary}, pressed && s.pressed]}><Ionicons name="swap-horizontal-outline" size={19} color={tone.buttonText}/><Text style={[s.primaryText, {color: tone.buttonText}]}>Replace photo</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [s.secondary, {backgroundColor: tone.wash}, pressed && s.pressed]}><Text style={[s.secondaryText, {color: light ? c.primary : tone.text}]}>Keep this photo</Text></Pressable>
      </View>
    </View>
  </Modal>;
}

const s = StyleSheet.create({
  overlay: { flex: 1, padding: 24, backgroundColor: 'rgba(28,20,27,0.45)', alignItems: 'center', justifyContent: 'center' },
  dialog: { width: '100%', maxWidth: 336, padding: 22, borderRadius: 28, alignItems: 'center' },
  header: {width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12},
  close: {width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center'},
  preview: { width: 96, height: 96, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  image: { width: 96, height: 96, borderRadius: 22 },
  photoBadge: { position: 'absolute', right: -7, bottom: -7, width: 34, height: 34, borderRadius: 17, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 18, flexShrink: 1 },
  title: { marginTop: 18, fontFamily: 'DMSans_700Bold', fontSize: 24, lineHeight: 32, textAlign: 'center' },
  lightTitle: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 32, lineHeight: 38},
  body: { marginTop: 8, marginBottom: 22, fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 20, textAlign: 'center' },
  primary: { width: '100%', minHeight: 50, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 25, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { fontFamily: 'DMSans_500Medium', fontSize: 15 },
  secondary: { minHeight: 48, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 24, width: '100%', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  secondaryText: { fontFamily: 'DMSans_500Medium', fontSize: 14 },
  pressed: { opacity: 0.8 },
});
