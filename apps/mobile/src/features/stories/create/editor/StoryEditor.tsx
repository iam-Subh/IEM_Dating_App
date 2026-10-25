import { StoryShareVerifyLine } from '../../../verification/VerifyNudge';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { createAudioPlayer } from 'expo-audio';
import { requestPermissionsAsync, saveToLibraryAsync } from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { useSelector } from 'react-redux';
import { useNavigation } from '@react-navigation/native';
import { api } from '../../../../services/api';
import { CLOSE_FRIENDS_GREEN, storyAudienceApi, type StoryAudience } from '../../settings/storySettings';
import type { RootState } from '../../../../store';
import type { FrameLayer, Layer, LyricLine, MediaSource, StickerLayer, StoryDraftItem, TextLayer, Transform } from '../composition/types';
import { CANVAS, CENTER, MAX_SELECTION } from '../composition/types';
import { isLiveLayer, localId, newStoryItem, postedCount, storyDurationMs, toServerComposition, uuid, videoRange } from '../composition/story';
import { useStoryEditor } from '../composition/useStoryEditor';
import { STORY_BACKGROUNDS, STORY_FONT_SOURCES } from '../fonts';
import { STORY_FILTERS } from '../filters';
import { DraftLimitError, saveDraft } from '../drafts/draftStore';
import { captureDecorations, hasDecorations, postDirectory, renderOverlay, renderPhoto } from '../render/renderStory';
import { prepareStories, type RenderedStory } from '../publish/prepare';
import { shareDemo, sharePrepared } from '../publish/postingStore';
import { importPhoto } from '../import';
import { useStoryBack } from '../backStack';
import { registerStorySource } from '../../storySources';
import type { TrayStory } from '../../storyTypes';
import { STICKER_STYLES } from '../stickers/StickerView';
import { MusicStickerView } from '../stickers/MusicStickerView';
import { MediaCanvas } from './MediaCanvas';
import { StoryStripThumb } from './StoryShareSheet';
import { StoryGalleryPicker } from '../picker/StoryGalleryPicker';
import { cancelStoryShareRequest, createStoryShareRequest } from './storyShareRequests';
import { DrawingCanvas, emptyPicture, type LiveStroke } from './DrawingCanvas';
import { Skia, type SkPath, type SkPicture } from '@shopify/react-native-skia';
import { LayerContent } from './LayerContent';
import { StageLayer, type LayerSizes } from './StageLayer';
import { TextTool } from './TextTool';
import { DrawTool } from './DrawTool';
import { editorStageLayout } from './editorStageLayout';
import { StoryEditorToolbar, type StoryToolAction } from './StoryEditorToolbar';
import { StoryDiscardDialog } from './StoryDiscardDialog';
import { editorHasTopPanel, EDITOR_HEADER_HEIGHT, EDITOR_SHARE_HEIGHT } from './editorChromeLayout';
import { EDITABLE_STICKERS, StickerTray } from './StickerTray';
import { MusicSheet } from './MusicSheet';
import { TrimBar } from './TrimBar';
import { Eyedropper } from './Eyedropper';
import { ChatMedia, hasStoryTools, type PhotoEffect } from '../../../../../modules/chat-media';
import { BOOMERANG_STYLES, PHOTO_EFFECTS } from '../camera/boomerang';
import { transcribeAudio } from '../captions';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { filterById, isNeutral } from '../filters';

type Tool = 'none' | 'text' | 'draw' | 'stickers' | 'music' | 'duration' | 'trim' | 'effects';

type Props = {
  initialItems: StoryDraftItem[];
  draftId?: string | null;
  demo?: boolean;
  /** Opened from Create mode: start typing straight away. */
  openText?: boolean;
  /** Joining Add Yours Music: choose the song first. */
  openMusic?: boolean;
  onBack: () => void;
  onFinished: () => void;
};

type Feedback = { dragging: boolean; overBin: boolean; snapX: boolean; snapY: boolean };

const MUSIC_DEFAULT: Transform = { x: 540, y: 1400, scale: 1, rotation: 0 };
const SNAP = 14;
/** How far below the last text a new one is placed, in canvas units. */
const NEW_TEXT_STEP = 170;
/** How close to the bin's centre the finger must be to delete, in points. */
const BIN_RADIUS = 60;
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const feedbackFrom = (key: number): Feedback => ({ dragging: (key & 8) !== 0, snapX: (key & 1) !== 0, snapY: (key & 2) !== 0, overBin: (key & 4) !== 0 });

/**
 * The story editor: one page per selected photo or video, a 1080 × 1920 stage
 * with the media, drawing, text and stickers, Instagram's tools along the top,
 * and "Your story" to share. Sharing renders each page, saves a draft (kept
 * until everything has posted), and hands the batch to background posting.
 */
export function StoryEditor({ initialItems, draftId, demo, openText, openMusic, onBack, onFinished }: Props) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const user = useSelector((state: RootState) => state.auth.user);
  const avatar: string | null = user?.avatarUrl ?? user?.photos?.[0]?.photoUrl ?? user?.photos?.[0] ?? null;
  const navigation = useNavigation<any>();
  const editor = useStoryEditor(initialItems);
  const item = editor.current;
  const [tool, setTool] = useState<Tool>(openText ? 'text' : openMusic ? 'music' : 'none');
  const [editingText, setEditingText] = useState<TextLayer | null>(null);
  // The text open in the Text tool is drawn only there, never twice (Instagram).
  const editingId = tool === 'text' ? editingText?.id ?? null : null;
  // A placed sticker or frame reopened in the sticker tray.
  const [editingSticker, setEditingSticker] = useState<StickerLayer | FrameLayer | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(feedbackFrom(0));
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [discardVisible, setDiscardVisible] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const savingDraftRef = useRef(false);
  const discardExit = useRef<'discard' | 'saved' | null>(null);
  const [applyingEffect, setApplyingEffect] = useState(false);
  const [lyrics, setLyrics] = useState<LyricLine[] | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [fontsLoaded] = useFonts(STORY_FONT_SOURCES);
  // The stroke being drawn: built by the draw tool, drawn by the stage's canvas.
  const initialPath = useMemo(() => Skia.Path.Make(), []);
  const initialPicture = useMemo(() => emptyPicture(), []);
  const livePath = useSharedValue<SkPath>(initialPath);
  // The saved strokes as one picture, extended on the UI thread when a stroke ends.
  const committedDrawing = useSharedValue<SkPicture>(initialPicture);
  const [liveStroke, setLiveStroke] = useState<LiveStroke | null>(null);
  const captureRef = useRef<View>(null);
  const stageRef = useRef<View>(null);
  // The eyedropper's callback, while it is open.
  const [eyedropper, setEyedropper] = useState<((colour: string) => void) | null>(null);
  const openEyedropper = useCallback((apply: (colour: string) => void) => setEyedropper(() => apply), []);
  const [effectThumbs, setEffectThumbs] = useState<Record<string, { uri: string; ok: boolean }>>({});
  const thumbsFor = useRef<string | null>(null);
  const draftRef = useRef<string | null>(draftId ?? null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bottomBar = EDITOR_SHARE_HEIGHT;
  const expandedPanel = editorHasTopPanel(tool);
  const panelTop = insets.top + EDITOR_HEADER_HEIGHT;
  const stageLayout = editorStageLayout(screenWidth, screenHeight, insets.top, insets.bottom, tool === 'draw', expandedPanel);
  const { width: stageWidth, height: stageHeight, left: stageLeft, top: stageTop } = stageLayout.viewport;
  const { contentWidth, contentHeight, unit } = stageLayout;
  const gestureUnit = stageLayout.touchUnit;
  const binY = stageTop + stageHeight - 80;

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1400);
  }, []);

  const resetStory = useCallback(() => {
    if (busy || !editor.canReset) return;
    editor.resetCurrent();
    setTool('none');
    setEditingText(null);
    setEditingSticker(null);
    setEyedropper(null);
    setLiveStroke(null);
    livePath.value = Skia.Path.Make();
    showToast('Story reset');
  }, [busy, editor, livePath, showToast]);

  const requestClose = useCallback(() => {
    if (busy || savingDraftRef.current || discardExit.current) return;
    setDraftError(null);
    setDiscardVisible(true);
  }, [busy]);
  const keepEditing = useCallback(() => {
    if (savingDraftRef.current || discardExit.current) return;
    setDiscardVisible(false);
  }, []);
  const discardStory = useCallback(() => {
    if (savingDraftRef.current || discardExit.current) return;
    discardExit.current = 'discard';
    setDiscardVisible(false);
  }, []);
  const saveStoryDraft = useCallback(async () => {
    if (demo || savingDraftRef.current || discardExit.current) return;
    savingDraftRef.current = true;
    setSavingDraft(true);
    setDraftError(null);
    try {
      draftRef.current = await saveDraft(editor.items, draftRef.current);
      discardExit.current = 'saved';
      setDiscardVisible(false);
    } catch (error) {
      setDraftError(error instanceof DraftLimitError ? error.message : 'Could not save draft. Try again.');
    } finally {
      savingDraftRef.current = false;
      setSavingDraft(false);
    }
  }, [demo, editor.items]);
  const finishDiscardDialog = useCallback(() => {
    const action = discardExit.current;
    discardExit.current = null;
    if (action === 'discard') onBack();
    else if (action === 'saved') onFinished();
  }, [onBack, onFinished]);

  // Back closes an open tool first, then asks before leaving the editor.
  useStoryBack(() => {
    if (busy || savingDraftRef.current || discardExit.current) return true;
    if (discardVisible) {
      keepEditing();
      return true;
    }
    if (tool !== 'none') {
      setTool('none');
      return true;
    }
    requestClose();
    return true;
  });

  // Lyrics for the music sticker.
  const musicTrackId = item?.music?.trackId;
  const musicDisplay = item?.music?.display;
  useEffect(() => {
    let active = true;
    setLyrics(null);
    if (!musicTrackId || musicDisplay !== 'lyrics') return;
    api.get(`/stories/music/${musicTrackId}/lyrics`).then((response) => { if (active) setLyrics(response.data.data.lines ?? []); }).catch(() => undefined);
    return () => { active = false; };
  }, [musicDisplay, musicTrackId]);

  // The song loops over the story while editing, as on Instagram.
  const musicOpen = tool === 'music' || discardVisible || savingDraft;
  useEffect(() => {
    const music = item?.music;
    if (!music || musicOpen || !music.track.streams.preview) return;
    const player = createAudioPlayer({ uri: music.track.streams.preview });
    player.volume = music.musicVolume ?? 1;
    player.seekTo(music.startMs / 1000).catch(() => undefined);
    player.play();
    const timer = setInterval(() => {
      const offset = player.currentTime * 1000 - music.startMs;
      if (offset >= music.lengthMs || offset < -800) {
        player.seekTo(music.startMs / 1000).catch(() => undefined);
        setPlayhead(0);
      } else {
        setPlayhead(Math.max(0, offset));
      }
    }, 150);
    return () => {
      clearInterval(timer);
      player.pause();
      player.remove();
    };
    // Restart only when the song or its clip changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.music?.trackId, item?.music?.startMs, item?.music?.lengthMs, musicOpen]);

  // --- The stage's transforms, on the UI thread --------------------------------------------
  const transforms = useSharedValue<Record<string, Transform>>({});
  const sizes = useSharedValue<LayerSizes>({});
  const order = useSharedValue<string[]>([]);
  const mediaX = useSharedValue(540);
  const mediaY = useSharedValue(960);
  const mediaScale = useSharedValue(1);
  const mediaRotation = useSharedValue(0);
  const mediaLocked = useSharedValue(false);
  const target = useSharedValue('');
  const origin = useSharedValue<Transform>({ x: 540, y: 960, scale: 1, rotation: 0 });
  const gestureX = useSharedValue(0);
  const gestureY = useSharedValue(0);
  const gestureScale = useSharedValue(1);
  const gestureRotation = useSharedValue(0);
  const twoFingers = useSharedValue(false);
  const activeCount = useSharedValue(0);
  const panStarted = useSharedValue(false);
  const pinchStarted = useSharedValue(false);
  const rotateStarted = useSharedValue(false);
  const dragging = useSharedValue<string | null>(null);
  const overBin = useSharedValue(false);
  const feedbackKey = useSharedValue(0);

  const decorative = useMemo(() => item?.layers.filter((layer) => !isLiveLayer(layer)) ?? [], [item?.layers]);
  const interactive = useMemo(() => item?.layers.filter(isLiveLayer) ?? [], [item?.layers]);
  const showMusic = !!item?.music && item.music.display !== 'hidden';

  // The story is the source of truth; the shared values follow it between gestures.
  useLayoutEffect(() => {
    if (!item || activeCount.value > 0) return;
    const next: Record<string, Transform> = {};
    for (const layer of item.layers) next[layer.id] = layer.kind === 'sticker' ? layer.sticker.transform : layer.transform;
    if (item.music) next.music = item.music.transform ?? MUSIC_DEFAULT;
    transforms.value = next;
    order.value = [...decorative.map((layer) => layer.id), ...interactive.map((layer) => layer.id), ...(showMusic ? ['music'] : [])];
    mediaX.value = item.mediaTransform.x;
    mediaY.value = item.mediaTransform.y;
    mediaScale.value = item.mediaTransform.scale;
    mediaRotation.value = item.mediaTransform.rotation;
    mediaLocked.value = !!item.media.locked;
  }, [activeCount, decorative, interactive, item, mediaLocked, mediaRotation, mediaScale, mediaX, mediaY, order, showMusic, transforms]);

  // Everything a gesture calls goes through this ref, so the gesture is built
  // once and a re-render during a drag never cancels it.
  const latest = useRef({ editor, item });
  latest.current = { editor, item };

  const openNewText = useCallback(() => {
    setEditingText(null);
    setTool('text');
  }, []);
  const cycleFilter = useCallback((direction: number) => {
    const current = latest.current.item;
    if (!current) return;
    const index = STORY_FILTERS.findIndex((filter) => filter.id === current.filterId);
    const next = STORY_FILTERS[(index + direction + STORY_FILTERS.length) % STORY_FILTERS.length];
    latest.current.editor.updateCurrent({ filterId: next.id });
    showToast(next.name);
  }, [showToast]);
  const commitMedia = useCallback((x: number, y: number, scale: number, rotation: number) => {
    latest.current.editor.updateCurrent({ mediaTransform: { x, y, scale, rotation } });
  }, []);
  const commitLayer = useCallback((layerId: string, x: number, y: number, scale: number, rotation: number) => {
    const { editor: current } = latest.current;
    const transform = { x, y, scale, rotation };
    if (layerId === 'music') {
      current.updateCurrent((entry) => ({ music: entry.music ? { ...entry.music, transform } : null }));
      return;
    }
    current.updateLayer(layerId, (layer) => (layer.kind === 'sticker' ? { sticker: { ...layer.sticker, transform } } : { transform }) as Partial<Layer>);
    current.bringToFront(layerId);
  }, []);
  const deleteLayer = useCallback((layerId: string) => {
    const { editor: current } = latest.current;
    if (layerId === 'music') current.updateCurrent({ music: null });
    else current.removeLayer(layerId);
  }, []);
  const tapAt = useCallback((layerId: string) => {
    const { editor: current, item: entry } = latest.current;
    if (!layerId) {
      openNewText();
      return;
    }
    if (layerId === 'music') {
      setTool('music');
      return;
    }
    const layer = entry?.layers.find((candidate) => candidate.id === layerId);
    if (!layer) return;
    if (layer.kind === 'text') {
      setEditingText(layer);
      setTool('text');
    } else if (layer.kind === 'sticker' && EDITABLE_STICKERS.has(layer.sticker.type)) {
      // Opens the sticker's creator filled in: its text, options and colour can all be changed.
      setEditingSticker(layer);
      setTool('stickers');
    } else if (layer.kind === 'frame') {
      setEditingSticker(layer);
      setTool('stickers');
    } else if (layer.kind === 'sticker') {
      const index = STICKER_STYLES.indexOf(layer.sticker.style);
      current.updateLayer(layer.id, { sticker: { ...layer.sticker, style: STICKER_STYLES[(index + 1) % STICKER_STYLES.length] } } as Partial<Layer>);
    } else if (layer.kind === 'time') {
      current.updateLayer(layer.id, { style: ((layer.style + 1) % 3) as 0 | 1 | 2 } as Partial<Layer>);
    } else if (layer.kind === 'photo' && layer.shape !== 'cutout') {
      // A cutout has no frame to reshape.
      const shapes = ['rounded', 'circle', 'square'] as const;
      current.updateLayer(layer.id, { shape: shapes[(shapes.indexOf(layer.shape) + 1) % shapes.length] } as Partial<Layer>);
    }
  }, [openNewText]);
  const showFeedback = useCallback((key: number) => setFeedback(feedbackFrom(key)), []);

  const gesturesEnabled = tool === 'none' && !busy && !discardVisible && !savingDraft;
  const stageGesture = useMemo(() => {
    const hitTest = (px: number, py: number) => {
      'worklet';
      const ids = order.value;
      for (let index = ids.length - 1; index >= 0; index -= 1) {
        const id = ids[index];
        const t = transforms.value[id];
        const s = sizes.value[id];
        if (!t || !s) continue;
        const dx = px - t.x;
        const dy = py - t.y;
        const angle = (-t.rotation * Math.PI) / 180;
        const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
        const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
        // A little extra around small stickers, so they are easy to grab.
        const pad = 30 / Math.max(0.5, t.scale);
        if (Math.abs(localX) <= (s.w / 2 + pad) * t.scale && Math.abs(localY) <= (s.h / 2 + pad) * t.scale) return id;
      }
      return null;
    };

    const begin = () => {
      'worklet';
      if (activeCount.value === 0) {
        const id = target.value || 'media';
        target.value = id;
        origin.value = id === 'media'
          ? { x: mediaX.value, y: mediaY.value, scale: mediaScale.value, rotation: mediaRotation.value }
          : (transforms.value[id] ?? { x: 540, y: 960, scale: 1, rotation: 0 });
        gestureX.value = 0;
        gestureY.value = 0;
        gestureScale.value = 1;
        gestureRotation.value = 0;
        twoFingers.value = false;
      }
      activeCount.value += 1;
    };

    const apply = () => {
      'worklet';
      const id = target.value;
      const start = origin.value;
      if (id === 'media') {
        // A Create-mode background stays where it is.
        if (mediaLocked.value) return;
        // One finger on the media swipes filters; two move it.
        const moveX = twoFingers.value ? gestureX.value : 0;
        const moveY = twoFingers.value ? gestureY.value : 0;
        mediaX.value = start.x + moveX / gestureUnit;
        mediaY.value = start.y + moveY / gestureUnit;
        mediaScale.value = Math.max(0.2, Math.min(10, start.scale * gestureScale.value));
        mediaRotation.value = start.rotation + gestureRotation.value;
        return;
      }
      let x = start.x + gestureX.value / gestureUnit;
      let y = start.y + gestureY.value / gestureUnit;
      const snapX = Math.abs(x - CANVAS.width / 2) < SNAP;
      const snapY = Math.abs(y - CANVAS.height / 2) < SNAP;
      if (snapX) x = CANVAS.width / 2;
      if (snapY) y = CANVAS.height / 2;
      let rotation = start.rotation + gestureRotation.value;
      const straight = Math.round(rotation / 90) * 90;
      if (Math.abs(rotation - straight) < 4) rotation = straight;
      const scale = Math.max(0.15, Math.min(12, start.scale * gestureScale.value));
      transforms.modify((all) => {
        'worklet';
        all[id] = { x, y, scale, rotation };
        return all;
      });
      const key = 8 + (snapX ? 1 : 0) + (snapY ? 2 : 0) + (overBin.value ? 4 : 0);
      if (key !== feedbackKey.value) {
        feedbackKey.value = key;
        runOnJS(showFeedback)(key);
      }
    };

    const end = () => {
      'worklet';
      activeCount.value = Math.max(0, activeCount.value - 1);
      if (activeCount.value > 0) return;
      const id = target.value;
      if (id === 'media') {
        const moved = !mediaLocked.value && (twoFingers.value || Math.abs(gestureScale.value - 1) > 0.001 || Math.abs(gestureRotation.value) > 0.1);
        if (moved) {
          runOnJS(commitMedia)(mediaX.value, mediaY.value, mediaScale.value, mediaRotation.value);
        } else if (Math.abs(gestureX.value) > 60 && Math.abs(gestureX.value) > Math.abs(gestureY.value) * 1.5) {
          runOnJS(cycleFilter)(gestureX.value < 0 ? 1 : -1);
        }
      } else if (id) {
        if (overBin.value) {
          runOnJS(deleteLayer)(id);
        } else {
          const t = transforms.value[id];
          if (t) runOnJS(commitLayer)(id, t.x, t.y, t.scale, t.rotation);
        }
      }
      target.value = '';
      overBin.value = false;
      dragging.value = null;
      if (feedbackKey.value !== 0) {
        feedbackKey.value = 0;
        runOnJS(showFeedback)(0);
      }
    };

    const pan = Gesture.Pan()
      .enabled(gesturesEnabled)
      .averageTouches(true)
      .minDistance(3)
      .onTouchesDown((event) => {
        if (activeCount.value > 0 || event.numberOfTouches !== 1) return;
        const touch = event.allTouches[0];
        target.value = hitTest(touch.x / gestureUnit, touch.y / gestureUnit) ?? 'media';
      })
      .onStart(() => {
        begin();
        panStarted.value = true;
        if (target.value !== 'media') dragging.value = target.value;
      })
      .onUpdate((event) => {
        gestureX.value = event.translationX;
        gestureY.value = event.translationY;
        if (event.numberOfPointers >= 2) twoFingers.value = true;
        if (target.value !== 'media') {
          // Only right at the bin: a circle about its own size once it grows under
          // the finger. The old band reached far above it and deleted by surprise.
          const binDx = event.x - stageWidth / 2;
          const binDy = event.y - (stageHeight - 80);
          overBin.value = binDx * binDx + binDy * binDy < BIN_RADIUS * BIN_RADIUS;
        }
        apply();
      })
      .onFinalize(() => {
        if (!panStarted.value) return;
        panStarted.value = false;
        end();
      });

    const pinch = Gesture.Pinch()
      .enabled(gesturesEnabled)
      .onStart(() => {
        begin();
        pinchStarted.value = true;
        twoFingers.value = true;
      })
      .onUpdate((event) => {
        gestureScale.value = event.scale;
        apply();
      })
      .onFinalize(() => {
        if (!pinchStarted.value) return;
        pinchStarted.value = false;
        end();
      });

    const rotate = Gesture.Rotation()
      .enabled(gesturesEnabled)
      .onStart(() => {
        begin();
        rotateStarted.value = true;
        twoFingers.value = true;
      })
      .onUpdate((event) => {
        gestureRotation.value = (event.rotation * 180) / Math.PI;
        apply();
      })
      .onFinalize(() => {
        if (!rotateStarted.value) return;
        rotateStarted.value = false;
        end();
      });

    const tap = Gesture.Tap()
      .enabled(gesturesEnabled)
      .maxDuration(250)
      .onEnd((event) => {
        runOnJS(tapAt)(hitTest(event.x / gestureUnit, event.y / gestureUnit) ?? '');
      });

    return Gesture.Exclusive(Gesture.Simultaneous(pan, pinch, rotate), tap);
    // Shared values and stable callbacks only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gesturesEnabled, stageHeight, stageWidth, gestureUnit]);

  const renderAll = useCallback(async (batchId: string) => {
    const dir = await postDirectory(batchId);
    const rendered: RenderedStory[] = [];
    for (let index = 0; index < editor.items.length; index += 1) {
      let entry = editor.items[index];
      setBusy(editor.items.length > 1 ? `Preparing ${index + 1} of ${editor.items.length}…` : 'Preparing…');
      if (entry.media.kind === 'photo' && entry.media.raw) {
        // Camera photos open at once; their orientation is applied now.
        const media = await importPhoto(entry.media.uri, true);
        entry = { ...entry, media };
        editor.updateItem(entry.id, { media }, { record: false });
      }
      editor.setIndex(index);
      await nextFrame();
      // Photo stickers and GIFs load asynchronously; give them a moment to draw.
      await wait(entry.layers.some((layer) => layer.kind === 'photo' || layer.kind === 'gif' || layer.kind === 'frame') ? 450 : 120);
      const decorations = hasDecorations(entry) ? await captureDecorations(captureRef) : null;
      if (entry.media.kind === 'photo') {
        rendered.push({ item: entry, photo: await renderPhoto(entry, decorations, `${dir}${entry.id}.jpg`) });
      } else {
        rendered.push({ item: entry, overlayUri: decorations ? (await renderOverlay(decorations, `${dir}${entry.id}.png`)).uri : null });
      }
    }
    return rendered;
  }, [editor]);

  const shareRequest = useRef<string | null>(null);
  useEffect(() => () => {
    if (shareRequest.current) cancelStoryShareRequest(shareRequest.current);
  }, []);
  // The Close Friends list, over the editor. After Done, tapping Close Friends again shares.
  const openCloseFriends = useCallback(() => {
    if (demo) return;
    navigation.navigate('StoryAudienceList', { list: 'close_friends' });
  }, [demo, navigation]);

  const share = useCallback(async (audience: StoryAudience = 'followers') => {
    if (busy || !editor.items.length) return;
    const needsSong = editor.items.some((entry) => !entry.music && entry.layers.some((layer) => layer.kind === 'sticker' && layer.sticker.type === 'addYours' && layer.sticker.music));
    if (needsSong) {
      showToast('Add a song for Add Yours Music');
      return;
    }
    if (audience === 'close_friends' && !demo) {
      // A Close Friends story needs a list, and can only mention people on it.
      let closeFriends: Set<string>;
      try {
        closeFriends = await storyAudienceApi.closeFriendIds();
      } catch {
        showToast('No connection. Try again');
        return;
      }
      if (!closeFriends.size) {
        openCloseFriends();
        return;
      }
      const mentions = editor.items.flatMap((entry) => entry.layers.flatMap((layer) => (
        layer.kind === 'sticker' && layer.sticker.type === 'mention' ? [layer.sticker] : []
      )));
      const outside = [...new Set(mentions.filter((sticker) => !closeFriends.has(sticker.userId)).map((sticker) => sticker.name))];
      if (outside.length) {
        Alert.alert(
          "Can't share to Close Friends",
          `${outside.join(', ')} ${outside.length === 1 ? "isn't" : "aren't"} on your Close Friends list, so they couldn't see a story that mentions them. Remove the mention or share to Your story.`,
        );
        return;
      }
    }
    setTool('none');
    try {
      const batchId = demo ? `demo-${uuid()}` : uuid();
      const rendered = await renderAll(batchId);
      if (demo) {
        const now = Date.now();
        shareDemo({
          audience,
          items: rendered.map((entry) => entry.item),
          toTrayStory: (_entry, index): TrayStory => {
            const { item: story, photo } = rendered[index];
            const id = `demo-me-${now}-${index}`;
            const url = photo?.uri ?? story.media.uri;
            const contentType = story.media.kind === 'photo' ? 'image/jpeg' : 'video/mp4';
            registerStorySource(id, { url, thumbnailUrl: null, contentType, expiresAt: Number.MAX_SAFE_INTEGER });
            return {
              id, ownerId: 'demo-me', contentType, caption: null, publishedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 24 * 3_600_000).toISOString(), seen: true, liked: false, viewCount: 0, likeCount: 0,
              durationMs: storyDurationMs(story), composition: toServerComposition(story), mediaUrl: url, audience,
            };
          },
        });
        onFinished();
        return;
      }
      setBusy('Preparing…');
      const items = rendered.map((entry) => entry.item);
      const draft = await saveDraft(items, draftRef.current).catch(() => draftRef.current);
      const stories = await prepareStories(batchId, rendered);
      sharePrepared({ batchId, stories, draftId: draft, coverUri: rendered[0]?.photo?.uri ?? items[0]?.media.uri ?? null, audience });
      onFinished();
    } catch (error: any) {
      setBusy(null);
      Alert.alert('Could not prepare your story', error?.message ?? 'Try again.');
    }
  }, [busy, demo, editor.items, onFinished, openCloseFriends, renderAll]);

  // The + at the end of the strip: more picks, up to ten stories in all.
  const [adding, setAdding] = useState(false);
  const canAddMore = editor.items.length < MAX_SELECTION;
  const addMedia = useCallback((media: MediaSource[]) => {
    setAdding(false);
    const room = MAX_SELECTION - editor.items.length;
    const added = media.slice(0, Math.max(0, room)).map((entry) => newStoryItem(entry));
    if (!added.length) return;
    const first = editor.items.length;
    editor.setItems((list) => [...list, ...added]);
    editor.setIndex(first);
  }, [editor]);

  const openShareSheet = () => {
    if (busy || shareRequest.current) return;
    const requestId = createStoryShareRequest({
      count: editor.items.length,
      avatar: avatar ?? null,
      canEditCloseFriends: !demo,
      onResult: choice => {
        shareRequest.current = null;
        if (choice === 'edit_close_friends') openCloseFriends();
        else if (choice) void share(choice);
      },
    });
    shareRequest.current = requestId;
    navigation.navigate('StoryShareOptions', { requestId });
  };

  const saveToDevice = useCallback(async () => {
    if (!item || busy) return;
    const isPhoto = item.media.kind === 'photo';
    if (!isPhoto && !(hasStoryTools && ChatMedia)) {
      showToast('Update the app to save edited videos');
      return;
    }
    const permission = await requestPermissionsAsync(true, [isPhoto ? 'photo' : 'video']).catch(() => null);
    if (!permission?.granted) {
      showToast('Allow gallery access to save');
      return;
    }
    setBusy('Saving…');
    try {
      if (isPhoto) {
        const entry = item.media.raw ? { ...item, media: await importPhoto(item.media.uri, true) } : item;
        const decorations = hasDecorations(entry) ? await captureDecorations(captureRef) : null;
        const path = `${FileSystem.cacheDirectory}story-save-${Date.now()}.jpg`;
        const photo = await renderPhoto(entry, decorations, path);
        await saveToLibraryAsync(photo.uri);
      } else {
        // The whole edited video, as it would post, in one file.
        const decorations = hasDecorations(item) ? await captureDecorations(captureRef) : null;
        const overlay = decorations ? await renderOverlay(decorations, `${FileSystem.cacheDirectory}story-save-${Date.now()}.png`) : null;
        const range = videoRange(item);
        const filter = filterById(item.filterId).params;
        const stream = item.music?.track.streams.standard ?? item.music?.track.streams.preview ?? null;
        const uri = await ChatMedia!.saveStoryVideo({
          itemId: uuid(),
          kind: 'video',
          sourceUri: item.media.uri,
          clipStartMs: range.startMs,
          clipEndMs: range.endMs,
          muted: item.muted,
          filter: isNeutral(filter) ? null : filter,
          transform: item.mediaTransform,
          fitMode: item.fitMode,
          background: item.background,
          overlayUri: overlay?.uri ?? null,
          music: item.music && stream
            ? { url: stream, startMs: item.music.startMs, lengthMs: range.lengthMs, videoVolume: item.music.videoVolume ?? 1, musicVolume: item.music.musicVolume ?? 1 }
            : null,
        });
        await saveToLibraryAsync(uri);
      }
      showToast('Saved');
    } catch {
      showToast('Could not save');
    } finally {
      setBusy(null);
    }
  }, [busy, item, showToast]);

  const applyEffect = useCallback(async (effect: PhotoEffect | 'none') => {
    if (!item || busy || item.media.kind !== 'photo' || !ChatMedia) return;
    if ((item.media.effect ?? 'none') === effect) return;
    setApplyingEffect(true);
    setBusy(effect === 'none' ? 'Removing effect…' : 'Applying effect…');
    try {
      let original = item.media.original;
      if (!original) {
        const base = item.media.raw ? await importPhoto(item.media.uri, true) : item.media;
        original = { uri: base.uri, width: base.width, height: base.height };
      }
      if (effect === 'none') {
        editor.updateCurrent({ media: { ...item.media, ...original, raw: false, effect: undefined, original: undefined } });
      } else {
        const result = await ChatMedia.applyPhotoEffect(original.uri, effect);
        editor.updateCurrent({ media: { ...item.media, uri: result.uri, width: result.width, height: result.height, raw: false, effect, original } });
      }
    } catch (error: any) {
      showToast(/face/i.test(error?.message ?? '') ? 'No face found in this photo' : 'Could not apply the effect');
    } finally {
      setBusy(null);
      setApplyingEffect(false);
    }
  }, [busy, editor, item, showToast]);

  // Effect previews: each effect run on a small copy of the photo, once per photo.
  const effectsOpen = tool === 'effects' && item?.media.kind === 'photo';
  const effectsBase = item?.media.original?.uri ?? item?.media.uri ?? null;
  useEffect(() => {
    if (!effectsOpen || !effectsBase || !ChatMedia || thumbsFor.current === effectsBase) return;
    thumbsFor.current = effectsBase;
    setEffectThumbs({});
    let active = true;
    let finished = false;
    (async () => {
      const rendered = await ImageManipulator.manipulate(effectsBase).resize({ width: 480 }).renderAsync();
      const small = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
      if (!active) return;
      setEffectThumbs({ none: { uri: small.uri, ok: true } });
      for (const entry of PHOTO_EFFECTS) {
        if (entry.id === 'none') continue;
        const result = await ChatMedia!.applyPhotoEffect(small.uri, entry.id).catch(() => null);
        if (!active) return;
        setEffectThumbs((current) => ({ ...current, [entry.id]: { uri: result?.uri ?? small.uri, ok: !!result } }));
      }
      finished = true;
    })().catch(() => undefined);
    return () => {
      active = false;
      // Closed part-way: make them again next time.
      if (!finished) thumbsFor.current = null;
    };
  }, [effectsBase, effectsOpen]);

  const cycleBoomerang = useCallback(async () => {
    const boomerang = item?.media.boomerang;
    if (!item || !boomerang || busy || !ChatMedia) return;
    const index = BOOMERANG_STYLES.findIndex((entry) => entry.id === boomerang.style);
    const next = BOOMERANG_STYLES[(index + 1) % BOOMERANG_STYLES.length];
    setBusy(`Making ${next.name}…`);
    try {
      const result = await ChatMedia.makeBoomerang(boomerang.sourceUri, next.id);
      editor.updateCurrent({
        media: { ...item.media, uri: result.uri, width: result.width, height: result.height, durationMs: result.durationMs, boomerang: { ...boomerang, style: next.id } },
        trim: null,
      });
      showToast(next.name);
    } catch {
      showToast('Could not change the Boomerang');
    } finally {
      setBusy(null);
    }
  }, [busy, editor, item, showToast]);

  const generateCaptions = useCallback(async () => {
    if (!item || busy || item.media.kind !== 'video') return;
    if (demo) {
      showToast('Captions work on posted stories');
      return;
    }
    if (!ChatMedia || !hasStoryTools) {
      showToast('Update the app to use captions');
      return;
    }
    if (item.muted || item.media.hasAudio === false) {
      showToast('This video has no sound to caption');
      return;
    }
    setBusy('Making captions…');
    try {
      const range = videoRange(item);
      const audio = await ChatMedia.extractAudio(item.media.uri, range.startMs, range.endMs);
      const segments = await transcribeAudio(audio).finally(() => FileSystem.deleteAsync(audio, { idempotent: true }).catch(() => undefined));
      if (!segments.length) {
        showToast('No speech found');
        return;
      }
      const existing = item.layers.find((layer) => layer.kind === 'sticker' && layer.sticker.type === 'captions');
      const id = existing?.id ?? localId('s');
      const transform = existing?.kind === 'sticker' ? existing.sticker.transform : { ...CENTER, y: 1480 };
      const layer: Layer = { id, kind: 'sticker', sticker: { id, type: 'captions', style: 'default', segments, transform } };
      if (existing) editor.updateLayer(id, layer);
      else editor.addLayer(layer);
    } catch (error: any) {
      const code = error?.response?.data?.code ?? error?.response?.data?.error?.code;
      showToast(code === 'CAPTIONS_UNAVAILABLE' ? 'Captions are not available right now' : code === 'CAPTIONS_LIMIT' ? 'Too many captions today' : 'Could not make captions');
    } finally {
      setBusy(null);
    }
  }, [busy, demo, editor, item, showToast]);

  if (!item) return <View style={styles.root} />;

  const range = videoRange(item);
  const chromeHidden = feedback.dragging || tool === 'text' || tool === 'draw' || tool === 'stickers' || tool === 'music' || (!!busy && !applyingEffect);
  const total = postedCount(editor.items);
  const layerProps = { unit, transforms, sizes, dragging, overBin };
  const primaryTools: StoryToolAction[] = [
    { id: 'text', icon: 'text', label: 'Text', onPress: openNewText },
    { id: 'stickers', icon: 'sticker', label: 'Stickers', onPress: () => { setEditingSticker(null); setTool('stickers'); } },
    { id: 'music', icon: 'music', label: 'Music', selected: !!item.music, onPress: () => setTool('music') },
    { id: 'draw', icon: 'draw', label: 'Draw', onPress: () => setTool('draw') },
    { id: 'filters', icon: 'filter', label: 'Filters', accessibilityLabel: 'Next filter', selected: !isNeutral(filterById(item.filterId).params), onPress: () => cycleFilter(1) },
  ];
  const secondaryTools: StoryToolAction[] = item.media.kind === 'photo' ? [
    { id: 'duration', icon: 'duration', label: 'Length', accessibilityLabel: 'Photo duration', value: `${Math.round(storyDurationMs(item) / 1000)}s`, onPress: () => setTool('duration') },
    ...(hasStoryTools && !item.media.locked ? [{ id: 'effects', icon: 'effects' as const, label: 'Effects', selected: !!item.media.effect, onPress: () => setTool('effects') }] : []),
  ] : [
    { id: 'trim', icon: 'trim', label: 'Trim', accessibilityLabel: 'Trim video', onPress: () => setTool('trim') },
    { id: 'captions', icon: 'captions', label: 'Captions', accessibilityLabel: 'Auto captions', onPress: () => void generateCaptions() },
    ...(item.media.boomerang ? [{ id: 'loop', icon: 'loop' as const, label: 'Loop', accessibilityLabel: 'Boomerang style', onPress: () => void cycleBoomerang() }] : []),
    { id: 'sound', icon: item.muted ? 'mute' : 'sound', label: item.muted ? 'Sound off' : 'Sound on', accessibilityLabel: item.muted ? 'Turn sound on' : 'Mute', selected: !item.muted, onPress: () => editor.updateCurrent({ muted: !item.muted }) },
  ];
  if (item.fitMode === 'contain' || item.mediaTransform.scale < 1) secondaryTools.push({
    id: 'background', icon: 'background', label: 'Colour', accessibilityLabel: 'Background colour',
    onPress: () => {
      const index = STORY_BACKGROUNDS.findIndex(colours => colours.join() === item.background.join());
      editor.updateCurrent({ background: STORY_BACKGROUNDS[(index + 1) % STORY_BACKGROUNDS.length] });
    },
  });

  return (
    <View style={styles.root}>
      <GestureDetector gesture={stageGesture}>
        <View ref={stageRef} collapsable={false} style={[styles.stage, { top: stageTop, left: stageLeft, width: stageWidth, height: stageHeight }]}>
          <View style={{ position: 'absolute', left: 0, top: 0, width: contentWidth, height: contentHeight, transformOrigin: [0, 0, 0], transform: [{ scale: stageLayout.scale }] }} collapsable={false}>
            <MediaCanvas
              item={item}
              width={contentWidth}
              height={contentHeight}
              playing={!busy && !discardVisible && !savingDraft}
              transform={{ x: mediaX, y: mediaY, scale: mediaScale, rotation: mediaRotation }}
            />

            {/* Baked into the uploaded media: captured as one transparent image. */}
            <View ref={captureRef} collapsable={false} pointerEvents="none" style={StyleSheet.absoluteFill}>
              <DrawingCanvas
                strokes={item.drawing}
                unit={unit}
                width={contentWidth}
                height={contentHeight}
                committed={committedDrawing}
                live={livePath}
                liveStroke={tool === 'draw' ? liveStroke : null}
              />
              {fontsLoaded ? decorative.map((layer) => (
                <StageLayer key={layer.id} id={layer.id} {...layerProps} hidden={layer.id === editingId}><LayerContent layer={layer} unit={unit} /></StageLayer>
              )) : null}
            </View>

            {/* Sent as data and drawn live by the viewer. */}
            {interactive.map((layer) => (
              <StageLayer key={layer.id} id={layer.id} {...layerProps} hidden={layer.id === editingId}><LayerContent layer={layer} unit={unit} /></StageLayer>
            ))}
            {showMusic && item.music ? (
              <StageLayer key={`music-${item.music.trackId}-${item.music.display}`} id="music" {...layerProps}>
                <MusicStickerView music={item.music} unit={unit} lines={lyrics} timeMs={playhead} />
              </StageLayer>
            ) : null}

            {feedback.snapX ? <View pointerEvents="none" style={[styles.guideV, { left: contentWidth / 2 - 0.5 }]} /> : null}
            {feedback.snapY ? <View pointerEvents="none" style={[styles.guideH, { top: contentHeight / 2 - 0.5 }]} /> : null}
          </View>
        </View>
      </GestureDetector>

      {feedback.dragging ? (
        <View pointerEvents="none" style={[styles.bin, { top: binY - 28, left: screenWidth / 2 - 28 }, feedback.overBin && styles.binActive]}>
          <Ionicons name="trash-outline" size={feedback.overBin ? 30 : 24} color="#fff" />
        </View>
      ) : null}

      {!chromeHidden ? (
        <>
          <StoryEditorToolbar top={insets.top} viewport={stageLayout.viewport} activeTool={tool} onHint={showToast} disabled={!!busy}
            onClose={requestClose} onUndo={editor.undo} canUndo={editor.canUndo}
            onReset={resetStory} canReset={editor.canReset}
            onSave={() => void saveToDevice()} primary={primaryTools} secondary={secondaryTools}
            duration={item.media.kind === 'photo' ? {
              value: storyDurationMs(item), musicLocked: !!item.music,
              onChange: ms => editor.updateCurrent({ photoDurationMs: ms }), onClose: () => setTool('none'),
            } : undefined}
            effects={item.media.kind === 'photo' && hasStoryTools && !item.media.locked ? {
              value: item.media.effect ?? 'none', baseUri: effectsBase ?? item.media.uri, previews: effectThumbs, busy: applyingEffect,
              onChange: effect => void applyEffect(effect), onClose: () => setTool('none'),
            } : undefined} />

          <StoryShareVerifyLine bottom={insets.bottom + bottomBar} />
          <View style={[styles.bottomBar, { bottom: insets.bottom, height: bottomBar }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} style={{ flex: 1 }}>
              {editor.items.length > 1 ? editor.items.map((entry, index) => (
                <StoryStripThumb key={entry.id} kind={entry.media.kind} uri={entry.media.uri} index={index}
                  active={index === editor.index} disabled={!!busy}
                  onSelect={() => editor.setIndex(index)} onRemove={() => editor.removeItem(entry.id)} />
              )) : null}
              {/* More photos or videos, up to ten in all. */}
              {canAddMore ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Add photos or videos, ${MAX_SELECTION - editor.items.length} more allowed`}
                  disabled={!!busy} onPress={() => setAdding(true)} style={({ pressed }) => [styles.addThumb, pressed && styles.closeFriendsPressed]}>
                  <Ionicons name="add" size={22} color="#fff" />
                </Pressable>
              ) : null}
            </ScrollView>
            {/* Several stories: one Next, then where they go (StoryShareSheet). */}
            {editor.items.length > 1 ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Next, share ${editor.items.length} stories`} disabled={!!busy}
                onPress={openShareSheet} style={({ pressed }) => [styles.share, styles.next, pressed && styles.closeFriendsPressed]}>
                <Text style={styles.shareText}>Next</Text>
                <Ionicons name="arrow-forward" size={18} color="#000" />
              </Pressable>
            ) : <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share to Close Friends"
              disabled={!!busy}
              accessibilityHint={demo ? undefined : 'Long press to edit your Close Friends list'}
              onPress={() => void share('close_friends')}
              onLongPress={openCloseFriends}
              style={({ pressed }) => [styles.closeFriends, editor.items.length > 1 && styles.closeFriendsCompact, pressed && styles.closeFriendsPressed]}
            >
              <View style={styles.closeFriendsStar}><Ionicons name="star" size={17} color={CLOSE_FRIENDS_GREEN} /></View>
              {editor.items.length > 1 ? null : <Text style={styles.closeFriendsText}>Close Friends</Text>}
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Share to your story" disabled={!!busy} onPress={() => void share('followers')} style={styles.share}>
              {avatar ? <Image source={{ uri: avatar }} style={styles.shareAvatar} /> : <View style={[styles.shareAvatar, styles.videoThumb]}><Ionicons name="person" size={14} color="#fff" /></View>}
              <Text style={styles.shareText}>Your story{total > 1 ? ` (${total})` : ''}</Text>
              <Ionicons name="chevron-forward" size={18} color="#000" />
            </Pressable>
            </>}
          </View>
        </>
      ) : null}

      {tool === 'trim' && item.media.kind === 'video' ? (
        <TrimBar
          top={panelTop}
          uri={item.media.uri}
          durationMs={item.media.durationMs ?? range.endMs}
          startMs={range.startMs}
          endMs={range.endMs}
          muted={item.muted}
          onChange={(next) => editor.updateCurrent({ trim: next }, { record: false })}
          onToggleMute={() => editor.updateCurrent({ muted: !item.muted })}
          onDone={() => setTool('none')}
        />
      ) : null}

      {tool === 'text' ? (
        <TextTool
          initial={editingText}
          unit={unit}
          viewport={stageLayout.viewport}
          onEyedropper={openEyedropper}
          onDone={(layer) => {
            setTool('none');
            if (!layer) {
              if (editingText) editor.removeLayer(editingText.id);
            } else if (editingText) {
              editor.updateLayer(layer.id, layer);
            } else {
              // A step below the texts already there, so a new one never lands on the last.
              const taken = (item?.layers ?? []).flatMap((existing) => (existing.kind === 'text' ? [existing.transform.y] : []));
              let y = layer.transform.y;
              while (taken.some((other) => Math.abs(other - y) < NEW_TEXT_STEP) && y + NEW_TEXT_STEP < CANVAS.height - 260) y += NEW_TEXT_STEP;
              editor.addLayer({ ...layer, transform: { ...layer.transform, y } });
            }
            setEditingText(null);
          }}
        />
      ) : null}

      {tool === 'draw' ? (
        <DrawTool
          unit={stageLayout.touchUnit}
          renderUnit={unit}
          width={stageWidth}
          height={stageHeight}
          stageTop={stageTop}
          stageLeft={stageLeft}
          live={livePath}
          committed={committedDrawing}
          onLiveStyle={setLiveStroke}
          canUndo={item.drawing.length > 0}
          onStroke={(stroke) => editor.addStroke(stroke)}
          onUndo={() => editor.updateCurrent((entry) => ({ drawing: entry.drawing.slice(0, -1) }))}
          onDone={() => setTool('none')}
          onEyedropper={openEyedropper}
        />
      ) : null}

      {tool === 'stickers' ? (
        <StickerTray
          key={editingSticker?.id ?? 'new'}
          demo={demo}
          editing={editingSticker}
          onUpdate={(layer) => editor.updateLayer(layer.id, layer)}
          onAdd={(layer) => editor.addLayer(layer)}
          onOpenMusic={() => setTool('music')}
          onClose={() => {
            setEditingSticker(null);
            setTool((current) => (current === 'stickers' ? 'none' : current));
          }}
        />
      ) : null}

      {tool === 'music' ? (
        <MusicSheet
          kind={item.media.kind}
          videoLengthMs={item.media.kind === 'video' ? Math.min(60_000, range.lengthMs) : undefined}
          initial={item.music}
          onClose={() => setTool('none')}
          onDone={(music) => {
            editor.updateCurrent({ music });
            setTool('none');
          }}
        />
      ) : null}

      {eyedropper ? (
        <Eyedropper
          stageRef={stageRef}
          left={stageLeft}
          top={stageTop}
          width={stageWidth}
          height={stageHeight}
          onPick={(colour) => {
            eyedropper(colour);
            setEyedropper(null);
          }}
          onCancel={() => setEyedropper(null)}
        />
      ) : null}

      {toast ? <View pointerEvents="none" style={styles.toast}><Text style={styles.toastText}>{toast}</Text></View> : null}
      {busy && !applyingEffect ? (
        <View style={[StyleSheet.absoluteFill, styles.busy]}>
          <ActivityIndicator color="#fff" size="large" />
          <Text style={styles.busyText}>{busy}</Text>
        </View>
      ) : null}
      {adding ? (
        <View style={StyleSheet.absoluteFill}>
          <StoryGalleryPicker adding limit={MAX_SELECTION - editor.items.length} onClose={() => setAdding(false)} onPick={addMedia} />
        </View>
      ) : null}
      <StoryDiscardDialog visible={discardVisible} count={editor.items.length} canSave={!demo} saving={savingDraft} error={draftError}
        onKeepEditing={keepEditing} onSave={() => void saveStoryDraft()} onDiscard={discardStory} onExited={finishDiscardDialog} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#161616' },
  stage: { position: 'absolute', borderRadius: 14, overflow: 'hidden', backgroundColor: '#111' },
  guideV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#3897F0' },
  guideH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#3897F0' },
  bin: { position: 'absolute', width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)' },
  binActive: { backgroundColor: '#ED4956', borderColor: '#ED4956', transform: [{ scale: 1.25 }] },
  bottomBar: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 10 },
  strip: { gap: 2, alignItems: 'center' },
  videoThumb: { backgroundColor: '#333', alignItems: 'center', justifyContent: 'center' },
  share: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 24, paddingLeft: 6, paddingRight: 12, height: 46 },
  next: { paddingLeft: 20, paddingRight: 16 },
  addThumb: { width: 36, height: 56, borderRadius: 6, marginTop: 6, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  shareAvatar: { width: 34, height: 34, borderRadius: 17 },
  shareText: { color: '#000', fontWeight: '700', fontSize: 15 },
  closeFriends: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#282628', borderRadius: 24, paddingLeft: 6, paddingRight: 14, height: 46 },
  closeFriendsCompact: { paddingRight: 6 },
  closeFriendsPressed: { backgroundColor: '#3A3538' },
  closeFriendsStar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#26382B', alignItems: 'center', justifyContent: 'center' },
  closeFriendsText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  toast: { position: 'absolute', alignSelf: 'center', top: '42%', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.6)' },
  toastText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  busy: { backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', gap: 14 },
  busyText: { color: '#fff', fontWeight: '600' },
});
