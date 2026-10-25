import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { ActionCrop } from 'expo-image-manipulator';
import type { PhotoEdit, SelectedChatMedia } from './components/attachmentTypes';
import { hasPhotoEdit } from './photoEditing';

export async function exportPhoto(uri: string, edit?: PhotoEdit, crop?: ActionCrop['crop']) {
  const context = ImageManipulator.manipulate(uri);
  let image: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  try {
    if (edit?.rotation) context.rotate(edit.rotation);
    if (edit?.flipped) context.flip('horizontal');
    if (crop) context.crop(crop);
    image = await context.renderAsync();
    return await image.saveAsync({ compress: 1, format: SaveFormat.PNG });
  } finally { image?.release(); context.release(); }
}

export async function preparePhoto(item: SelectedChatMedia): Promise<SelectedChatMedia> {
  if (item.kind !== 'image' || !hasPhotoEdit(item.imageEdit)) return item;
  const result = await exportPhoto(item.currentUri, item.imageEdit);
  return { ...item, currentUri: result.uri, imageEdit: undefined, mimeType: 'image/png', size: undefined };
}
