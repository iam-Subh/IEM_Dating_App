import { Dimensions, PixelRatio } from 'react-native';
import { Images, type Image as NitroPicture } from 'react-native-nitro-image';
import { ImageFormat, Skia } from '@shopify/react-native-skia';
import { PREVIEW_SHARPEN, makeSharpenFilter } from './sharpen';

/**
 * Sharp, screen-sized pictures of photos in the editor, by file URI.
 *
 * React Native's <Image> on Android caps a decoded bitmap at 2048 px on its
 * longest side and shrinks by whole powers of two to get under it: a
 * 2608 × 4624 camera photo became about 652 × 1156, stretched twice over on
 * the screen, which looked hazy. A Nitro image resized to the screen's own
 * pixel size has no such cap, and is then sharpened like a phone camera photo.
 */
export type DisplayPicture = { picture: NitroPicture; sharpened: boolean };

const pictures = new Map<string, DisplayPicture>();
/** Few are kept: each is several megabytes of pixels. */
const LIMIT = 4;

export function registerDisplayImage(uri: string, picture: NitroPicture, sharpened = false) {
  pictures.delete(uri);
  pictures.set(uri, { picture, sharpened });
  while (pictures.size > LIMIT) {
    const oldest = pictures.keys().next().value;
    if (oldest === undefined) break;
    pictures.delete(oldest);
  }
}

export const displayImageFor = (uri: string): DisplayPicture | null => pictures.get(uri) ?? null;

/** Scales a picture down to the screen's size in physical pixels (never up). */
export async function fitForScreen(picture: NitroPicture): Promise<NitroPicture> {
  const screen = Dimensions.get('screen');
  const edge = Math.round(Math.max(screen.width, screen.height) * PixelRatio.get());
  const longest = Math.max(picture.width, picture.height);
  if (longest <= edge) return picture;
  const scale = edge / longest;
  const resized = await picture.resizeAsync(Math.max(1, Math.round(picture.width * scale)), Math.max(1, Math.round(picture.height * scale)));
  picture.dispose();
  return resized;
}

/**
 * The picture with the preview's sharpening applied: drawn once through an
 * unsharp mask with Skia, and returned as a Nitro image for display.
 */
export async function sharpenForPreview(picture: NitroPicture): Promise<NitroPicture> {
  const encoded = await picture.toEncodedImageDataAsync('jpg', 100);
  const source = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(new Uint8Array(encoded.buffer)));
  if (!source) return picture;
  const width = source.width();
  const height = source.height();
  const surface = Skia.Surface.MakeOffscreen(width, height) ?? Skia.Surface.Make(width, height);
  if (!surface) return picture;
  const paint = Skia.Paint();
  paint.setImageFilter(makeSharpenFilter(PREVIEW_SHARPEN));
  surface.getCanvas().drawImage(source, 0, 0, paint);
  surface.flush();
  const bytes = surface.makeImageSnapshot().encodeToBytes(ImageFormat.JPEG, 95);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return Images.loadFromEncodedImageDataAsync({ buffer, width, height, imageFormat: 'jpg' });
}
