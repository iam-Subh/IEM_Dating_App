import { Alert, Platform } from 'react-native';
import { api } from '../../services/api';
import { photoExtFromAsset } from '../../utils/mediaFileExt';

/**
 * Finishing a profile upload, with the nudity check's answer
 * (docs/NUDITY_CHECK.md): `review` - saved, but shown to others only once the
 * team approves it. An explicit photo or video is refused by the server with
 * the code MEDIA_EXPLICIT and a message to show as it is.
 */
export async function completeProfileUpload(assetId: string) {
  const response = await api.post(`/upload/${assetId}/complete`);
  return { review: !!response.data?.data?.review };
}

/**
 * Uploads a photo the moment it is picked, so the nudity check answers before
 * Save: a refused photo is gone at once with its reason, a borderline one is
 * marked "In review". Save then uses `fileUrl` without uploading again.
 */
export async function precheckPhoto(uri: string, mimeType?: string | null) {
  const presign = await api.post('/upload/presigned-urls', { files: [{ type: 'photo', ext: photoExtFromAsset(uri, mimeType ?? undefined) }] });
  const ticket = presign.data.data[0];
  const blob = await (await fetch(Platform.OS === 'ios' ? uri.replace('file://', '') : uri)).blob();
  const put = await fetch(ticket.uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': ticket.contentType } });
  if (!put.ok) throw new Error('Photo upload failed');
  const { review } = await completeProfileUpload(ticket.assetId);
  return { fileUrl: ticket.fileUrl as string, review };
}

export function explicitUploadMessage(error: any): string | null {
  return error?.response?.data?.code === 'MEDIA_EXPLICIT' ? (error.response.data.message as string) : null;
}

/** "Being checked": once per save, however many files are waiting. */
export function tellBeingChecked(kind: 'photo' | 'video', count = 1) {
  const what = kind === 'video' ? 'Your video is' : count > 1 ? `${count} photos are` : 'Your photo is';
  Alert.alert('Being checked', `${what} being checked by our team. It appears on your profile once approved - usually within a day. Until then, only you can see it.`);
}
