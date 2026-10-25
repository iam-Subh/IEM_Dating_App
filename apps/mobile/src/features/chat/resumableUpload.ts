import { ChatMedia, hasBackgroundUploads } from '../../../modules/chat-media';
import { api } from '../../services/api';

/**
 * Large attachments upload in parts from a background job.
 *
 * A single presigned PUT restarts from zero after any network drop and dies
 * when Android stops the app. Telegram splits big files into parts and keeps
 * sending after you leave the chat; this does the same with an S3 multipart
 * upload driven by WorkManager, so a 300 MB video survives a train tunnel and
 * the app being swiped away.
 */
export const RESUMABLE_UPLOAD_MIN_BYTES = 16 * 1024 * 1024;

/** What a queued message remembers so a restarted app re-attaches to its upload. */
export interface ResumableUploadRef {
  assetId: string;
  expiresAt: string;
}

export class ResumableUploadLostError extends Error {}

export function shouldUploadResumably(size: number, existing?: ResumableUploadRef | null): boolean {
  return hasBackgroundUploads && (Boolean(existing) || size >= RESUMABLE_UPLOAD_MIN_BYTES);
}

function usable(ref: ResumableUploadRef | null | undefined): ref is ResumableUploadRef {
  // A minute of margin so the upload is not handed URLs that expire mid-part.
  return Boolean(ref && Date.parse(ref.expiresAt) > Date.now() + 60_000);
}

/**
 * Makes sure the parts of this file reach storage, starting or resuming the
 * background upload as needed. Resolves with the asset to complete.
 */
export async function sendResumably({
  matchId, extension, uri, size, title, existing, onSession, onProgress, signal,
}: {
  matchId: string;
  extension: string;
  uri: string;
  size: number;
  title: string;
  existing?: ResumableUploadRef | null;
  onSession: (ref: ResumableUploadRef | null) => void;
  onProgress: (percent: number) => void;
  signal?: AbortSignal;
}): Promise<string> {
  if (!ChatMedia) throw new Error('Background uploads are not available in this build.');
  let ref = usable(existing) ? existing : null;

  if (ref) {
    const status = await ChatMedia.getUpload(ref.assetId);
    // Nothing on the device knows this upload. It either finished and was
    // forgotten, or never started; completion on the server will tell which.
    if (status.state === 'unknown') return ref.assetId;
    if (status.state === 'failed' || status.state === 'cancelled' || status.state === 'interrupted') {
      if (status.state === 'failed' && /expired|cancelled|no longer/i.test(status.error ?? '')) {
        await discardResumable(matchId, ref);
        onSession(null);
        ref = null;
      } else {
        // KEEP replaces finished work, so this restarts the same job and the
        // parts already stored are skipped.
        await ChatMedia.enqueueUpload({ jobId: ref.assetId, uri, partSize: 0, parts: [], title });
      }
    }
  }

  if (!ref) {
    const response = await api.post(`/chat/${matchId}/media/multipart`, { ext: extension, size });
    const ticket = response.data?.data as {
      assetId: string; partSize: number; parts: Array<{ partNumber: number; url: string }>; expiresAt: string;
    } | undefined;
    if (!response.data?.success || !ticket?.assetId) throw new Error('The server did not create an upload.');
    await ChatMedia.enqueueUpload({ jobId: ticket.assetId, uri, partSize: ticket.partSize, parts: ticket.parts, title });
    ref = { assetId: ticket.assetId, expiresAt: ticket.expiresAt };
    onSession(ref);
  }

  await waitForUpload(ChatMedia, ref.assetId, onProgress, signal);
  return ref.assetId;
}

function waitForUpload(
  native: NonNullable<typeof ChatMedia>,
  assetId: string,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let poll: ReturnType<typeof setTimeout> | undefined;
    const report = (sent: number, total: number) => {
      if (total > 0) onProgress(Math.min(99, Math.floor((sent * 100) / total)));
    };
    const subscription = native.addListener('uploadProgress', (event) => {
      if (event.jobId === assetId) report(event.bytesSent, event.totalBytes);
    });
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      subscription.remove();
      if (poll) clearTimeout(poll);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => {
      const error = new Error('Upload cancelled');
      error.name = 'AbortError';
      settle(error);
    };
    // Events stop while JavaScript is paused in the background, and a job can
    // finish in a process JavaScript never saw, so the job's state is polled too.
    const check = async () => {
      if (settled) return;
      try {
        const status = await native.getUpload(assetId);
        report(status.bytesSent, status.totalBytes);
        if (status.state === 'succeeded') return settle();
        if (status.state === 'failed') return settle(new Error(status.error || 'The upload failed.'));
        if (status.state === 'cancelled') return settle(new Error('The upload was cancelled.'));
        if (status.state === 'unknown') return settle(new ResumableUploadLostError('The upload is no longer on this device.'));
        if (status.state === 'interrupted') {
          await native.enqueueUpload({ jobId: assetId, uri: '', partSize: 0, parts: [], title: 'Sending media' });
        }
      } catch {
        // Transient; the next poll decides.
      }
      if (!settled) poll = setTimeout(check, 1500);
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort);
    void check();
  });
}

/** Stops the device's upload and frees the parts already stored. */
export async function discardResumable(matchId: string, ref: ResumableUploadRef): Promise<void> {
  await ChatMedia?.cancelUpload(ref.assetId).catch(() => undefined);
  await api.delete(`/chat/${matchId}/media/${ref.assetId}/multipart`).catch(() => undefined);
}

/** Drops the device's record of an upload the server has accepted. */
export function forgetResumable(ref: ResumableUploadRef): void {
  void ChatMedia?.forgetUpload(ref.assetId).catch(() => undefined);
}
