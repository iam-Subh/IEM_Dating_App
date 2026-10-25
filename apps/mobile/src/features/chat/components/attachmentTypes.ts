export type AttachmentKind = 'image' | 'video' | 'file' | 'voice';

export interface SelectedChatMedia {
  id: string;
  originalUri: string;
  currentUri: string;
  kind: AttachmentKind;
  fileName?: string;
  mimeType?: string;
  size?: number | null;
  durationMs?: number | null;
  caption?: string;
  /** Trim, mute and cover chosen in the media editor. Videos only. */
  edit?: VideoEdit;
  /** Preview transforms. Applied to pixels only when cropping or sending. */
  imageEdit?: PhotoEdit;
}

export interface PhotoEdit { rotation: number; flipped: boolean }

/**
 * A video edit, in milliseconds of the original file.
 *
 * `applied` is set once the trimmed or muted file has been written and has
 * replaced `currentUri`, so a retried or resumed send never exports twice.
 * The times stay in original-file terms either way; the cover sent to the
 * server is made relative to `startMs` at upload.
 */
export interface VideoEdit {
  startMs: number;
  endMs: number;
  muted: boolean;
  coverMs: number | null;
  coverUri?: string | null;
  applied?: boolean;
}

/** Whether an edit needs a new file, rather than only a cover time. */
export function videoEditNeedsExport(edit: VideoEdit | undefined, durationMs: number | null | undefined): boolean {
  if (!edit || edit.applied) return false;
  const trimmedEnd = durationMs ? edit.endMs < durationMs - 50 : false;
  return edit.muted || edit.startMs > 50 || trimmedEnd;
}

/** The cover time relative to the file actually uploaded, if one was picked. */
export function uploadedCoverMs(edit: VideoEdit | undefined): number | undefined {
  if (!edit || edit.coverMs == null) return undefined;
  const clamped = Math.min(Math.max(edit.coverMs, edit.startMs), edit.endMs);
  return Math.max(0, Math.round(clamped - edit.startMs));
}

/** One user selection. Messages are emitted as albums of at most 10 items. */
export const MAX_CHAT_ATTACHMENTS = 100;
export const MAX_CHAT_ALBUM_ITEMS = 10;
