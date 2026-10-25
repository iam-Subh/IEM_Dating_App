import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { LayoutBoard, type CellCorners, type CellRect, type LayoutPhoto } from './LayoutBoard';
import { publishLiveBlur } from './liveBlur';
import { fitForScreen, registerDisplayImage } from '../displayImages';

/** Layout's live blurred cells: the width of the camera copy, and how often it is taken. */
const LIVE_BLUR_WIDTH = 72;
const LIVE_BLUR_FRAME_MS = 60;
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing, cancelAnimation, runOnJS, useAnimatedProps, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AssetField, MediaType, Query, getPermissionsAsync } from 'expo-media-library';
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as FileSystem from 'expo-file-system/legacy';
import { ClipOp, ImageFormat, Skia, TileMode, type SkCanvas, type SkImage, type SkPaint, type SkRect } from '@shopify/react-native-skia';
import {
  Camera, CommonResolutions, NativePreviewView, useCameraDevice, useCameraPermission, useMicrophonePermission, usePhotoOutput, usePreviewOutput, useVideoOutput,
  type CameraRef, type Recorder,
} from 'react-native-vision-camera';
import type { MediaSource } from '../composition/types';
import { CANVAS } from '../composition/types';
import { STORY_BACKGROUNDS } from '../fonts';
import { STORY_FILTERS, isNeutral, viewFilters } from '../filters';
import { importPhoto, importVideo } from '../import';
import { useStoryBack } from '../backStack';
import { StoryGalleryPicker } from '../picker/StoryGalleryPicker';
import { ChatMedia, hasStoryTools, type BoomerangStyle } from '../../../../../modules/chat-media';
import { BOOMERANG_CLIP_MS, BOOMERANG_STYLES } from './boomerang';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const MAX_RECORDING_MS = 60_000;
const SHUTTER = 78;
const RING = 96;
const RADIUS = (RING - 6) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** The recording zoom slider's track and thumb. */
const ZOOM_TRACK = 220;
/** Where the track starts inside its row: the "−" icon and the gap after it. */
const ZOOM_TRACK_INSET = 28;
const ZOOM_THUMB = 22;const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);
/** How long the front "flash" lights the face before the photo is taken. */
const SCREEN_FLASH_LEAD_MS = 280;

type Mode = 'normal' | 'create' | 'handsfree' | 'boomerang' | 'layout' | 'dual';

type Props = {
  active: boolean;
  onCaptured: (media: MediaSource[], options?: { openText?: boolean; filterId?: string }) => void;
  onOpenDraft: (draftId: string) => void;
  onClose: () => void;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type LayoutId = '2v' | '2h' | '3' | '4' | '6';
/** Layout grids as [x, y, width, height] fractions of the story. */
const LAYOUTS: Record<LayoutId, Array<[number, number, number, number]>> = {
  '2v': [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]],
  '2h': [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]],
  '3': [[0, 0, 1, 1 / 3], [0, 1 / 3, 1, 1 / 3], [0, 2 / 3, 1, 1 / 3]],
  '4': [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
  '6': [[0, 0, 0.5, 1 / 3], [0.5, 0, 0.5, 1 / 3], [0, 1 / 3, 0.5, 1 / 3], [0.5, 1 / 3, 0.5, 1 / 3], [0, 2 / 3, 0.5, 1 / 3], [0.5, 2 / 3, 0.5, 1 / 3]],
};
/** Cells meet edge to edge in the finished layout, as they do on the camera. */
const LAYOUT_GAP = 0;
/** The camera preview's corner radius; layout cells in its corners round to match. */
const PREVIEW_RADIUS = 16;
const atEdge = (value: number) => Math.abs(value) < 0.001;

/** Draws an image filling `dest`, cropped from its centre. */
function drawCover(canvas: SkCanvas, image: SkImage, dest: SkRect, paint: SkPaint) {
  const scale = Math.max(dest.width / image.width(), dest.height / image.height());
  const width = dest.width / scale;
  const height = dest.height / scale;
  // Cubic sampling: the plain draw samples the nearest pixel and softens a shrunk photo.
  canvas.drawImageRectCubic(image, Skia.XYWHRect((image.width() - width) / 2, (image.height() - height) / 2, width, height), dest, 1 / 3, 1 / 3, paint);
}

async function loadImage(uri: string) {
  const image = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
  if (!image) throw new Error('A photo could not be read');
  return image;
}

async function writeCanvas(draw: (canvas: SkCanvas, paint: SkPaint) => Promise<void>, name: string): Promise<MediaSource> {
  const surface = Skia.Surface.Make(CANVAS.width, CANVAS.height);
  if (!surface) throw new Error('The photo could not be made');
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  const canvas = surface.getCanvas();
  canvas.drawColor(Skia.Color('#000000'));
  await draw(canvas, paint);
  surface.flush();
  const path = `${FileSystem.cacheDirectory}story-${name}-${Date.now()}.jpg`;
  await FileSystem.writeAsStringAsync(path, surface.makeImageSnapshot().encodeToBase64(ImageFormat.JPEG, 92), { encoding: FileSystem.EncodingType.Base64 });
  return { kind: 'photo', uri: path, width: CANVAS.width, height: CANVAS.height };
}

/**
 * Layout: each photo fills its cell with the whole picture, cropped only to
 * the cell's shape, exactly as the camera and the grid showed it.
 */
const composeLayout = (uris: string[], cells: Array<[number, number, number, number]>) => writeCanvas(async (canvas, paint) => {
  for (let index = 0; index < uris.length; index += 1) {
    const [x, y, width, height] = cells[index];
    const cell = Skia.XYWHRect(
      x * CANVAS.width + LAYOUT_GAP / 2, y * CANVAS.height + LAYOUT_GAP / 2, width * CANVAS.width - LAYOUT_GAP, height * CANVAS.height - LAYOUT_GAP,
    );
    canvas.save();
    canvas.clipRect(cell, ClipOp.Intersect, true);
    drawCover(canvas, await loadImage(uris[index]), cell, paint);
    canvas.restore();
  }
}, 'layout');

/** Dual: the main camera's photo, with the other camera's in a rounded corner. */
const composeDual = (mainUri: string, insetUri: string) => writeCanvas(async (canvas, paint) => {
  drawCover(canvas, await loadImage(mainUri), Skia.XYWHRect(0, 0, CANVAS.width, CANVAS.height), paint);
  const inset = Skia.XYWHRect(56, 150, 330, 586);
  const border = Skia.Paint();
  border.setAntiAlias(true);
  border.setColor(Skia.Color('#FFFFFF'));
  canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(inset.x - 8, inset.y - 8, inset.width + 16, inset.height + 16), 38, 38), border);
  canvas.save();
  canvas.clipRRect(Skia.RRectXY(inset, 30, 30), ClipOp.Intersect, true);
  drawCover(canvas, await loadImage(insetUri), inset, paint);
  canvas.restore();
}, 'dual');

/** A small picture of a layout grid, for its button. */
function LayoutIcon({ id, active }: { id: LayoutId; active: boolean }) {
  return (
    <View style={[styles.layoutIcon, active && styles.layoutIconActive]}>
      {LAYOUTS[id].map(([x, y, width, height], index) => (
        <View key={index} style={[styles.layoutIconCell, { left: x * 20, top: y * 34, width: width * 20, height: height * 34 }]} />
      ))}
    </View>
  );
}

export async function gradientPhoto(colours: string[]): Promise<MediaSource> {
  const surface = Skia.Surface.Make(CANVAS.width, CANVAS.height);
  if (!surface) throw new Error('Could not create a background');
  const paint = Skia.Paint();
  paint.setShader(Skia.Shader.MakeLinearGradient({ x: 0, y: 0 }, { x: CANVAS.width, y: CANVAS.height }, colours.map((colour) => Skia.Color(colour)), null, TileMode.Clamp));
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, CANVAS.width, CANVAS.height), paint);
  surface.flush();
  const path = `${FileSystem.cacheDirectory}story-create-${Date.now()}.jpg`;
  await FileSystem.writeAsStringAsync(path, surface.makeImageSnapshot().encodeToBase64(ImageFormat.JPEG, 95), { encoding: FileSystem.EncodingType.Base64 });
  return { kind: 'photo', uri: path, width: CANVAS.width, height: CANVAS.height, locked: true };
}

/** The tap-to-focus ring: a circle that settles in and fades, as on Instagram. */
function FocusRing({ x, y }: { x: number; y: number }) {
  const scale = useSharedValue(1.6);
  const opacity = useSharedValue(0);
  useEffect(() => {
    scale.value = withSpring(1, { damping: 15, stiffness: 240 });
    opacity.value = withSequence(withTiming(1, { duration: 110 }), withDelay(700, withTiming(0, { duration: 280 })));
  }, [opacity, scale]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));
  return <Animated.View pointerEvents="none" style={[styles.focus, { left: x - 34, top: y - 34 }, style]} />;
}

/**
 * The story camera. Tap the shutter for a photo; hold it to record up to 60
 * seconds, sliding up to zoom while recording. Hands-free records on a tap and
 * stops on the next. Create is a coloured background to type on. Pinch to zoom,
 * tap to focus, double-tap or the button to flip, and the thumbnail (or a swipe
 * up) opens the gallery and drafts. The front camera's flash lights the screen.
 */
export function StoryCamera({ active, onCaptured, onOpenDraft, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const previewHeight = (width * 16) / 9;
  const cameraPermission = useCameraPermission();
  const microphone = useMicrophonePermission();
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const device = useCameraDevice(facing);
  // The largest photo the camera offers in this session. A 1440p target let
  // front cameras fall back to a much smaller size.
  const photoOutput = usePhotoOutput({ targetResolution: CommonResolutions.HIGHEST_16_9, qualityPrioritization: 'quality', quality: 1 });
  const videoOutput = useVideoOutput({ targetResolution: CommonResolutions.FHD_16_9, enableAudio: microphone.hasPermission });
  const camera = useRef<CameraRef>(null);
  const zoom = useSharedValue(1);
  const [flash, setFlash] = useState<'off' | 'on' | 'auto'>('off');
  const [torch, setTorch] = useState<'off' | 'on'>('off');
  const [screenFlash, setScreenFlash] = useState(false);
  const [mode, setMode] = useState<Mode>('normal');
  const [recording, setRecording] = useState(false);
  const recordingValue = useSharedValue(0);
  const recorder = useRef<Recorder | null>(null);
  // Hold to record: whether the finger is down, whether the recording has
  // actually started, and a release that came before it had.
  const holding = useRef(false);
  const recordingLive = useRef(false);
  const stopWhenStarted = useRef(false);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progress = useSharedValue(0);
  // The shutter's sideways position while sliding to zoom, and where the zoom was on the track when the slide began.
  const shutterShift = useSharedValue(0);
  const slideStartFraction = useSharedValue(0);
  const capturing = useRef(false);
  const blink = useSharedValue(0);
  const [gallery, setGallery] = useState(false);
  const [latest, setLatest] = useState<string | null>(null);
  const [createBackground, setCreateBackground] = useState(1);
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number; key: number } | null>(null);
  // Live filters: swipe sideways on the preview. The editor starts with the same filter.
  const [filterIndex, setFilterIndex] = useState(0);
  const [filterLabel, setFilterLabel] = useState<string | null>(null);
  const filter = STORY_FILTERS[filterIndex];
  const filterStyle = useMemo(() => (isNeutral(filter.params) ? null : { filter: viewFilters(filter.params) }), [filter]);
  const [boomerangStyle, setBoomerangStyle] = useState<BoomerangStyle>('classic');
  const boomerangRecording = useRef(false);
  const [layoutId, setLayoutId] = useState<LayoutId>('4');
  const [cells, setCells] = useState<LayoutPhoto[]>([]);
  // A photo tapped to retake it.
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  // Resolved when the camera session (re)starts, for Dual's switch between cameras.
  const startWaiters = useRef<Array<() => void>>([]);
  const needsTexture = !!filterStyle || mode === 'layout';
  const minZoom = device?.minZoom ?? 1;
  const maxZoom = Math.min(device?.maxZoom ?? 8, 10);
  const isFront = facing === 'front';
  // A back camera without a flash unit has nothing to switch; the front one lights the screen instead.
  const flashAvailable = isFront || !!device?.hasFlash || !!device?.hasTorch;

  useStoryBack(() => {
    if (gallery) {
      setGallery(false);
      return true;
    }
    // Layout: back cancels a retake, then removes the photos one at a time,
    // newest first. That cell shows the camera again and the ones after it
    // go back to blurred. With no photos left, back leaves the camera.
    if (mode === 'layout' && selectedCell !== null) {
      setSelectedCell(null);
      return true;
    }
    if (mode === 'layout' && cells.length) {
      setCells((current) => current.slice(0, -1));
      return true;
    }
    return false;
  });

  // The zoom is one shared value. Pinching, sliding the shutter and dragging
  // the zoom slider change it on the UI thread, so the slider and circle move
  // at once; every change is then sent to the camera. (The camera's own
  // shared-value `zoom` prop needs react-native-vision-camera-worklets, which
  // stopped the app starting, so it is not used.)
  const started = useRef(false);
  const pinchStart = useSharedValue(1);
  // Zoom on a log scale: each doubling of the zoom is the same distance on the
  // slider and under the finger.
  const zoomLow = Math.log(minZoom);
  const zoomRange = Math.max(0.0001, Math.log(Math.max(maxZoom, minZoom)) - zoomLow);
  // The zoom slider is centred on the shutter. Its middle is the zoom when the
  // slide began; the circle can travel its whole length: the right half zooms
  // in up to the closest, the left half zooms out down to the widest.
  const zoomForOffset = useCallback((startLog: number, offset: number) => {
    'worklet';
    const t = Math.max(-1, Math.min(1, offset / (ZOOM_TRACK / 2)));
    const high = zoomLow + zoomRange;
    return Math.exp(t >= 0 ? startLog + (high - startLog) * t : startLog + (startLog - zoomLow) * t);
  }, [zoomLow, zoomRange]);

  const sendZoom = useCallback((value: number) => {
    const controller = camera.current?.controller;
    if (!started.current || !controller) return;
    // A newer value cancels one still being applied; that is expected.
    controller.setZoom(value).catch(() => undefined);
  }, []);
  // Every visible change of the zoom value reaches the camera.
  useAnimatedReaction(() => zoom.value, (value, previous) => {
    if (previous === null || Math.abs(value - previous) > 0.004) runOnJS(sendZoom)(value);
  }, [sendZoom]);

  useEffect(() => {
    if (!cameraPermission.hasPermission && cameraPermission.canRequestPermission) void cameraPermission.requestPermission();
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new camera starts at its normal zoom.
  useEffect(() => {
    zoom.value = Math.max(minZoom, Math.min(maxZoom, 1));
  }, [facing, maxZoom, minZoom, zoom]);

  // The newest item in the gallery, for the thumbnail.
  useEffect(() => {
    let alive = true;
    (async () => {
      const permission = await getPermissionsAsync(false, ['photo', 'video']).catch(() => null);
      if (!permission?.granted) return;
      const [asset] = await new Query().within(AssetField.MEDIA_TYPE, [MediaType.IMAGE, MediaType.VIDEO]).orderBy({ key: AssetField.CREATION_TIME, ascending: false }).limit(1).exe();
      if (!asset || !alive) return;
      const [uri, kind] = await Promise.all([asset.getUri(), asset.getMediaType()]);
      if (kind === MediaType.VIDEO) {
        const thumbnail = await VideoThumbnails.getThumbnailAsync(uri, { time: 0, quality: 0.3 }).catch(() => null);
        if (alive && thumbnail) setLatest(thumbnail.uri);
      } else if (alive) {
        setLatest(uri);
      }
    })().catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const flip = useCallback(() => {
    setFacing((value) => (value === 'back' ? 'front' : 'back'));
  }, []);

  const focus = useCallback((x: number, y: number) => {
    setFocusPoint({ x, y, key: Date.now() });
    camera.current?.focusTo({ x, y }).catch(() => undefined);
  }, []);

  const shoot = useCallback(async (flashMode: 'off' | 'on' | 'auto', forEditor = false): Promise<MediaSource> => {
    blink.value = withSequence(withTiming(1, { duration: 50 }), withTiming(0, { duration: 220 }));
    const photo = await photoOutput.capturePhoto({ flashMode, enableShutterSound: false }, {});
    // The file (shared later, at full size) and, for the editor, a sharp
    // screen-sized picture made straight from the capture, already upright
    // and mirrored like the preview.
    const [path, picture] = await Promise.all([
      photo.saveToTemporaryFileAsync(),
      forEditor ? photo.toImageAsync().then(fitForScreen).catch(() => null) : Promise.resolve(null),
    ]);
    // The pixels are stored as the sensor saw them; the orientation is an
    // EXIF flag, applied when the story is shared. Sideways means the
    // picture's width and height are swapped on screen.
    const sideways = photo.orientation === 'left' || photo.orientation === 'right';
    if (__DEV__) console.log(`[StoryCamera] ${facing} photo ${photo.width}×${photo.height} (${photo.orientation})`);
    const media: MediaSource = {
      kind: 'photo',
      uri: path.startsWith('file://') ? path : `file://${path}`,
      width: sideways ? photo.height : photo.width,
      height: sideways ? photo.width : photo.height,
      raw: true,
    };
    if (picture) registerDisplayImage(media.uri, picture);
    (photo as unknown as { dispose?: () => void }).dispose?.();
    return media;
  }, [blink, facing, photoOutput]);

  /**
   * Layout: a photo fills the next cell at once. The upright copy the grid is
   * drawn from is made in the background; waiting for it first made each cell
   * take a second or more to fill.
   */
  /** Puts a photo in the next cell, or in place of the one being retaken. Returns its id. */
  const placeCell = useCallback((entry: Omit<LayoutPhoto, 'id'>) => {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    // Handled when the layout is drawn; this only avoids an unhandled rejection if the cell is removed first.
    entry.file.catch(() => undefined);
    setCells((current) => {
      const target = selectedCell !== null && selectedCell < current.length ? selectedCell : current.length;
      if (target >= LAYOUTS[layoutId].length) return current;
      const next = [...current];
      next[target] = { ...entry, id };
      return next;
    });
    setSelectedCell(null);
    return id;
  }, [layoutId, selectedCell]);

  const addCell = useCallback((media: MediaSource) => {
    placeCell({
      preview: media.uri,
      placeholder: null,
      file: media.raw ? importPhoto(media.uri).then((photo) => photo.uri) : Promise.resolve(media.uri),
    });
  }, [placeCell]);

  const layoutRects = useMemo<CellRect[]>(() => LAYOUTS[layoutId].map(([x, y, cellWidth, cellHeight]) => ({
    left: x * width, top: y * previewHeight, width: cellWidth * width, height: cellHeight * previewHeight,
  })), [layoutId, previewHeight, width]);

  // Cells meet with no gap and fill the preview to its edge. Only a corner of
  // the preview is rounded, with the preview's own radius, so the border
  // follows the corner instead of being cut by it.
  const layoutCorners = useMemo<CellCorners[]>(() => LAYOUTS[layoutId].map(([x, y, cellWidth, cellHeight]) => {
    const left0 = atEdge(x);
    const top0 = atEdge(y);
    const right0 = atEdge(x + cellWidth - 1);
    const bottom0 = atEdge(y + cellHeight - 1);
    return {
      borderTopLeftRadius: left0 && top0 ? PREVIEW_RADIUS : 0,
      borderTopRightRadius: right0 && top0 ? PREVIEW_RADIUS : 0,
      borderBottomLeftRadius: left0 && bottom0 ? PREVIEW_RADIUS : 0,
      borderBottomRightRadius: right0 && bottom0 ? PREVIEW_RADIUS : 0,
    };
  }), [layoutId]);

  // Layout shows the live camera only in the cell being filled, fitting the
  // whole scene into it, just as the photo will fill that cell. Otherwise the
  // camera fills the preview. The views stay the same, so the camera never restarts.
  const liveCell = mode === 'layout' ? (selectedCell ?? (cells.length < layoutRects.length ? cells.length : null)) : null;
  const cameraFrame = useMemo(() => {
    const full = { position: 'absolute' as const, left: 0, top: 0, width, height: previewHeight };
    if (liveCell === null) return { clip: full, inner: full };
    const rect = layoutRects[liveCell];
    const scale = Math.max(rect.width / width, rect.height / previewHeight);
    const innerWidth = width * scale;
    const innerHeight = previewHeight * scale;
    return {
      clip: { position: 'absolute' as const, left: rect.left, top: rect.top, width: rect.width, height: rect.height, overflow: 'hidden' as const, ...layoutCorners[liveCell] },
      inner: { position: 'absolute' as const, left: (rect.width - innerWidth) / 2, top: (rect.height - innerHeight) / 2, width: innerWidth, height: innerHeight },
    };
  }, [layoutCorners, layoutRects, liveCell, previewHeight, width]);

  // Layout's waiting cells show the camera blurred and moving. The camera runs
  // a second, full-size preview under the grid, blurred on the GPU, so the blur
  // is as smooth as the camera itself. A phone that cannot run two previews
  // reports an error when the camera starts; it then falls back to a tiny copy
  // of the camera picture, taken about 15 times a second.
  const blurOutput = usePreviewOutput();
  const [liveBlurFailed, setLiveBlurFailed] = useState(false);
  const livePreviewBehind = mode === 'layout' && !liveBlurFailed;
  const cameraOutputs = useMemo(
    () => (livePreviewBehind ? [photoOutput, videoOutput, blurOutput] : [photoOutput, videoOutput]),
    [blurOutput, livePreviewBehind, photoOutput, videoOutput],
  );
  useEffect(() => {
    // Only on a phone that could not add the blurred live preview.
    if (liveCell === null || !active || gallery || !liveBlurFailed) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (!alive) return;
      const view = camera.current;
      if (view && started.current && !capturing.current) {
        try {
          const full = await view.takeSnapshot();
          const small = await full.resizeAsync(LIVE_BLUR_WIDTH, Math.max(1, Math.round((LIVE_BLUR_WIDTH * full.height) / Math.max(1, full.width))));
          full.dispose();
          if (alive) publishLiveBlur(small);
        } catch {
          // The preview is not ready yet; the next frame tries again.
        }
      }
      if (alive) timer = setTimeout(() => { void tick(); }, LIVE_BLUR_FRAME_MS);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [active, gallery, liveBlurFailed, liveCell]);
  useEffect(() => () => publishLiveBlur(null), []);

  /** Moves a photo to another cell; the photos in between shift one place along, as on Instagram. */
  const moveCell = useCallback((from: number, to: number) => {
    setSelectedCell(null);
    setCells((current) => {
      if (from >= current.length || to >= current.length || from === to) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const selectCell = useCallback((index: number) => {
    setSelectedCell((current) => (current === index ? null : index));
  }, []);

  const takePhoto = useCallback(async () => {
    if (capturing.current || recorder.current) return;
    capturing.current = true;
    const lightScreen = isFront && flash !== 'off';
    let pendingCell: string | null = null;
    try {
      if (lightScreen) {
        setScreenFlash(true);
        await wait(SCREEN_FLASH_LEAD_MS);
      }
      if (mode === 'layout') {
        // The cell fills at once with a still of the live camera, so it never
        // shows the blur or waits for the photo. The photo replaces the still
        // as soon as it is ready.
        const placeholder = (await camera.current?.takeSnapshot().catch(() => null)) ?? null;
        const shot = shoot(isFront ? 'off' : flash);
        pendingCell = placeCell({
          preview: null,
          placeholder,
          file: shot.then((media) => importPhoto(media.uri)).then((photo) => photo.uri),
        });
        const media = await shot;
        const id = pendingCell;
        setCells((current) => current.map((cell) => (cell.id === id ? { ...cell, preview: media.uri } : cell)));
        pendingCell = null;
        setScreenFlash(false);
        return;
      }
      const media = await shoot(isFront ? 'off' : flash, true);
      setScreenFlash(false);
      onCaptured([media], { filterId: filter.id });
    } catch {
      setScreenFlash(false);
      // The photo failed: its cell empties again.
      const id = pendingCell;
      if (id) setCells((current) => current.filter((cell) => cell.id !== id));
    } finally {
      capturing.current = false;
    }
  }, [filter.id, flash, isFront, mode, onCaptured, placeCell, shoot]);

  // Layout: once every cell has a photo, the shutter's checkmark makes the grid
  // the story. Until then photos can still be moved, swapped and retaken.
  const finishLayout = useCallback(async () => {
    const slots = LAYOUTS[layoutId];
    if (cells.length < slots.length || processing) return;
    setProcessing('Making your layout…');
    try {
      const files = await Promise.all(cells.map((cell) => cell.file));
      const media = await composeLayout(files, slots);
      setCells([]);
      setSelectedCell(null);
      onCaptured([media], { filterId: filter.id });
    } catch {
      // Stay on the camera with the photos in place.
    } finally {
      setProcessing(null);
    }
  }, [cells, filter.id, layoutId, onCaptured, processing]);

  useEffect(() => {
    if (mode !== 'layout') setSelectedCell(null);
    if (mode !== 'layout') setCells([]);
  }, [mode]);

  const waitForStart = useCallback(() => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 2500);
    startWaiters.current.push(() => {
      clearTimeout(timer);
      resolve();
    });
  }), []);

  /**
   * Dual: a photo with this camera, then one with the other, the second placed
   * in a corner of the first. Phones cannot run both cameras at once here, so
   * they are taken a moment apart.
   */
  const takeDual = useCallback(async () => {
    if (capturing.current || recorder.current) return;
    capturing.current = true;
    setProcessing('Hold still…');
    try {
      const first = await shoot('off');
      const restarted = waitForStart();
      setFacing((value) => (value === 'back' ? 'front' : 'back'));
      await restarted;
      await wait(450);
      const second = await shoot('off');
      setFacing((value) => (value === 'back' ? 'front' : 'back'));
      setProcessing('Making your photo…');
      const [main, inset] = await Promise.all([importPhoto(first.uri), importPhoto(second.uri)]);
      onCaptured([await composeDual(main.uri, inset.uri)], { filterId: filter.id });
    } catch {
      // Stay on the camera.
    } finally {
      capturing.current = false;
      setProcessing(null);
    }
  }, [filter.id, onCaptured, shoot, waitForStart]);

  const shiftFilter = useCallback((step: number) => {
    const next = (filterIndex + step + STORY_FILTERS.length) % STORY_FILTERS.length;
    setFilterIndex(next);
    setFilterLabel(STORY_FILTERS[next].name);
  }, [filterIndex]);

  useEffect(() => {
    if (!filterLabel) return;
    const timer = setTimeout(() => setFilterLabel(null), 900);
    return () => clearTimeout(timer);
  }, [filterLabel]);

  const finishRecording = useCallback(async (path: string) => {
    setRecording(false);
    recordingValue.value = 0;
    setTorch('off');
    setScreenFlash(false);
    const uri = path.startsWith('file://') ? path : `file://${path}`;
    if (boomerangRecording.current) {
      boomerangRecording.current = false;
      if (!ChatMedia) return;
      setProcessing('Making your Boomerang…');
      try {
        const result = await ChatMedia.makeBoomerang(uri, boomerangStyle);
        onCaptured([{
          kind: 'video', uri: result.uri, width: result.width, height: result.height, durationMs: result.durationMs, hasAudio: false,
          boomerang: { sourceUri: uri, style: boomerangStyle },
        }], { filterId: filter.id });
      } catch {
        // Stay on the camera.
      } finally {
        setProcessing(null);
      }
      return;
    }
    try {
      const video = await importVideo(uri);
      if ((video.durationMs ?? 0) < 400) return;
      onCaptured([video], { filterId: filter.id });
    } catch {
      // The recording could not be read; stay on the camera.
    }
  }, [boomerangStyle, filter.id, onCaptured, recordingValue]);

  const stopRecording = useCallback(async () => {
    recordingLive.current = false;
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = null;
    cancelAnimation(progress);
    const current = recorder.current;
    recorder.current = null;
    if (current) await current.stopRecording().catch(() => undefined);
  }, [progress]);

  const startRecording = useCallback(async () => {
    if (capturing.current || recorder.current) return;
    stopWhenStarted.current = false;
    if (!microphone.hasPermission && microphone.canRequestPermission) {
      // Asking mid-hold would interrupt the recording; ask, and let the next hold record.
      await microphone.requestPermission();
      return;
    }
    try {
      if (flash === 'on' && !isFront && device?.hasTorch) setTorch('on');
      if (flash !== 'off' && isFront) setScreenFlash(true);
      const next = await videoOutput.createRecorder({});
      recorder.current = next;
      setRecording(true);
      recordingValue.value = 1;
      progress.value = 0;
      progress.value = withTiming(1, { duration: MAX_RECORDING_MS, easing: Easing.linear });
      await next.startRecording(
        (path) => { void finishRecording(path); },
        () => {
          recordingLive.current = false;
          setRecording(false);
          recordingValue.value = 0;
          setTorch('off');
          setScreenFlash(false);
          recorder.current = null;
        },
      );
      stopTimer.current = setTimeout(() => { void stopRecording(); }, MAX_RECORDING_MS);
      recordingLive.current = true;
      // The finger lifted while the recording was still starting: stop it now.
      if (stopWhenStarted.current) {
        stopWhenStarted.current = false;
        void stopRecording();
      }
    } catch {
      recorder.current = null;
      setRecording(false);
      recordingValue.value = 0;
      setTorch('off');
      setScreenFlash(false);
    }
  }, [device?.hasTorch, finishRecording, flash, isFront, microphone, progress, recordingValue, stopRecording, videoOutput]);

  const beginHold = useCallback(() => {
    holding.current = true;
    void startRecording();
  }, [startRecording]);

  const endHold = useCallback(() => {
    if (!holding.current) return;
    holding.current = false;
    if (recordingLive.current) void stopRecording();
    else stopWhenStarted.current = true;
  }, [stopRecording]);

  const shutterTap = useCallback(async () => {
    if (mode === 'create') {
      try {
        onCaptured([await gradientPhoto(STORY_BACKGROUNDS[createBackground])], { openText: true });
      } catch {
        // Stay on the camera.
      }
      return;
    }
    if (mode === 'handsfree') {
      if (recorder.current) void stopRecording();
      else void startRecording();
      return;
    }
    if (mode === 'boomerang') {
      if (recorder.current || processing || !hasStoryTools) return;
      boomerangRecording.current = true;
      void startRecording().then(() => {
        if (!recorder.current) {
          boomerangRecording.current = false;
          return;
        }
        // A short burst instead of the usual 60 seconds.
        if (stopTimer.current) clearTimeout(stopTimer.current);
        progress.value = withTiming(1, { duration: BOOMERANG_CLIP_MS, easing: Easing.linear });
        stopTimer.current = setTimeout(() => { void stopRecording(); }, BOOMERANG_CLIP_MS);
      });
      return;
    }
    if (mode === 'dual') {
      void takeDual();
      return;
    }
    if (mode === 'layout' && selectedCell === null && cells.length >= LAYOUTS[layoutId].length) {
      void finishLayout();
      return;
    }
    void takePhoto();
  }, [cells.length, createBackground, finishLayout, layoutId, mode, onCaptured, processing, progress, selectedCell, startRecording, stopRecording, takeDual, takePhoto]);

  const shutterHandlers = useRef({ beginHold, endHold, shutterTap });
  shutterHandlers.current = { beginHold, endHold, shutterTap };
  const beginShutterHold = useCallback(() => shutterHandlers.current.beginHold(), []);
  const endShutterHold = useCallback(() => shutterHandlers.current.endHold(), []);
  const tapShutter = useCallback(() => { void shutterHandlers.current.shutterTap(); }, []);
  const shutterGesture = useMemo(() => {
    const tap = Gesture.Tap().maxDuration(260).onEnd((_event, success) => { if (success) runOnJS(tapShutter)(); });
    // Release always ends a hold, whatever state the gesture finished in. It
    // used to stop only on a "successful" end, and a lift while the recording
    // was still starting reached no recorder, so the video kept recording.
    const hold = Gesture.LongPress().enabled(mode === 'normal').minDuration(260).maxDistance(4000)
      .shouldCancelWhenOutside(false)
      .onStart(() => { runOnJS(beginShutterHold)(); })
      .onFinalize(() => { runOnJS(endShutterHold)(); });
    // While recording, the shutter circle slides left and right under the
    // finger, as far as the zoom track reaches either side. One track length
    // covers the whole zoom range, on the same scale as the slider above it.
    const slide = Gesture.Pan().enabled(mode !== 'create').activeOffsetX([-12, 12])
      .onStart(() => {
        slideStartFraction.value = Math.log(Math.max(minZoom, Math.min(maxZoom, zoom.value)));
      })
      .onUpdate((event) => {
        if (recordingValue.value !== 1) return;
        // The circle slides the full length of the slider, either way from the middle.
        const offset = Math.max(-ZOOM_TRACK / 2, Math.min(ZOOM_TRACK / 2, event.translationX));
        shutterShift.value = offset;
        zoom.value = zoomForOffset(slideStartFraction.value, offset);
      })
      .onFinalize(() => {
        shutterShift.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
      });
    return Gesture.Exclusive(Gesture.Simultaneous(hold, slide), tap);
  }, [beginShutterHold, endShutterHold, maxZoom, minZoom, mode, recordingValue, shutterShift, tapShutter, slideStartFraction, zoom, zoomForOffset]);

  // Pinch zoom is the camera's own native gesture (enableNativeZoomGesture):
  // it runs beside the preview without a round trip through JavaScript. These
  // are one-finger gestures only, so they never cancel a pinch in progress.
  // Once a layout has photos, dragging and tapping belong to the photos, not
  // to the gallery swipe, filter swipe, flip or focus.
  const previewGesturesOn = !(mode === 'layout' && cells.length > 0);
  const previewGesture = useMemo(() => {
    // Taps fail as soon as fingers move, so a pinch never counts as one.
    const doubleTap = Gesture.Tap().enabled(previewGesturesOn).numberOfTaps(2).onEnd(() => { runOnJS(flip)(); });
    // In Layout the camera sits in one cell, so a tap point on the preview is not a point on the camera.
    const singleTap = Gesture.Tap().enabled(previewGesturesOn && mode !== 'layout').onEnd((event) => { runOnJS(focus)(event.x, event.y); });
    const swipeUp = Gesture.Pan().enabled(previewGesturesOn).maxPointers(1).activeOffsetY(-40).failOffsetX([-30, 30]).onEnd((event) => {
      if (event.translationY < -80) runOnJS(setGallery)(true);
    });
    // Swipe sideways for the next or previous filter.
    const swipeSide = Gesture.Pan().enabled(previewGesturesOn).maxPointers(1).activeOffsetX([-40, 40]).failOffsetY([-30, 30]).onEnd((event) => {
      if (Math.abs(event.translationX) > 70) runOnJS(shiftFilter)(event.translationX < 0 ? 1 : -1);
    });
    // Pinch to zoom, on the UI thread, from wherever the zoom is now.
    const pinch = Gesture.Pinch()
      .onStart(() => {
        pinchStart.value = zoom.value;
      })
      .onUpdate((event) => {
        zoom.value = Math.max(minZoom, Math.min(maxZoom, pinchStart.value * event.scale));
      });
    return Gesture.Simultaneous(pinch, Gesture.Exclusive(swipeUp, swipeSide, doubleTap, singleTap));
  }, [flip, focus, maxZoom, minZoom, mode, pinchStart, previewGesturesOn, shiftFilter, zoom]);

  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: CIRCUMFERENCE * (1 - progress.value) }));
  const shutterStyle = useAnimatedStyle(() => ({ transform: [{ scale: withTiming(recordingValue.value ? 1.18 : 1, { duration: 180 }) }] }));
  const blinkStyle = useAnimatedStyle(() => ({ opacity: blink.value * 0.7 }));
  const shutterShiftStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shutterShift.value }] }));

  // The circle is back in the middle when a recording ends.
  useEffect(() => {
    if (!recording) shutterShift.value = withTiming(0, { duration: 200 });
  }, [recording, shutterShift]);

  // The slider's thumb moves exactly with the shutter circle, from the middle.
  const zoomThumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: Math.max(0, Math.min(1, (Math.log(zoom.value) - zoomLow) / zoomRange)) * ZOOM_TRACK - ZOOM_THUMB / 2 }] }));
  const zoomFillStyle = useAnimatedStyle(() => ({ width: Math.max(0, Math.min(1, (Math.log(zoom.value) - zoomLow) / zoomRange)) * ZOOM_TRACK }));
  // The slider can be dragged too, the same way as the circle: from its middle, either way.
  const trackGesture = useMemo(() => Gesture.Pan().minDistance(0)
    .onBegin((event) => {
      slideStartFraction.value = Math.log(Math.max(minZoom, Math.min(maxZoom, zoom.value)));
      const offset = Math.max(-ZOOM_TRACK / 2, Math.min(ZOOM_TRACK / 2, event.x - ZOOM_TRACK_INSET - ZOOM_TRACK / 2));
      shutterShift.value = offset;
      zoom.value = zoomForOffset(slideStartFraction.value, offset);
    })
    .onUpdate((event) => {
      const offset = Math.max(-ZOOM_TRACK / 2, Math.min(ZOOM_TRACK / 2, event.x - ZOOM_TRACK_INSET - ZOOM_TRACK / 2));
      shutterShift.value = offset;
      zoom.value = zoomForOffset(slideStartFraction.value, offset);
    })
    .onFinalize(() => {
      shutterShift.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
    }), [maxZoom, minZoom, shutterShift, slideStartFraction, zoom, zoomForOffset]);
  const zoomLabelProps = useAnimatedProps(() => {
    const label = `${zoom.value.toFixed(1)}×`;
    return { text: label, defaultValue: label } as object;
  });

  if (!cameraPermission.hasPermission && !cameraPermission.canRequestPermission) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.permissionText}>Allow camera access to take stories.</Text>
        <Pressable onPress={() => Linking.openSettings()} style={styles.permissionButton}><Text style={styles.permissionButtonText}>Open settings</Text></Pressable>
        <Pressable onPress={() => setGallery(true)} style={{ marginTop: 18 }}><Text style={styles.link}>Choose from gallery</Text></Pressable>
        <Pressable onPress={onClose} style={{ marginTop: 18 }}><Text style={styles.link}>Close</Text></Pressable>
        {gallery ? <StoryGalleryPicker onClose={() => setGallery(false)} onPick={(media) => { setGallery(false); onCaptured(media); }} onOpenDraft={onOpenDraft} /> : null}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.preview, { top: insets.top, height: previewHeight }]}>
        {mode === 'create' ? (
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setCreateBackground((value) => (value + 1) % STORY_BACKGROUNDS.length)}>
            <LinearGradient colors={STORY_BACKGROUNDS[createBackground] as unknown as [string, string, ...string[]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <View style={[StyleSheet.absoluteFill, styles.center]}>
              <Text style={styles.createHint}>Tap to type</Text>
              <Text style={styles.createSub}>Tap the background to change its colour</Text>
            </View>
          </Pressable>
        ) : (
          <GestureDetector gesture={previewGesture}>
            <View style={StyleSheet.absoluteFill} collapsable={false}>
              {device ? (
                <>
                {livePreviewBehind ? (
                  <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.liveBlurLayer]}>
                    <NativePreviewView previewOutput={blurOutput} implementationMode="compatible" resizeMode="cover" style={StyleSheet.absoluteFill} />
                  </View>
                ) : null}
                <View style={cameraFrame.clip}>
                <View style={cameraFrame.inner}>
                <View style={[StyleSheet.absoluteFill, filterStyle]}>
                <Camera
                  // A filter or Layout's blur needs the preview as a TextureView.
                  // Otherwise the faster SurfaceView keeps recording smooth.
                  key={needsTexture ? 'texture' : 'surface'}
                  ref={camera}
                  style={StyleSheet.absoluteFill}
                  device={device}
                  isActive={active && !gallery}
                  outputs={cameraOutputs}
                  implementationMode={needsTexture ? 'compatible' : 'performance'}
                  // Front cameras have no flash unit; setting any torch mode on them is an error.
                  torchMode={device.hasTorch ? torch : undefined}
                  onStarted={() => {
                    started.current = true;
                    // A camera that just started (or restarted) takes the current zoom.
                    sendZoom(zoom.value);
                    startWaiters.current.splice(0).forEach((resolve) => resolve());
                  }}
                  onStopped={() => { started.current = false; }}
                  onError={(error) => {
                    // Control changes (zoom, torch) sent while the session is
                    // starting or stopping are cancelled by CameraX; they are
                    // re-applied once it runs, so they are not failures.
                    if (/not active|OperationCanceled|No flash unit/i.test(error.message)) return;
                    // The camera could not add Layout's second (blurred) preview: use the fallback blur.
                    if (livePreviewBehind) {
                      setLiveBlurFailed(true);
                      return;
                    }
                    console.warn('[StoryCamera]', error.message);
                  }}
                  resizeMode="cover"
                />
                </View>
                </View>
                </View>
                </>
              ) : <View style={[StyleSheet.absoluteFill, styles.center]}><ActivityIndicator color="#fff" /></View>}
              {mode === 'layout' ? (
                <LayoutBoard
                  rects={layoutRects}
                  corners={layoutCorners}
                  photos={cells}
                  liveIndex={liveCell}
                  selectedIndex={selectedCell}
                  livePreviewBehind={livePreviewBehind}
                  onSelect={selectCell}
                  onMove={moveCell}
                />
              ) : null}
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.blink, blinkStyle]} />
              {focusPoint ? <FocusRing key={focusPoint.key} x={focusPoint.x} y={focusPoint.y} /> : null}
              {filterLabel ? (
                <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
                  <Text style={[styles.filterLabel, styles.shadow]}>{filterLabel}</Text>
                </View>
              ) : null}
            </View>
          </GestureDetector>
        )}
      </View>

      {/* The front camera's flash: the screen turns white to light the face. */}
      {screenFlash ? (
        recording
          ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.screenFlashFrame]} />
          : <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.screenFlash]} />
      ) : null}

      {!recording ? (
        <View style={[styles.top, { top: insets.top + 8 }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close camera" onPress={onClose} style={styles.icon}>
            <Ionicons name="close" size={32} color="#fff" style={styles.shadow} />
          </Pressable>
          <View style={{ flex: 1 }} />
          {mode !== 'create' && flashAvailable ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Flash ${flash}`} onPress={() => setFlash((value) => (value === 'off' ? 'on' : value === 'on' ? 'auto' : 'off'))} style={styles.icon}>
              <Ionicons name={flash === 'off' ? 'flash-off' : 'flash'} size={26} color="#fff" style={styles.shadow} />
              {flash === 'auto' ? <Text style={styles.auto}>A</Text> : null}
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {!recording ? (
        <View style={[styles.rail, { top: insets.top + 90 }]}>
          {([
            { id: 'create', icon: 'text', label: 'Create' },
            { id: 'normal', icon: 'camera', label: 'Normal' },
            ...(hasStoryTools ? [{ id: 'boomerang', icon: 'infinite', label: 'Boomerang' }] : []),
            { id: 'layout', icon: 'grid', label: 'Layout' },
            { id: 'dual', icon: 'copy-outline', label: 'Dual' },
            { id: 'handsfree', icon: 'radio-button-on', label: 'Hands-free' },
          ] as Array<{ id: Mode; icon: string; label: string }>).map((entry) => (
            <Pressable key={entry.id} accessibilityRole="button" accessibilityLabel={entry.label} onPress={() => setMode(entry.id)} style={styles.railItem}>
              <View style={[styles.railIcon, mode === entry.id && styles.railIconActive]}>
                <Ionicons name={entry.icon as any} size={20} color={mode === entry.id ? '#000' : '#fff'} />
              </View>
              {mode === entry.id ? <Text style={[styles.railLabel, styles.shadow]}>{entry.label}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      {!recording && (mode === 'boomerang' || mode === 'layout' || mode === 'dual') ? (
        <View style={[styles.modeBar, { top: insets.top + previewHeight - RING - 84 }]}>
          {mode === 'boomerang' ? BOOMERANG_STYLES.map((entry) => (
            <Pressable key={entry.id} accessibilityRole="button" onPress={() => setBoomerangStyle(entry.id)} style={[styles.modeChip, boomerangStyle === entry.id && styles.modeChipActive]}>
              <Text style={[styles.modeChipText, boomerangStyle === entry.id && styles.modeChipTextActive]}>{entry.name}</Text>
            </Pressable>
          )) : null}
          {mode === 'layout' ? (
            selectedCell !== null ? (
              <>
                <Text style={[styles.modeHint, styles.shadow]}>Take or choose a photo to replace it</Text>
                <Pressable accessibilityRole="button" onPress={() => setSelectedCell(null)} style={styles.modeChip}>
                  <Text style={styles.modeChipText}>Cancel</Text>
                </Pressable>
              </>
            ) : cells.length ? (
              <>
                <Pressable accessibilityRole="button" accessibilityLabel="Remove last photo" onPress={() => setCells((current) => current.slice(0, -1))} style={styles.modeChip}>
                  <Ionicons name="arrow-undo" size={16} color="#fff" />
                </Pressable>
                <Text style={[styles.modeHint, styles.shadow]}>Tap a photo to retake · drag to move or swap</Text>
              </>
            ) : (Object.keys(LAYOUTS) as LayoutId[]).map((id) => (
              <Pressable key={id} accessibilityRole="button" accessibilityLabel={`Layout ${id}`} onPress={() => setLayoutId(id)} hitSlop={6}>
                <LayoutIcon id={id} active={layoutId === id} />
              </Pressable>
            ))
          ) : null}
          {mode === 'dual' ? <Text style={[styles.modeHint, styles.shadow]}>Takes a photo with both cameras</Text> : null}
        </View>
      ) : null}

      {recording && mode !== 'boomerang' ? (
        <View pointerEvents="box-none" style={[styles.zoomBar, { top: insets.top + previewHeight - RING - 112 }]}>
          <Text pointerEvents="none" style={[styles.zoomHint, styles.shadow]}>Hold · Slide right to zoom in, left to zoom out</Text>
          <GestureDetector gesture={trackGesture}>
          <View style={styles.zoomRow} collapsable={false}>
            <Ionicons name="remove" size={18} color="#fff" style={styles.shadow} />
            <View style={styles.zoomTrack}>
              <Animated.View style={[styles.zoomFill, zoomFillStyle]} />
              <Animated.View style={[styles.zoomThumb, zoomThumbStyle]} />
            </View>
            <Ionicons name="add" size={18} color="#fff" style={styles.shadow} />
          </View>
          </GestureDetector>
          <AnimatedTextInput
            editable={false}
            animatedProps={zoomLabelProps}
            defaultValue="1.0×"
            style={[styles.zoomLabel, styles.shadow]}
          />
        </View>
      ) : null}

      <View style={[styles.bottom, { top: insets.top + previewHeight - RING - 24 }]}>
        {!recording ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Open gallery" onPress={() => setGallery(true)} style={styles.thumb}>
            {latest ? <Image source={{ uri: latest }} style={StyleSheet.absoluteFill} /> : <Ionicons name="images-outline" size={22} color="#fff" />}
          </Pressable>
        ) : <View style={styles.thumbSpace} />}

        <GestureDetector gesture={shutterGesture}>
          <View style={styles.shutterWrap} accessibilityRole="button" accessibilityLabel={mode === 'handsfree' ? 'Record' : 'Take photo, or hold to record'}>
            <Animated.View style={[styles.shutterSlide, shutterShiftStyle]}>
            <Svg width={RING} height={RING} style={StyleSheet.absoluteFill}>
              <Circle cx={RING / 2} cy={RING / 2} r={RADIUS} stroke="rgba(255,255,255,0.9)" strokeWidth={5} fill="none" />
              {recording ? (
                <AnimatedCircle
                  cx={RING / 2} cy={RING / 2} r={RADIUS} stroke="#ED4956" strokeWidth={6} fill="none"
                  strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`} animatedProps={ringProps} strokeLinecap="round"
                  transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
                />
              ) : null}
            </Svg>
            <Animated.View style={[styles.shutter, mode === 'handsfree' && recording && styles.shutterStop, shutterStyle]}>
              {mode === 'create' ? <Text style={styles.createShutter}>Aa</Text> : null}
              {mode === 'boomerang' ? <Ionicons name="infinite" size={34} color="#000" /> : null}
              {mode === 'dual' ? <Ionicons name="copy-outline" size={28} color="#000" /> : null}
              {mode === 'layout' ? (
                selectedCell === null && cells.length >= LAYOUTS[layoutId].length
                  ? <Ionicons name="checkmark" size={38} color="#000" />
                  : <Text style={styles.createShutter}>{(selectedCell ?? cells.length) + 1}/{LAYOUTS[layoutId].length}</Text>
              ) : null}
            </Animated.View>
            </Animated.View>
          </View>
        </GestureDetector>

        {!recording && mode !== 'create' ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Flip camera" onPress={flip} style={styles.flip}>
            <Ionicons name="camera-reverse-outline" size={30} color="#fff" style={styles.shadow} />
          </Pressable>
        ) : <View style={styles.thumbSpace} />}
      </View>

      {gallery ? (
        <StoryGalleryPicker
          onClose={() => setGallery(false)}
          onPick={(media) => {
            setGallery(false);
            if (mode !== 'layout') {
              onCaptured(media);
              return;
            }
            // Layout: gallery photos fill the next cells in order, or replace the photo being retaken.
            const photos = media.filter((item) => item.kind === 'photo');
            if (selectedCell !== null) {
              if (photos[0]) addCell(photos[0]);
              return;
            }
            for (const entry of photos) addCell(entry);
          }}
          onOpenDraft={(draftId) => { setGallery(false); onOpenDraft(draftId); }}
        />
      ) : null}

      {processing ? (
        <View style={[StyleSheet.absoluteFill, styles.center, styles.processing]}>
          <ActivityIndicator color="#fff" size="large" />
          <Text style={styles.processingText}>{processing}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  preview: { position: 'absolute', left: 0, right: 0, borderRadius: 16, overflow: 'hidden', backgroundColor: '#111' },
  blink: { backgroundColor: '#000' },
  screenFlash: { backgroundColor: '#FFF8EE' },
  screenFlashFrame: { borderWidth: 70, borderColor: '#FFF8EE' },
  top: { position: 'absolute', left: 8, right: 8, flexDirection: 'row', alignItems: 'center' },
  icon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  auto: { position: 'absolute', right: 8, bottom: 8, color: '#fff', fontSize: 10, fontWeight: '800' },
  shadow: { textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 4 },
  rail: { position: 'absolute', left: 12, gap: 14 },
  railItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  railIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center' },
  railIconActive: { backgroundColor: '#fff' },
  railLabel: { color: '#fff', fontWeight: '700', fontSize: 14 },
  bottom: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 28 },
  thumb: { width: 40, height: 40, borderRadius: 8, borderWidth: 2, borderColor: '#fff', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumbSpace: { width: 40, height: 40 },
  shutterWrap: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  shutterSlide: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  shutter: { width: SHUTTER, height: SHUTTER, borderRadius: SHUTTER / 2, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterStop: { width: 40, height: 40, borderRadius: 8, backgroundColor: '#ED4956' },
  createShutter: { fontSize: 24, fontWeight: '800', color: '#000' },
  flip: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  focus: { position: 'absolute', width: 68, height: 68, borderRadius: 34, borderWidth: 2, borderColor: '#FFFFFF' },
  createHint: { color: '#fff', fontSize: 30, fontWeight: '700' },
  createSub: { color: 'rgba(255,255,255,0.8)', marginTop: 8 },
  permissionText: { color: '#fff', fontSize: 16, textAlign: 'center', marginHorizontal: 32 },
  permissionButton: { marginTop: 18, backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 20, paddingVertical: 10 },
  permissionButtonText: { color: '#000', fontWeight: '700' },
  link: { color: '#fff', fontWeight: '600' },
  filterLabel: { color: '#fff', fontSize: 28, fontWeight: '700' },
  liveBlurLayer: { filter: [{ blur: 22 }] },
  zoomBar: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 8 },
  zoomHint: { color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: '500' },
  zoomRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 24, backgroundColor: 'rgba(18,18,20,0.78)' },
  zoomTrack: { width: ZOOM_TRACK, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', justifyContent: 'center' },
  zoomFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2, backgroundColor: '#fff' },
  zoomThumb: { position: 'absolute', left: 0, width: ZOOM_THUMB, height: ZOOM_THUMB, borderRadius: ZOOM_THUMB / 2, backgroundColor: '#fff', borderWidth: 2, borderColor: 'rgba(0,0,0,0.15)' },
  zoomLabel: { color: '#fff', fontSize: 14, fontWeight: '800', padding: 0, textAlign: 'center', minWidth: 60 },
  modeBar: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  modeChip: { paddingHorizontal: 14, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  modeChipActive: { backgroundColor: '#fff' },
  modeChipText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  modeChipTextActive: { color: '#000' },
  modeHint: { color: '#fff', fontWeight: '600' },
  layoutIcon: { width: 24, height: 38, borderRadius: 4, borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)', overflow: 'hidden' },
  layoutIconActive: { borderColor: '#fff', backgroundColor: 'rgba(255,255,255,0.25)' },
  layoutIconCell: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)' },
  processing: { backgroundColor: 'rgba(0,0,0,0.55)' },
  processingText: { color: '#fff', fontWeight: '700', marginTop: 12 },
});
