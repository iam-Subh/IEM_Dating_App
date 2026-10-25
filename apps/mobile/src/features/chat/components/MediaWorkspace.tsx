import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, FlatList, Image, Keyboard, Modal, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions,
} from 'react-native';
import { useGenericKeyboardHandler, useKeyboardContext } from 'react-native-keyboard-controller';
import Animated, { Easing, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { colors } from '../../../core/theme/colors';
import { SelectedChatMedia, VideoEdit } from './attachmentTypes';
import { hasVideoEditing } from '../../../../modules/chat-media';
import { VideoEditor } from './VideoEditor';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PhotoEditPreview } from './PhotoEditPreview';
import { flipPhoto, hasPhotoEdit, rotatePhoto } from '../photoEditing';
import { preparePhoto } from '../exportPhoto';
import { discardDraftMedia } from '../draftMedia';
import { ConfirmDialog } from './ConfirmDialog';

const KEYBOARD_EASING = Easing.bezier(0.2, 0, 0, 1);
const MEDIA_SIDE_PADDING = 12;

function useMediaKeyboardAnimation(visible: boolean) {
  const { reanimated: nativeKeyboard } = useKeyboardContext();
  const height = useSharedValue(0);
  const progress = useSharedValue(0);
  useEffect(() => {
    height.value = visible ? nativeKeyboard.height.value : 0;
    progress.value = visible ? nativeKeyboard.progress.value : 0;
  }, [visible, height, progress, nativeKeyboard.height, nativeKeyboard.progress]);
  useGenericKeyboardHandler({
    onStart: event => {
      'worklet';
      if (!visible) return;
      const config = { duration: event.duration > 0 ? event.duration : 250, easing: KEYBOARD_EASING };
      // Use the UI animation clock instead of sparse Android movement samples.
      height.value = withTiming(-Math.max(0, event.height), config);
      progress.value = withTiming(event.height > 0 ? 1 : 0, config);
    },
    onInteractive: event => {
      'worklet';
      if (!visible) return;
      height.value = -Math.max(0, event.height);
      progress.value = event.progress;
    },
  }, [visible]);
  return { height, progress };
}

function MediaSlideFrame({ width, height, children }: { width: number; height: SharedValue<number>; children: React.ReactNode }) {
  const frame = useAnimatedStyle(() => ({ height: height.value }));
  return <Animated.View style={[styles.mediaSlide, { width }, frame]}>
    <View style={styles.mediaFrame}>{children}</View>
  </Animated.View>;
}

function VideoSlide({ item, active, keyboardProgress, onEdit, onInteractingChange }: {
  item: SelectedChatMedia;
  active: boolean;
  keyboardProgress: SharedValue<number>;
  onEdit: (edit: VideoEdit) => void;
  onInteractingChange: (interacting: boolean) => void;
}) {
  const editorHeight = useSharedValue(0);
  const editorStyle = useAnimatedStyle(() => ({
    height: editorHeight.value * (1 - Math.max(0, Math.min(1, keyboardProgress.value))),
    opacity: 1 - Math.max(0, Math.min(1, keyboardProgress.value)),
  }));
  const player = useVideoPlayer({ uri: item.currentUri }, (instance) => {
    instance.loop = !hasVideoEditing;
    instance.muted = hasVideoEditing ? (item.edit?.muted ?? false) : true;
  });
  useEffect(() => {
    if (!active) player.pause();
  }, [active, player]);
  // A build without the native module cannot export an edit, so it offers none.
  if (!hasVideoEditing) {
    return <View style={styles.videoPreview}><VideoView player={player} style={styles.largeMedia} contentFit="contain" surfaceType="textureView" nativeControls /></View>;
  }
  return (
    <>
      <Pressable
        accessibilityLabel="Play or pause video"
        style={styles.videoPreview}
        onPress={() => (player.playing ? player.pause() : player.play())}
      >
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" surfaceType="textureView" nativeControls={false} />
      </Pressable>
      {active ? (
        <Animated.View style={[styles.collapsing, editorStyle]}>
          <View style={styles.videoEditor} onLayout={event => { editorHeight.value = event.nativeEvent.layout.height; }}>
            <VideoEditor item={item} player={player} onChange={onEdit} onInteractingChange={onInteractingChange} />
          </View>
        </Animated.View>
      ) : null}
    </>
  );
}

function WorkspaceThumbnail({ item }: { item: SelectedChatMedia }) {
  if (item.kind === 'file') {
    return <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}><Ionicons name="document-text" size={22} color="#fff" /></View>;
  }
  const [uri, setUri] = useState(item.kind === 'image' ? item.currentUri : undefined);
  useEffect(() => {
    let active = true;
    if (item.kind === 'image') {
      setUri(item.currentUri);
      return () => { active = false; };
    }
    if (item.edit?.coverUri) {
      setUri(item.edit.coverUri);
      return () => { active = false; };
    }
    VideoThumbnails.getThumbnailAsync(item.currentUri, { time: Math.max(100, item.edit?.startMs ?? 0) })
      .then((result) => { if (active) setUri(result.uri); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [item.currentUri, item.edit?.coverUri, item.edit?.startMs, item.kind]);
  return uri
    ? item.kind === 'image' ? <PhotoEditPreview uri={uri} edit={item.imageEdit} width={52} height={58} /> : <Image source={{ uri }} style={styles.thumbnail} />
    : <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}><Ionicons name="play" size={18} color="#fff" /></View>;
}

interface Props {
  visible: boolean;
  images: SelectedChatMedia[];
  setImages: React.Dispatch<React.SetStateAction<SelectedChatMedia[]>>;
  onClose: () => void;
  onSend: (items: SelectedChatMedia[]) => void;
  onCropPress: (uri: string, index: number) => void;
  onAddMore: () => void;
}

export function MediaWorkspace({ visible, images, setImages, onClose, onSend, onCropPress, onAddMore }: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentIndexRef = useRef(0);
  currentIndexRef.current = currentIndex;
  const { height: keyboardHeight, progress: keyboardProgress } = useMediaKeyboardAnimation(visible);
  const bodyHeight = useSharedValue(0);
  const captionHeight = useSharedValue(56);
  const preparationHeight = useSharedValue(0);
  const [preparing, setPreparing] = useState(false);
  const [preparedCount, setPreparedCount] = useState(0);
  const [discardConfirmation, setDiscardConfirmation] = useState(false);
  const preparationGeneration = useRef(0);
  const preparingRef = useRef(false);
  // Paging stops while a finger is on a video timeline, or a drag would swipe away.
  const [timelineBusy, setTimelineBusy] = useState(false);
  const listRef = useRef<FlatList<SelectedChatMedia>>(null);

  const toolbarHeight = images[currentIndex]?.kind === 'video' && hasVideoEditing ? 0 : 62;
  const closedBottomPadding = Math.max(insets.bottom, 10);
  // Keep keyboard frames on the UI thread. React only measures stable content.
  const stageHeight = useDerivedValue(() => {
    const progress = Math.max(0, Math.min(1, keyboardProgress.value));
    const bottomPadding = closedBottomPadding + (8 - closedBottomPadding) * progress;
    return Math.max(0, bodyHeight.value + keyboardHeight.value - captionHeight.value - preparationHeight.value - 8 - bottomPadding - (toolbarHeight + 68) * (1 - progress));
  });
  const mediaHeight = useDerivedValue(() => Math.max(0, stageHeight.value - 20));
  const stageStyle = useAnimatedStyle(() => ({ height: stageHeight.value }));
  const toolbarStyle = useAnimatedStyle(() => ({ height: toolbarHeight * (1 - Math.max(0, Math.min(1, keyboardProgress.value))), opacity: 1 - Math.max(0, Math.min(1, keyboardProgress.value)) }));
  const thumbnailStyle = useAnimatedStyle(() => ({ height: 68 * (1 - Math.max(0, Math.min(1, keyboardProgress.value))), opacity: 1 - Math.max(0, Math.min(1, keyboardProgress.value)) }));
  const bottomStyle = useAnimatedStyle(() => ({ paddingBottom: closedBottomPadding + (8 - closedBottomPadding) * Math.max(0, Math.min(1, keyboardProgress.value)) }));

  useEffect(() => { if (!preparing) preparationHeight.value = 0; }, [preparing, preparationHeight]);

  useEffect(() => {
    if (visible) setCurrentIndex((value) => Math.min(value, Math.max(0, images.length - 1)));
  }, [images.length, visible]);

  useEffect(() => {
    if (!visible) { preparationGeneration.current += 1; preparingRef.current = false; setPreparing(false); setDiscardConfirmation(false); }
    return () => { preparationGeneration.current += 1; };
  }, [visible]);

  useEffect(() => {
    if (visible) listRef.current?.scrollToOffset({ offset: currentIndexRef.current * screenWidth, animated: false });
  }, [screenWidth, visible]);

  if (!visible || images.length === 0) return null;
  const current = images[currentIndex] ?? images[0];
  const mediaWidth = Math.max(1, screenWidth - MEDIA_SIDE_PADDING * 2);
  const close = () => { preparationGeneration.current += 1; Keyboard.dismiss(); onClose(); };
  const requestClose = () => {
    if (discardConfirmation) return;
    // Stop file preparation before asking, so it cannot send behind the dialog.
    preparationGeneration.current += 1;
    preparingRef.current = false;
    setPreparing(false);
    Keyboard.dismiss();
    setDiscardConfirmation(true);
  };
  const handleBack = () => {
    if (Keyboard.isVisible()) { Keyboard.dismiss(); return; }
    requestClose();
  };

  const updateVideoEdit = (id: string, edit: VideoEdit) => {
    setImages((values) => values.map((item) => (item.id === id ? { ...item, edit } : item)));
  };

  const remove = (index: number) => {
    if (images.length === 1) {
      setImages([]);
      onClose();
      return;
    }
    setImages((values) => values.filter((_, itemIndex) => itemIndex !== index));
    const nextIndex = Math.min(currentIndex, images.length - 2);
    setCurrentIndex(nextIndex);
    listRef.current?.scrollToOffset({ offset: nextIndex * screenWidth, animated: false });
  };

  const rotate = () => setImages(values => values.map(item => item.id === current.id ? { ...item, imageEdit: rotatePhoto(item.imageEdit) } : item));
  const flip = () => setImages(values => values.map(item => item.id === current.id ? { ...item, imageEdit: flipPhoto(item.imageEdit) } : item));

  const reset = () => {
    if (current.kind !== 'image') return;
    setImages((values) => values.map((item, index) => index === currentIndex
      ? { ...item, currentUri: item.originalUri, imageEdit: undefined, size: undefined }
      : item));
  };

  const send = async () => {
    if (preparingRef.current || discardConfirmation) return;
    preparingRef.current = true; setPreparing(true); setPreparedCount(0); Keyboard.dismiss();
    const generation = preparationGeneration.current;
    const ready = [...images];
    const created: string[] = [];
    let index = 0, done = 0, failed = false;
    try {
      const results = await Promise.allSettled(Array.from({ length: Math.min(2, images.length) }, async () => {
        while (!failed && index < images.length && generation === preparationGeneration.current) {
          const itemIndex = index++;
          let item: SelectedChatMedia;
          try { item = await preparePhoto(images[itemIndex]); }
          catch (error) { failed = true; throw error; }
          ready[itemIndex] = item;
          if (item.currentUri !== images[itemIndex].currentUri) created.push(item.currentUri);
          if (generation === preparationGeneration.current) setPreparedCount(++done);
        }
      }));
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      if (generation !== preparationGeneration.current) { await Promise.all(created.map(discardDraftMedia)); return; }
      onSend(ready);
    } catch {
      await Promise.all(created.map(discardDraftMedia));
      if (generation === preparationGeneration.current) Alert.alert('Could not prepare photos', 'Your edits are still here. Try sending again.');
    } finally {
      if (generation === preparationGeneration.current) { preparingRef.current = false; setPreparing(false); }
    }
  };

  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={handleBack}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.topBar}>
          <TouchableOpacity accessibilityLabel="Close media preview" style={styles.roundButton} onPress={requestClose}><Ionicons name="close" size={24} color="#fff" /></TouchableOpacity>
          <View style={styles.selectionTitle}><Text style={styles.selectionTitleText}>{currentIndex + 1} of {images.length}</Text><Text style={styles.selectionSubtitle}>{current.kind === 'video' ? 'Video' : current.kind === 'file' ? 'Document' : 'Photo'}</Text></View>
          <TouchableOpacity disabled={preparing} accessibilityLabel="Remove selected media" style={styles.roundButton} onPress={() => remove(currentIndex)}><Ionicons name="trash-outline" size={21} color="#D8D0D4" /></TouchableOpacity>
        </View>
        <View style={styles.body} onLayout={event => { bodyHeight.value = event.nativeEvent.layout.height; }}>
        <Animated.View style={[styles.stage, stageStyle]}>
        <FlatList
          ref={listRef}
          data={images}
          horizontal
          pagingEnabled
          style={styles.pager}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          scrollEnabled={!timelineBusy && !preparing}
          extraData={currentIndex}
          getItemLayout={(_, index) => ({ index, length: screenWidth, offset: index * screenWidth })}
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => (
            <MediaSlideFrame width={screenWidth} height={stageHeight}>
              {item.kind === 'video'
                ? (
                  <VideoSlide
                    item={item}
                    active={index === currentIndex}
                    keyboardProgress={keyboardProgress}
                    onEdit={(edit) => updateVideoEdit(item.id, edit)}
                    onInteractingChange={setTimelineBusy}
                  />
                )
                : item.kind === 'file'
                  ? <View style={[styles.largeMedia, styles.filePreview]}><Ionicons name="document-text" size={64} color="#fff" /><Text style={styles.fileName}>{item.fileName ?? 'Document'}</Text></View>
                : <Pressable onPress={() => Keyboard.dismiss()} style={styles.photoStage}><PhotoEditPreview uri={item.currentUri} edit={item.imageEdit} width={mediaWidth} height={screenWidth} viewportHeight={mediaHeight} /></Pressable>}
            </MediaSlideFrame>
          )}
          onMomentumScrollEnd={(event) => setCurrentIndex(Math.min(images.length - 1, Math.max(0, Math.round(event.nativeEvent.contentOffset.x / screenWidth))))}
        />
        </Animated.View>

        {!(current.kind === 'video' && hasVideoEditing) ? (
          <Animated.View style={[styles.collapsing, toolbarStyle]}><View style={styles.toolBar}>
            {current.kind === 'image' ? (
              <>
                <TouchableOpacity accessibilityLabel="Crop photo" style={styles.tool} onPress={() => onCropPress(current.currentUri, currentIndex)} disabled={preparing}>
                  <Ionicons name="crop" size={23} color="#fff" />
                  <Text style={styles.toolText}>Crop</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityLabel="Rotate photo clockwise" style={styles.tool} onPress={rotate} disabled={preparing}>
                  <Ionicons name="refresh-outline" size={23} color="#fff" />
                  <Text style={styles.toolText}>Rotate</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityLabel="Flip photo horizontally" style={styles.tool} onPress={flip} disabled={preparing}>
                  <Ionicons name="swap-horizontal" size={23} color="#fff" />
                  <Text style={styles.toolText}>Flip</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityLabel="Reset photo edits" style={styles.tool} onPress={reset} disabled={preparing || (current.currentUri === current.originalUri && !hasPhotoEdit(current.imageEdit))}>
                  <Ionicons name="arrow-undo-outline" size={23} color={current.currentUri === current.originalUri && !hasPhotoEdit(current.imageEdit) ? '#777' : '#fff'} />
                  <Text style={[styles.toolText, current.currentUri === current.originalUri && !hasPhotoEdit(current.imageEdit) ? styles.toolTextDisabled : null]}>Reset</Text>
                </TouchableOpacity>
              </>
            ) : current.kind === 'video' ? (
              <View style={styles.videoHint}>
                <Ionicons name="videocam" size={19} color="#fff" />
                <Text style={styles.videoHintText}>Original video quality</Text>
              </View>
            ) : (
              <View style={styles.videoHint}>
                <Ionicons name="document-text" size={19} color="#fff" />
                <Text style={styles.videoHintText}>{current.fileName ?? 'PDF document'}</Text>
              </View>
            )}
          </View></Animated.View>
        ) : null}

        <Animated.View style={[styles.bottomPanel, bottomStyle]}>
          {preparing ? <Text style={styles.preparing} onLayout={event => { preparationHeight.value = event.nativeEvent.layout.height; }} accessibilityLiveRegion="polite">Preparing {preparedCount} of {images.length}…</Text> : null}
          <Animated.View style={[styles.collapsing, thumbnailStyle]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbnails}>
              {images.map((item, index) => (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.thumbnailCard, index === currentIndex ? styles.thumbnailCardActive : null]}
                  onPress={() => {
                    if (preparing) return;
                    setCurrentIndex(index);
                    listRef.current?.scrollToIndex({ index, animated: true });
                  }}
                >
                  <WorkspaceThumbnail item={item} />
                  <View style={styles.orderBadge}><Text style={styles.orderText}>{index + 1}</Text></View>
                </TouchableOpacity>
              ))}
              <TouchableOpacity disabled={preparing} accessibilityLabel="Add more media" style={styles.addCard} onPress={onAddMore}>
                <Ionicons name="add" size={25} color="#fff" />
              </TouchableOpacity>
            </ScrollView>
          </Animated.View>

          <View style={styles.captionRow} onLayout={event => { captionHeight.value = event.nativeEvent.layout.height; }}>
            <View style={styles.captionBox}>
              <Ionicons name="chatbox-outline" size={19} color="#AAA1A7" />
              <TextInput
                style={styles.captionInput}
                value={current.caption ?? ''}
                placeholder="Add a caption"
                placeholderTextColor={colors.text.secondary}
                multiline
                maxLength={2000}
                scrollEnabled
                editable={!preparing}
                accessibilityLabel="Photo or video caption"
                onChangeText={(caption) => setImages((values) => values.map(item => item.id === current.id ? { ...item, caption } : item))}
              />
            </View>
            <TouchableOpacity disabled={preparing} accessibilityLabel={preparing ? 'Preparing media' : `Send ${images.length} media items`} accessibilityState={{ busy: preparing, disabled: preparing }} style={[styles.sendButton, preparing && styles.disabled]} onPress={() => void send()}>
              <Ionicons name="arrow-up" size={25} color="#352329" />
              {images.length > 1 ? <View style={styles.sendCount}><Text style={styles.sendCountText}>{images.length}</Text></View> : null}
            </TouchableOpacity>
          </View>
        </Animated.View>
        </View>
      </View>
      <ConfirmDialog
        visible={discardConfirmation}
        title="Discard selected media?"
        message="Your selected files, edits, and captions will be removed. Nothing will be sent."
        cancelLabel="Keep editing"
        confirmLabel="Discard"
        destructive
        onCancel={() => setDiscardConfirmation(false)}
        onConfirm={close}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#100F0D' },
  body: { flex: 1 },
  stage: { overflow: 'hidden', backgroundColor: '#211F20' },
  collapsing: { overflow: 'hidden' },
  pager: { flex: 1 },
  photoStage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mediaSlide: { alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  mediaFrame: { flex: 1, width: '100%' },
  largeMedia: { width: '100%', height: '100%' },
  videoPreview: { flex: 1, alignSelf: 'stretch', marginHorizontal: MEDIA_SIDE_PADDING },
  videoEditor: { position: 'absolute', top: 0, width: '100%', backgroundColor: '#161314', paddingVertical: 8 },
  filePreview: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, backgroundColor: '#101012' },
  fileName: { color: '#fff', fontSize: 17, fontWeight: '600', marginTop: 14, textAlign: 'center' },
  topBar: {
    minHeight: 60, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', backgroundColor: '#100F0D',
  },
  roundButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#252124', alignItems: 'center', justifyContent: 'center' },
  selectionTitle: { alignItems: 'center', justifyContent: 'center', gap: 2 },
  selectionTitleText: { color: '#F8F3F6', fontSize: 14, fontWeight: '600' },
  selectionSubtitle: { color: '#A79CA3', fontSize: 11 },
  toolBar: { height: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', backgroundColor: '#161314' },
  tool: { minWidth: 64, minHeight: 52, justifyContent: 'center', alignItems: 'center', gap: 4 },
  toolText: { color: '#DDD5DA', fontSize: 11, fontWeight: '500' },
  toolTextDisabled: { color: '#777' },
  videoHint: { flexDirection: 'row', gap: 7, alignItems: 'center', paddingHorizontal: 13, height: 34, borderRadius: 17, backgroundColor: 'rgba(35,35,38,0.86)' },
  videoHintText: { color: '#fff', fontSize: 12 },
  bottomPanel: { paddingTop: 8, backgroundColor: '#161314' },
  thumbnails: { paddingHorizontal: 14, alignItems: 'center', gap: 8, height: 68 },
  thumbnailCard: { width: 56, height: 62, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', backgroundColor: '#242022' },
  thumbnailCardActive: { borderColor: '#F3C1CA' },
  thumbnail: { width: '100%', height: '100%' },
  thumbnailPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#2A2A2D' },
  orderBadge: { position: 'absolute', right: 3, top: 3, minWidth: 16, height: 16, paddingHorizontal: 3, borderRadius: 8, backgroundColor: '#F3C1CA', alignItems: 'center', justifyContent: 'center' },
  orderText: { color: '#352329', fontSize: 9, fontWeight: '700' },
  addCard: { width: 56, height: 58, borderRadius: 10, backgroundColor: '#2B2529', alignItems: 'center', justifyContent: 'center' },
  captionRow: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 8, gap: 9 },
  captionBox: { flex: 1, minHeight: 48, maxHeight: 112, borderRadius: 24, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#2A2528' },
  captionInput: { flex: 1, minHeight: 46, maxHeight: 104, paddingTop: 12, paddingBottom: 12, color: '#F8F3F6', fontSize: 15, lineHeight: 21, textAlignVertical: 'top' },
  sendButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F3C1CA', alignItems: 'center', justifyContent: 'center' },
  sendCount: { position: 'absolute', right: -1, top: -5, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, backgroundColor: '#51404A', alignItems: 'center', justifyContent: 'center' },
  sendCountText: { color: '#F8E7EE', fontSize: 9, fontWeight: '700' },
  preparing: { color: '#D6C4CD', fontSize: 12, paddingHorizontal: 16, paddingBottom: 6 },
  disabled: { opacity: 0.5 },
});
