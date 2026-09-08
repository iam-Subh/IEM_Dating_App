import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../../services/api';
import { colors } from '../../core/theme/colors';

export const CreateStoryScreen = ({ navigation }: any) => {
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const choose = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Photo access is off. Enable photo access in your device settings, then try again.');
      return;
    }
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.9, videoMaxDuration: 15 });
    if (!result.canceled) setAsset(result.assets[0]);
  };
  const publish = async () => {
    if (!asset || busy) return;
    setBusy(true);
    setError(null);
    try {
      setStatus('Preparing upload…');
      await api.put('/stories/settings', { storiesEnabled: true, allowFollowRequests: true });
      const ext = asset.type === 'video' ? 'mp4' : (asset.fileName?.split('.').pop()?.toLowerCase() || 'jpg');
      const ticket = (await api.post('/stories/media/upload-url', undefined, { params: { ext } })).data.data;
      const blob = await (await fetch(asset.uri)).blob();
      await fetch(ticket.uploadUrl, { method: 'PUT', headers: { 'Content-Type': ticket.contentType }, body: blob });
      setStatus('Checking media…');
      await api.post(`/stories/media/${ticket.assetId}/complete`, undefined, { timeout: 120000 });
      setStatus('Publishing Story…');
      await api.post('/stories', { assetId: ticket.assetId, clientPublishId: `story-${Date.now()}-${Math.random().toString(36).slice(2)}`, caption });
      navigation.goBack();
    } catch (cause: any) {
      const code = cause?.response?.data?.code;
      setError(
        code === 'STORY_UPLOAD_INVALID'
          ? 'The server rejected this media file. Select a supported photo or video.'
          : code === 'STORY_PROCESSING_FAILED'
            ? 'The server could not process this media file. Select another photo or video.'
            : 'The Story could not be published. Check your connection and try again.',
      );
    } finally { setBusy(false); setStatus(null); }
  };
  return <View style={styles.container}>
    <Pressable accessibilityRole="button" accessibilityLabel="Cancel Story" onPress={() => navigation.goBack()}><Text style={styles.cancel}>Cancel</Text></Pressable>
    <Text style={styles.notice}>Stories are private. Approved followers can view them for 24 hours. Sharing enables follow requests.</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={asset ? 'Change Story media' : 'Select Story media'} onPress={choose} style={styles.preview}>{asset ? <Image accessible accessibilityLabel="Selected Story media preview" source={{ uri: asset.uri }} style={styles.image} /> : <Text style={styles.choose}>Select a photo or video</Text>}</Pressable>
    <TextInput accessibilityLabel="Story caption" value={caption} onChangeText={setCaption} maxLength={200} placeholder="Add a caption" placeholderTextColor={colors.text.tertiary} style={styles.input} />
    {!!status && <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text>}
    {!!error && <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel={busy ? 'Publishing Story' : 'Share Story'} accessibilityState={{ disabled: !asset || busy, busy }} disabled={!asset || busy} onPress={publish} style={[styles.publish, (!asset || busy) && styles.disabled]}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.publishText}>Share story</Text>}</Pressable>
  </View>;
};
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 20, paddingTop: 60 }, cancel: { color: colors.text.primary, fontSize: 16, marginBottom: 20 },
  preview: { flex: 1, borderRadius: 24, overflow: 'hidden', backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }, image: { width: '100%', height: '100%' }, choose: { color: colors.text.secondary },
  notice: { color: colors.text.secondary, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  input: { color: colors.text.primary, backgroundColor: colors.surface, borderRadius: 14, padding: 15, marginVertical: 16 }, publish: { backgroundColor: colors.primary, borderRadius: 24, height: 48, alignItems: 'center', justifyContent: 'center' },
  publishText: { color: '#fff', fontWeight: '700' }, disabled: { opacity: 0.45 },
  status: { color: colors.text.secondary, textAlign: 'center', marginBottom: 10 }, error: { color: colors.error, textAlign: 'center', marginBottom: 10 },
});
