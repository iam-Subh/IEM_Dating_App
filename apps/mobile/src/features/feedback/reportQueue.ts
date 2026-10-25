import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { AppState } from 'react-native';
import { api } from '../../services/api';
import { recordSetback } from './engagement';

/**
 * Sending a bug report (docs/FEEDBACK.md), and keeping it until it is sent:
 * with no signal the report waits on the phone - its files copied out of the
 * cache - and goes the next time the app opens. The server knows a retry by
 * its clientId, so nothing is ever sent twice.
 */
export type Area = 'chat' | 'photos' | 'matches' | 'explore' | 'stories' | 'login' | 'notifications' | 'other';
export type Source = 'form' | 'shake' | 'error' | 'rating';
export type Attachment = { kind: 'photo' | 'video'; uri: string };
export type PendingReport = {
  clientId: string; area: Area; description: string; source: Source;
  diagnostics: Record<string, unknown> | null; attachments: Attachment[];
  createdAt: string; tries: number;
};
export type SendResult =
  | { state: 'sent'; reference: string; skippedFiles: number }
  | { state: 'queued' }
  | { state: 'refused'; message: string };

const QUEUE_KEY = 'feedback.queue.v1';
const DIR = `${FileSystem.documentDirectory}feedback/`;
const FILE_TRIES = 3;

async function readQueue(): Promise<PendingReport[]> {
  try { return JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) ?? '[]'); } catch { return []; }
}
async function writeQueue(items: PendingReport[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items)).catch(() => undefined);
}

/** Files leave the cache (which Android may clear) for the app's own folder. */
async function keepFiles(attachments: Attachment[], clientId: string) {
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => undefined);
  return Promise.all(attachments.map(async (item, index) => {
    if (item.uri.startsWith(DIR)) return item;
    const target = `${DIR}${clientId}-${index}.${item.kind === 'photo' ? 'jpg' : 'mp4'}`;
    try { await FileSystem.copyAsync({ from: item.uri, to: target }); return { ...item, uri: target }; } catch { return item; }
  }));
}
async function dropFiles(report: PendingReport) {
  await Promise.all(report.attachments.filter((item) => item.uri.startsWith(DIR))
    .map((item) => FileSystem.deleteAsync(item.uri, { idempotent: true }).catch(() => undefined)));
}

const offline = (error: any) => !error?.response; // no answer at all: no signal, or the server is down

async function upload(reportId: string, ticket: { attachmentId: string; uploadUrl: string; contentType: string }, file: Attachment) {
  for (let attempt = 1; attempt <= FILE_TRIES; attempt += 1) {
    try {
      const result = await FileSystem.uploadAsync(ticket.uploadUrl, file.uri, {
        httpMethod: 'PUT', headers: { 'Content-Type': ticket.contentType },
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      });
      if (result.status < 200 || result.status >= 300) throw new Error(`upload ${result.status}`);
      await api.post(`/feedback/reports/${reportId}/attachments/${ticket.attachmentId}/complete`);
      return true;
    } catch (error: any) {
      // The server looked and said no (too big, not a photo): trying again won't help.
      if (error?.response?.status === 400) return false;
      if (attempt === FILE_TRIES) return false;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  return false;
}

async function sendOne(report: PendingReport): Promise<SendResult> {
  try {
    const response = await api.post('/feedback/reports', {
      clientId: report.clientId, area: report.area, description: report.description, source: report.source,
      diagnostics: report.diagnostics, attachments: report.attachments.map((item) => ({ kind: item.kind })),
    });
    const { id, reference, uploads } = response.data.data as { id: string; reference: string; uploads: { attachmentId: string; kind: 'photo' | 'video'; uploadUrl: string; contentType: string }[] };
    // A retry only gets links for the files still missing; match them up by kind, in order.
    const left = { photo: report.attachments.filter((item) => item.kind === 'photo'), video: report.attachments.filter((item) => item.kind === 'video') };
    const offset = { photo: Math.max(0, left.photo.length - uploads.filter((item) => item.kind === 'photo').length), video: Math.max(0, left.video.length - uploads.filter((item) => item.kind === 'video').length) };
    let skippedFiles = 0;
    for (const ticket of uploads) {
      const file = left[ticket.kind][offset[ticket.kind]++];
      if (!file || !(await upload(id, ticket, file))) skippedFiles += 1;
    }
    return { state: 'sent', reference, skippedFiles };
  } catch (error: any) {
    if (offline(error)) return { state: 'queued' };
    return { state: 'refused', message: error.response?.data?.message ?? "We couldn't send your report. Try again." };
  }
}

let flushing: Promise<void> | null = null;

/** Sends what waited for a signal. On start-up and whenever the app comes back. */
export function flushQueue() {
  if (flushing) return flushing;
  flushing = (async () => {
    const queue = await readQueue();
    if (!queue.length) return;
    const keep: PendingReport[] = [];
    for (const report of queue) {
      const result = await sendOne(report);
      if (result.state === 'queued' && report.tries < 20) keep.push({ ...report, tries: report.tries + 1 });
      else await dropFiles(report);
    }
    await writeQueue(keep);
  })().finally(() => { flushing = null; });
  return flushing;
}

let listening = false;
export function startQueue() {
  if (listening) return;
  listening = true;
  void flushQueue();
  AppState.addEventListener('change', (state) => { if (state === 'active') void flushQueue(); });
}

export function newClientId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Send now; with no signal, keep it and send later. */
export async function submitReport(input: Omit<PendingReport, 'createdAt' | 'tries'>): Promise<SendResult> {
  const report: PendingReport = { ...input, attachments: await keepFiles(input.attachments, input.clientId), createdAt: new Date().toISOString(), tries: 0 };
  const result = await sendOne(report);
  if (result.state === 'queued') await writeQueue([...(await readQueue()).filter((item) => item.clientId !== report.clientId), report]);
  else await dropFiles(report);
  // Someone who just hit a problem is not asked to rate the app for a while.
  if (result.state !== 'refused') void recordSetback();
  return result;
}
