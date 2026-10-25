import type { RefObject } from 'react';
import type { View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { FilterMode, ImageFormat, MipmapMode, Skia, TileMode, makeImageFromView, type SkImage } from '@shopify/react-native-skia';

// Skia's plain drawImageRect samples the nearest pixel, which made a photo
// shrunk onto the story rough and soft-looking and blocked the text layer.
// Mitchell cubic (B = C = 1/3) for photos; linear for the decorations.
const CUBIC_B = 1 / 3;
const CUBIC_C = 1 / 3;
import { CANVAS, type StoryDraftItem } from '../composition/types';
import { baseMediaSize, isLiveLayer } from '../composition/story';
import { colorMatrix, filterById, isNeutral } from '../filters';
import { STORY_SHARPEN, makeSharpenFilter } from '../sharpen';

/**
 * Turns an edited story into the files that are uploaded.
 *
 * The editor stage has two parts that are captured differently. Decorative
 * layers (text, drawing, emoji, GIFs, photo stickers) are a React view,
 * captured as a transparent image. The media, its filter and the background are
 * drawn here with Skia from the original file at 1080 × 1920, so a photo keeps
 * its full resolution instead of the screen's.
 */

const OUTPUT_DIR = `${FileSystem.documentDirectory}story-posts/`;

export async function postDirectory(batchId: string) {
  const dir = `${OUTPUT_DIR}${batchId}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
  return dir;
}

export const deletePostDirectory = (batchId: string) =>
  FileSystem.deleteAsync(`${OUTPUT_DIR}${batchId}/`, { idempotent: true }).catch(() => undefined);

/** The decorative layers exactly as they are on screen, with transparency. */
export async function captureDecorations(ref: RefObject<View | null>): Promise<SkImage | null> {
  return makeImageFromView(ref as RefObject<any>);
}

async function loadImage(uri: string): Promise<SkImage> {
  const data = await Skia.Data.fromURI(uri);
  const image = Skia.Image.MakeImageFromEncoded(data);
  if (!image) throw new Error('The photo could not be read');
  return image;
}

function drawBackground(canvas: ReturnType<NonNullable<ReturnType<typeof Skia.Surface.Make>>['getCanvas']>, colours: string[]) {
  const paint = Skia.Paint();
  if (colours.length <= 1) {
    paint.setColor(Skia.Color(colours[0] ?? '#000000'));
  } else {
    paint.setShader(Skia.Shader.MakeLinearGradient(
      { x: 0, y: 0 },
      { x: 0, y: CANVAS.height },
      colours.map((colour) => Skia.Color(colour)),
      null,
      TileMode.Clamp,
    ));
  }
  canvas.drawRect(Skia.XYWHRect(0, 0, CANVAS.width, CANVAS.height), paint);
}

async function writeImage(image: SkImage, path: string, format: ImageFormat, quality: number) {
  const base64 = image.encodeToBase64(format, quality);
  await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
  const info = await FileSystem.getInfoAsync(path);
  return { uri: path, size: info.exists ? info.size ?? 0 : 0 };
}

/** The finished photo story: background, filtered photo, then decorations. JPEG, 1080 × 1920. */
export async function renderPhoto(item: StoryDraftItem, decorations: SkImage | null, path: string) {
  const surface = Skia.Surface.Make(CANVAS.width, CANVAS.height);
  if (!surface) throw new Error('The story could not be drawn');
  const canvas = surface.getCanvas();
  drawBackground(canvas, item.background);

  const photo = await loadImage(item.media.uri);
  const size = baseMediaSize({ width: photo.width(), height: photo.height() }, item.fitMode);
  const { x, y, scale, rotation } = item.mediaTransform;
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  const filter = filterById(item.filterId).params;
  if (!isNeutral(filter)) paint.setColorFilter(Skia.ColorFilter.MakeMatrix(colorMatrix(filter)));
  // The same crisp look as the editor preview, applied at the story's own size.
  paint.setImageFilter(makeSharpenFilter(STORY_SHARPEN));
  canvas.save();
  canvas.translate(x, y);
  canvas.rotate(rotation, 0, 0);
  canvas.scale(scale, scale);
  canvas.drawImageRectCubic(
    photo,
    Skia.XYWHRect(0, 0, photo.width(), photo.height()),
    Skia.XYWHRect(-size.width / 2, -size.height / 2, size.width, size.height),
    CUBIC_B,
    CUBIC_C,
    paint,
  );
  canvas.restore();

  if (decorations) {
    canvas.drawImageRectOptions(
      decorations,
      Skia.XYWHRect(0, 0, decorations.width(), decorations.height()),
      Skia.XYWHRect(0, 0, CANVAS.width, CANVAS.height),
      FilterMode.Linear,
      MipmapMode.None,
      Skia.Paint(),
    );
  }
  surface.flush();
  const image = surface.makeImageSnapshot();
  return writeImage(image, path, ImageFormat.JPEG, 92);
}

/** Decorations for a video story, scaled to 1080 × 1920 and kept transparent. PNG. */
export async function renderOverlay(decorations: SkImage, path: string) {
  const surface = Skia.Surface.Make(CANVAS.width, CANVAS.height);
  if (!surface) throw new Error('The story could not be drawn');
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));
  canvas.drawImageRectOptions(
    decorations,
    Skia.XYWHRect(0, 0, decorations.width(), decorations.height()),
    Skia.XYWHRect(0, 0, CANVAS.width, CANVAS.height),
    FilterMode.Linear,
    MipmapMode.None,
    Skia.Paint(),
  );
  surface.flush();
  return writeImage(surface.makeImageSnapshot(), path, ImageFormat.PNG, 100);
}

/** Whether a story has anything to bake into its media besides the photo or video itself. */
export const hasDecorations = (item: StoryDraftItem) =>
  item.drawing.length > 0 || item.layers.some((layer) => !isLiveLayer(layer));
