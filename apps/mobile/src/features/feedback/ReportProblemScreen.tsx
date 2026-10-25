import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SettingsPage, settingsPalette as palette } from '../../core/settings/SettingsLayout';
import { SUPPORT_EMAIL, writeToSupport } from '../../core/support';
import { collectDiagnostics } from './diagnostics';
import { canCapture } from './capture';
import { MAX_PHOTOS, pickPhotos, pickRecording, shrinkPhoto } from './media';
import { newClientId, submitReport, type Area, type Attachment, type Source } from './reportQueue';
import { RedactModal } from './RedactModal';

/**
 * Settings > Safety and help > Report a problem, a shake, or an error screen
 * (docs/FEEDBACK.md). One screen: what, what happened, what it looked like.
 * The draft is kept if the app closes; with no signal the report waits and
 * sends itself.
 */
export type ReportProblemParams = { source?: Source; screenshot?: string | null; screen?: string | null; area?: Area; description?: string };

const AREAS: { id: Area; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { id: 'chat', label: 'Chat', icon: 'chatbubble-outline' },
  { id: 'photos', label: 'Photos & video', icon: 'images-outline' },
  { id: 'matches', label: 'Matches', icon: 'heart-outline' },
  { id: 'explore', label: 'Explore', icon: 'compass-outline' },
  { id: 'stories', label: 'Stories', icon: 'aperture-outline' },
  { id: 'login', label: 'Login', icon: 'log-in-outline' },
  { id: 'notifications', label: 'Notifications', icon: 'notifications-outline' },
  { id: 'other', label: 'Something else', icon: 'ellipsis-horizontal' },
];
const MIN_WORDS = 10;
const MAX_WORDS = 2000;
const DRAFT_KEY = 'feedback.draft.v1';

type Sent = { reference: string; skippedFiles: number } | { queued: true };

export function ReportProblemScreen() {
  const navigation = useNavigation<any>();
  const params = (useRoute().params ?? {}) as ReportProblemParams;
  const insets = useSafeAreaInsets();
  const [area, setArea] = useState<Area | null>(params.area ?? null);
  const [description, setDescription] = useState(params.description ?? '');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [technical, setTechnical] = useState(true);
  const [showTechnical, setShowTechnical] = useState(false);
  const [redacting, setRedacting] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const clientId = useRef(newClientId()).current;
  const diagnostics = useMemo(() => collectDiagnostics(params.screen ?? null), [params.screen]);

  // The screenshot of the screen they were on (shake, error): shrunk like any photo.
  useEffect(() => {
    if (!params.screenshot) return;
    void shrinkPhoto(params.screenshot).then((uri) => setAttachments((items) => items.some((item) => item.uri === uri) ? items : [{ kind: 'photo', uri }, ...items])).catch(() => undefined);
  }, [params.screenshot]);
  // A draft from last time, unless this report arrived with its own words.
  useEffect(() => {
    if (params.description || params.area) return;
    void AsyncStorage.getItem(DRAFT_KEY).then((raw) => {
      const draft = raw ? JSON.parse(raw) as { area?: Area; description?: string } : null;
      if (draft?.description) setDescription((current) => current || draft.description!);
      if (draft?.area) setArea((current) => current ?? draft.area!);
    }).catch(() => undefined);
  }, [params.area, params.description]);
  useEffect(() => {
    if (sent) return;
    const timer = setTimeout(() => { void AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({ area, description })).catch(() => undefined); }, 400);
    return () => clearTimeout(timer);
  }, [area, description, sent]);

  const photos = attachments.filter((item) => item.kind === 'photo');
  const video = attachments.find((item) => item.kind === 'video');
  const trimmed = description.trim();
  const ready = !!area && trimmed.length >= MIN_WORDS && !sending;

  const addPhotos = async () => {
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) return;
    const { uris, problem } = await pickPhotos(room);
    if (uris.length) setAttachments((items) => [...items, ...uris.map((uri) => ({ kind: 'photo' as const, uri }))]);
    if (problem) Alert.alert(problem.title, problem.message);
  };
  const addRecording = async () => {
    const { uri, problem } = await pickRecording();
    if (problem) { Alert.alert(problem.title, problem.message); return; }
    if (uri) setAttachments((items) => [...items.filter((item) => item.kind !== 'video'), { kind: 'video', uri }]);
  };
  const remove = (uri: string) => setAttachments((items) => items.filter((item) => item.uri !== uri));

  const send = async () => {
    if (!ready || !area) return;
    setSending(true);
    const result = await submitReport({
      clientId, area, description: trimmed, source: params.source ?? 'form',
      diagnostics: technical ? diagnostics : null, attachments,
    });
    setSending(false);
    if (result.state === 'refused') {
      Alert.alert("Couldn't send your report", result.message, [
        { text: 'Write by email', onPress: () => void writeToSupport('App problem', trimmed) },
        { text: 'OK', style: 'cancel' },
      ]);
      return;
    }
    await AsyncStorage.removeItem(DRAFT_KEY).catch(() => undefined);
    setSent(result.state === 'sent' ? { reference: result.reference, skippedFiles: result.skippedFiles } : { queued: true });
  };

  if (sent) return <SettingsPage title="Report a problem">
    <View style={[styles.sent, { paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.sentIcon}><Ionicons name={'queued' in sent ? 'cloud-upload-outline' : 'checkmark'} size={30} color={palette.accentText} /></View>
      {'queued' in sent ? <>
        <Text style={styles.sentTitle}>Saved</Text>
        <Text style={styles.sentBody}>You're offline right now. We'll send your report as soon as you're back online - you don't need to do anything.</Text>
      </> : <>
        <Text style={styles.sentTitle}>Thanks, we got it</Text>
        <Text style={styles.sentReference}>Reference {sent.reference}</Text>
        <Text style={styles.sentBody}>We read every report. We can't reply to each one, but if we need more details we'll message you here.</Text>
        <Text style={styles.sentBody}>You'll get a notification when it's fixed.</Text>
        {sent.skippedFiles > 0 && <Text style={styles.sentWarning}>{sent.skippedFiles === 1 ? "One file couldn't be uploaded" : `${sent.skippedFiles} files couldn't be uploaded`}, so your report was sent without it.</Text>}
      </>}
      <Pressable style={styles.primary} onPress={() => navigation.goBack()} accessibilityRole="button"><Text style={styles.primaryText}>Done</Text></Pressable>
      <Pressable style={styles.secondary} onPress={() => navigation.replace('MyReports')} accessibilityRole="button"><Text style={styles.secondaryText}>See my reports</Text></Pressable>
    </View>
  </SettingsPage>;

  return <SettingsPage title="Report a problem">
    <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 110 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Text style={styles.lead}>Something not working? Tell us and we'll fix it. To report a person, use Report someone instead.</Text>

      <Text style={styles.label}>What's not working?</Text>
      <View style={styles.chips}>
        {AREAS.map((item) => <Pressable key={item.id} onPress={() => setArea(item.id)} style={[styles.chip, area === item.id && styles.chipOn]}
          accessibilityRole="radio" accessibilityState={{ selected: area === item.id }}>
          <Ionicons name={item.icon} size={15} color={area === item.id ? palette.accentText : palette.secondary} />
          <Text style={[styles.chipText, area === item.id && styles.chipTextOn]}>{item.label}</Text>
        </Pressable>)}
      </View>

      <Text style={styles.label}>What happened?</Text>
      <TextInput value={description} onChangeText={(text) => setDescription(text.slice(0, MAX_WORDS))} multiline textAlignVertical="top"
        placeholder="What did you do, and what did you expect to happen?" placeholderTextColor={palette.muted} style={styles.input}
        accessibilityLabel="What happened" />
      <Text style={[styles.counter, trimmed.length > 0 && trimmed.length < MIN_WORDS && styles.counterShort]}>
        {trimmed.length > 0 && trimmed.length < MIN_WORDS ? `A little more, please - at least ${MIN_WORDS} characters` : `${description.length} / ${MAX_WORDS}`}
      </Text>

      <Text style={styles.label}>Screenshots and recording <Text style={styles.optional}>(optional)</Text></Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.files}>
        {attachments.map((item, index) => <View key={item.uri} style={styles.file}>
          {item.kind === 'photo' ? <Image source={{ uri: item.uri }} style={styles.fileImage} />
            : <View style={[styles.fileImage, styles.videoFile]}><Ionicons name="videocam" size={24} color={palette.accent} /><Text style={styles.videoText}>Recording</Text></View>}
          <Pressable onPress={() => remove(item.uri)} style={styles.fileRemove} accessibilityRole="button" accessibilityLabel={item.kind === 'photo' ? 'Remove photo' : 'Remove recording'}>
            <View style={styles.fileRemoveIcon}><Ionicons name="close" size={14} color="#FFFFFF" /></View>
          </Pressable>
          {item.kind === 'photo' && canCapture() && <Pressable onPress={() => setRedacting(index)} style={styles.fileHide} accessibilityRole="button" accessibilityLabel="Hide private details in this photo">
            <Ionicons name="eye-off-outline" size={12} color="#FFFFFF" /><Text style={styles.fileHideText}>Hide</Text>
          </Pressable>}
        </View>)}
        {photos.length < MAX_PHOTOS && <Pressable onPress={() => void addPhotos()} style={styles.add} accessibilityRole="button" accessibilityLabel="Add screenshots">
          <Ionicons name="image-outline" size={22} color={palette.accent} /><Text style={styles.addText}>Photo</Text>
        </Pressable>}
        {!video && <Pressable onPress={() => void addRecording()} style={styles.add} accessibilityRole="button" accessibilityLabel="Add a screen recording">
          <Ionicons name="videocam-outline" size={22} color={palette.accent} /><Text style={styles.addText}>Recording</Text>
        </Pressable>}
      </ScrollView>
      <Text style={styles.note}>Up to {MAX_PHOTOS} photos and one screen recording (60 seconds). To record, use your phone's screen recorder from the quick settings, then add it here. Screenshots can show other people - tap Hide to cover anything private.</Text>

      <View style={styles.technical}>
        <Pressable onPress={() => setTechnical((value) => !value)} style={styles.technicalRow} accessibilityRole="switch" accessibilityState={{ checked: technical }}>
          <Ionicons name={technical ? 'checkbox' : 'square-outline'} size={22} color={technical ? palette.accent : palette.muted} />
          <View style={{ flex: 1 }}>
            <Text style={styles.technicalTitle}>Include technical details</Text>
            <Text style={styles.technicalHint}>App version, phone model and recent errors. Never your messages or password.</Text>
          </View>
        </Pressable>
        <Pressable onPress={() => setShowTechnical((value) => !value)} hitSlop={6} accessibilityRole="button">
          <Text style={styles.link}>{showTechnical ? 'Hide what is sent' : 'See what is sent'}</Text>
        </Pressable>
        {showTechnical && <Text style={styles.technicalDump} selectable>{[
          `App version: ${diagnostics.appVersion}`, `Phone: ${diagnostics.device ?? 'unknown'} · Android ${diagnostics.osVersion}`,
          `Screen: ${diagnostics.screen ?? 'unknown'}`,
          `Recent errors: ${diagnostics.recentErrors.length ? `\n${diagnostics.recentErrors.slice(-5).map((item) => `- ${item.message}`).join('\n')}` : 'none'}`,
        ].join('\n')}</Text>}
      </View>
      <Text style={styles.note}>Prefer email? Write to {SUPPORT_EMAIL}.</Text>
    </KeyboardAwareScrollView>

    <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
      <Pressable onPress={() => void send()} disabled={!ready} style={[styles.primary, !ready && styles.primaryOff]} accessibilityRole="button" accessibilityState={{ disabled: !ready, busy: sending }}>
        {sending ? <ActivityIndicator color={palette.accentText} /> : <Text style={styles.primaryText}>Send report</Text>}
      </Pressable>
      {!area && <Text style={styles.footerHint}>Choose what's not working to send</Text>}
    </View>

    <RedactModal uri={redacting === null ? null : attachments[redacting]?.uri ?? null}
      onCancel={() => setRedacting(null)}
      onDone={(uri) => { setAttachments((items) => items.map((item, index) => index === redacting ? { ...item, uri } : item)); setRedacting(null); }} />
  </SettingsPage>;
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 600, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 6 },
  lead: { color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 20 },
  label: { color: palette.text, fontFamily: 'DMSans_700Bold', fontSize: 15, marginTop: 22, marginBottom: 10 },
  optional: { color: palette.muted, fontFamily: 'DMSans_400Regular', fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 14, borderRadius: 19, backgroundColor: palette.card, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  chipOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  chipText: { color: palette.text, fontFamily: 'DMSans_500Medium', fontSize: 14 },
  chipTextOn: { color: palette.accentText },
  input: { minHeight: 130, borderRadius: 16, backgroundColor: palette.card, color: palette.text, padding: 14, fontFamily: 'DMSans_400Regular', fontSize: 15, lineHeight: 21 },
  counter: { color: palette.muted, fontFamily: 'DMSans_400Regular', fontSize: 12, textAlign: 'right', marginTop: 6 },
  counterShort: { color: palette.accent },
  files: { gap: 10, paddingVertical: 4, paddingRight: 8 },
  file: { width: 84, height: 112 },
  fileImage: { width: 84, height: 112, borderRadius: 12, backgroundColor: palette.card },
  videoFile: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  videoText: { color: palette.secondary, fontFamily: 'DMSans_500Medium', fontSize: 11 },
  fileRemove: { position: 'absolute', top: 0, right: 0, width: 44, height: 44, padding: 4, alignItems: 'flex-end', justifyContent: 'flex-start' },
  fileRemoveIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#3A3A3C', alignItems: 'center', justifyContent: 'center' },
  fileHide: { position: 'absolute', bottom: 6, left: 6, right: 6, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  fileHideText: { color: '#FFFFFF', fontFamily: 'DMSans_500Medium', fontSize: 11 },
  add: { width: 84, height: 112, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(243,193,202,0.4)', alignItems: 'center', justifyContent: 'center', gap: 6 },
  addText: { color: palette.accent, fontFamily: 'DMSans_500Medium', fontSize: 12 },
  note: { color: palette.muted, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 17, marginTop: 10 },
  technical: { marginTop: 22, padding: 14, borderRadius: 16, backgroundColor: palette.card, gap: 10 },
  technicalRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  technicalTitle: { color: palette.text, fontFamily: 'DMSans_500Medium', fontSize: 14 },
  technicalHint: { color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 17, marginTop: 2 },
  link: { color: palette.accent, fontFamily: 'DMSans_500Medium', fontSize: 13, marginLeft: 34 },
  technicalDump: { color: palette.secondary, fontFamily: 'monospace', fontSize: 11, lineHeight: 16, marginLeft: 34 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, backgroundColor: '#100F0D', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
  footerHint: { color: palette.muted, fontFamily: 'DMSans_400Regular', fontSize: 12, textAlign: 'center', marginTop: 6 },
  primary: { height: 52, borderRadius: 26, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  primaryOff: { opacity: 0.45 },
  primaryText: { color: palette.accentText, fontFamily: 'DMSans_700Bold', fontSize: 16 },
  secondary: { height: 48, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', marginTop: 6 },
  secondaryText: { color: palette.accent, fontFamily: 'DMSans_500Medium', fontSize: 15 },
  sent: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 10 },
  sentIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  sentTitle: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 24 },
  sentReference: { color: palette.accent, fontFamily: 'DMSans_700Bold', fontSize: 15 },
  sentBody: { color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 15, lineHeight: 22, textAlign: 'center' },
  sentWarning: { color: palette.danger, fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
