import * as FileSystem from 'expo-file-system/legacy';
import { api } from '../../../services/api';
import type { CaptionSegment } from './composition/types';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Captions for a video's sound (an AAC file): uploaded to the private bucket,
 * transcribed by the server, and returned as timed lines.
 */
export async function transcribeAudio(audioUri: string): Promise<CaptionSegment[]> {
  const created = await api.post('/stories/captions');
  const { jobId, uploadUrl } = created.data.data as { jobId: string; uploadUrl: string };
  const upload = await FileSystem.uploadAsync(uploadUrl, audioUri, {
    httpMethod: 'PUT',
    headers: { 'Content-Type': 'audio/mp4' },
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
  });
  if (upload.status < 200 || upload.status >= 300) throw new Error('The sound could not be uploaded');
  await api.post(`/stories/captions/${jobId}/start`);

  const deadline = Date.now() + 4 * 60_000;
  while (Date.now() < deadline) {
    await wait(3000);
    const response = await api.get(`/stories/captions/${jobId}`);
    const result = response.data.data as { status: 'processing' | 'done' | 'failed'; segments?: CaptionSegment[] };
    if (result.status === 'done') return result.segments ?? [];
    if (result.status === 'failed') throw new Error('The captions could not be made');
  }
  throw new Error('Captions took too long');
}
