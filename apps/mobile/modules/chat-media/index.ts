import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

export type VideoInfo = {
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
  bitrate: number;
  size: number;
};

export type VideoExportResult = { uri: string; size: number; durationMs: number };

export type UploadState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'unknown';

export type UploadStatus = {
  state: UploadState;
  bytesSent: number;
  totalBytes: number;
  error?: string | null;
};

type Subscription = { remove: () => void };

/** Filter parameters shared by the editor's colour matrix and the native export. */
export type StoryFilterParams = { brightness: number; contrast: number; saturation: number; warmth: number; grayscale: boolean };

export type StoryBatchItemInput = {
  itemId: string;
  kind: 'photo' | 'video';
  /** A rendered JPEG for a photo; the source video for a video. */
  sourceUri: string;
  clipStartMs?: number | null;
  clipEndMs?: number | null;
  muted?: boolean;
  filter?: StoryFilterParams | null;
  transform?: { x: number; y: number; scale: number; rotation: number } | null;
  fitMode?: 'cover' | 'contain';
  background?: string[];
  /** Transparent PNG of the decorative layers, 1080 × 1920. */
  overlayUri?: string | null;
  music?: { url: string; startMs: number; lengthMs: number; videoVolume: number; musicVolume: number } | null;
};

export type StoryBatchInput = {
  batchId: string;
  apiBaseUrl: string;
  publishToken: string;
  title: string;
  items: StoryBatchItemInput[];
};

export type StoryBatchItemStatus = 'pending' | 'published' | 'rejected' | 'cancelled' | 'failed';

export type StoryBatchStatus = {
  batchId: string;
  status: 'posting' | 'completed' | 'failed' | 'cancelled';
  workState: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
  error: string | null;
  progress: number;
  items: Array<{ itemId: string; status: StoryBatchItemStatus; error: string | null; story: string | null }>;
};

export type StoryBatchProgressEvent = {
  batchId: string;
  itemId: string | null;
  phase: 'exporting' | 'uploading' | 'publishing' | 'published' | 'rejected' | 'cancelled' | 'completed' | 'failed';
  progress: number;
  /** JSON of the published story, on `published`. */
  story: string | null;
  error: string | null;
};

export type BoomerangStyle = 'classic' | 'slomo' | 'echo' | 'duo';
export type PhotoEffect = 'blur' | 'mono' | 'studio' | 'glasses' | 'crown' | 'hearts';
export type MediaFile = { uri: string; width: number; height: number };

type NativeChatMedia = {
  saveStoryVideo(item: StoryBatchItemInput): Promise<string>;
  makeBoomerang(uri: string, style: BoomerangStyle): Promise<MediaFile & { durationMs: number }>;
  cutoutSubject(uri: string): Promise<MediaFile>;
  applyPhotoEffect(uri: string, effect: PhotoEffect): Promise<MediaFile>;
  extractAudio(uri: string, startMs: number, endMs: number | null): Promise<string>;
  /** Blocks screenshots and screen recording on every app window. Absent on builds that predate it. */
  setScreenCaptureBlocked?(blocked: boolean): Promise<void>;
  getVideoInfo(uri: string): Promise<VideoInfo>;
  generateFrames(uri: string, count: number, maxHeight: number): Promise<string[]>;
  frameAt(uri: string, timeMs: number, maxHeight: number): Promise<string>;
  exportVideo(options: { id: string; uri: string; startMs: number; endMs: number | null; removeAudio: boolean }): Promise<VideoExportResult>;
  cancelExport(id: string): void;
  enqueueUpload(options: {
    jobId: string;
    uri: string;
    partSize: number;
    parts: Array<{ partNumber: number; url: string }>;
    title: string;
  }): Promise<void>;
  getUpload(jobId: string): Promise<UploadStatus>;
  cancelUpload(jobId: string): Promise<void>;
  forgetUpload(jobId: string): Promise<void>;
  /** A message's media sending in the status bar: one bar per message (TransferNotifications). */
  showTransferProgress?(key: string, title: string, percent: number): void;
  /** The outcome, replacing the bar; a success clears itself after a few seconds. */
  finishTransfer?(key: string, title: string, text: string | null, ok: boolean): void;
  cancelTransfer?(key: string): void;
  addListener(event: 'uploadProgress', listener: (event: { jobId: string; bytesSent: number; totalBytes: number }) => void): Subscription;
  addListener(event: 'exportProgress', listener: (event: { id: string; progress: number }) => void): Subscription;
  addListener(event: 'storyBatchProgress', listener: (event: StoryBatchProgressEvent) => void): Subscription;
  enqueueStoryBatch(input: StoryBatchInput): Promise<void>;
  getStoryBatch(batchId: string): Promise<StoryBatchStatus | null>;
  listStoryBatches(): Promise<StoryBatchStatus[]>;
  retryStoryBatch(batchId: string): Promise<void>;
  cancelStoryBatch(batchId: string): Promise<void>;
  forgetStoryBatch(batchId: string): Promise<void>;
};

/**
 * Android's chat media module, or null on a build that predates it.
 *
 * Every caller must keep working without it: an old development client simply
 * sends videos unedited through the single-request upload path.
 */
export const ChatMedia = Platform.OS === 'android'
  ? requireOptionalNativeModule<NativeChatMedia>('ChatMedia')
  : null;

export const hasVideoEditing = ChatMedia != null;
export const hasBackgroundUploads = ChatMedia != null;
/** False on a development build that predates background story posting. */
/** False on a development build that predates Boomerang, cutouts, effects, captions and video saving. */
export const hasStoryTools = ChatMedia != null && typeof (ChatMedia as Partial<NativeChatMedia>).makeBoomerang === 'function';
export const hasStoryPosting =ChatMedia != null && typeof (ChatMedia as Partial<NativeChatMedia>).enqueueStoryBatch === 'function';
