import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { CLOSE_FRIENDS_GREEN } from '../../settings/storySettings';
import { useStoryBack } from '../backStack';
import { finishStoryShareRequest, storyShareRequest, type StoryShareChoice } from './storyShareRequests';

/**
 * Content for the native share sheet. Android controls its drag and dismissal.
 */
export function StoryShareSheetScreen() {
  const navigation = useNavigation<any>();
  const { params } = useRoute<any>();
  const requestId = params.requestId as string;
  const request = storyShareRequest(requestId);
  const insets = useSafeAreaInsets();
  const choice = useRef<StoryShareChoice>(null);
  const closing = useRef(false);
  const completionFrame = useRef<number | null>(null);
  useEffect(() => {
    if (completionFrame.current !== null) cancelAnimationFrame(completionFrame.current);
    const unsubscribe = navigation.addListener('transitionEnd', (event: any) => {
      if (event.data.closing) finishStoryShareRequest(requestId, choice.current);
    });
    return () => {
      unsubscribe();
      // Drag dismissal can remove the route before transitionEnd reaches JS.
      completionFrame.current = requestAnimationFrame(() => finishStoryShareRequest(requestId, choice.current));
    };
  }, [navigation, requestId]);
  const close = (result: StoryShareChoice = null) => {
    if (closing.current) return;
    closing.current = true;
    choice.current = result;
    navigation.goBack();
  };
  // The demo's outer Modal forwards Android Back to the story back stack.
  useStoryBack(() => { close(); return true; });
  if (!request) return null;
  const { count, avatar, canEditCloseFriends } = request;
  return (
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
        <Text style={styles.title} accessibilityRole="header">Share {count} {count === 1 ? 'story' : 'stories'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Share to your story" onPress={() => close('followers')}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          {avatar ? <Image source={{ uri: avatar }} style={styles.avatar} /> : <View style={[styles.avatar, styles.blank]}><Ionicons name="person" size={18} color="#fff" /></View>}
          <View style={styles.copy}>
            <Text style={styles.label}>Your story</Text>
            <Text style={styles.detail}>Everyone who can see your stories</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#8E8E93" />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Share to Close Friends" onPress={() => close('close_friends')}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <View style={[styles.avatar, styles.star]}><Ionicons name="star" size={18} color={CLOSE_FRIENDS_GREEN} /></View>
          <View style={styles.copy}>
            <Text style={styles.label}>Close Friends</Text>
            <Text style={styles.detail}>Only the people on your list</Text>
          </View>
          {canEditCloseFriends ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Edit Close Friends" onPress={() => close('edit_close_friends')} hitSlop={8}
              style={({ pressed }) => [styles.edit, pressed && styles.pressed]}>
              <Text style={styles.editText}>Edit</Text>
            </Pressable>
          ) : <Ionicons name="chevron-forward" size={20} color="#8E8E93" />}
        </Pressable>
      </View>
  );
}

/**
 * A story in the strip: its picture (a video's first frame), and a ✕ that
 * takes it out of the set.
 */
export function StoryStripThumb({ kind, uri, active, disabled, index, onSelect, onRemove }: {
  kind: 'photo' | 'video';
  uri: string;
  active: boolean;
  disabled: boolean;
  index: number;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const [frame, setFrame] = useState<string | null>(null);
  useEffect(() => {
    if (kind !== 'video') return;
    let live = true;
    VideoThumbnails.getThumbnailAsync(uri, { time: 0, quality: 0.4 }).then((result) => { if (live) setFrame(result.uri); }).catch(() => undefined);
    return () => { live = false; };
  }, [kind, uri]);
  const picture = kind === 'photo' ? uri : frame;
  return (
    <View style={styles.thumbWrap}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Story ${index + 1}${kind === 'video' ? ', video' : ''}`} accessibilityState={{ selected: active }}
        disabled={disabled} onPress={onSelect} style={[styles.thumb, active && styles.thumbActive]}>
        {picture ? <Image source={{ uri: picture }} style={StyleSheet.absoluteFill} /> : <View style={[StyleSheet.absoluteFill, styles.blank]} />}
        {kind === 'video' ? <View style={styles.videoMark}><Ionicons name="videocam" size={10} color="#fff" /></View> : null}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove story ${index + 1}`} disabled={disabled} onPress={onRemove} hitSlop={8} style={styles.remove}>
        <Ionicons name="close" size={11} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: '#262628', paddingHorizontal: 16, paddingTop: 12 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 8, marginLeft: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 4, borderRadius: 14 },
  pressed: { opacity: 0.7 },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  blank: { backgroundColor: '#3A3A3C', alignItems: 'center', justifyContent: 'center' },
  star: { backgroundColor: '#26382B', alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  label: { color: '#fff', fontSize: 16, fontWeight: '600' },
  detail: { color: '#A1A1A6', fontSize: 13, marginTop: 2 },
  edit: { paddingHorizontal: 14, height: 34, borderRadius: 17, backgroundColor: '#3A3A3C', alignItems: 'center', justifyContent: 'center' },
  editText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  thumbWrap: { paddingTop: 6, paddingRight: 6 },
  thumb: { width: 36, height: 56, borderRadius: 6, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', backgroundColor: '#222' },
  thumbActive: { borderColor: '#fff' },
  videoMark: { position: 'absolute', left: 3, bottom: 3, width: 16, height: 16, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  remove: { position: 'absolute', top: 0, right: 0, width: 18, height: 18, borderRadius: 9, backgroundColor: '#3A3A3C', borderWidth: 1.5, borderColor: '#161616', alignItems: 'center', justifyContent: 'center' },
});
