import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, DownloadTask, File as FileSystemFile, Paths, type DownloadPauseState } from 'expo-file-system';

export type ChatDownloadStatus = 'idle' | 'downloading' | 'paused' | 'complete' | 'failed' | 'cancelled';
export interface ChatDownloadRecord {
  key: string;
  url: string;
  fileName: string;
  localUri?: string;
  progress: number;
  status: ChatDownloadStatus;
  error?: string;
  pauseState?: DownloadPauseState;
  updatedAt: number;
}

const STORAGE_KEY = '@chat:downloads:v2';
const records = new Map<string, ChatDownloadRecord>();
const tasks = new Map<string, DownloadTask>();
const listeners = new Set<() => void>();
let version = 0;
let loaded = false;

function emit() { version += 1; listeners.forEach((listener) => listener()); }
function safeFileName(key: string, value: string): string {
  return `${key.replace(/[^a-z0-9]/gi, '').slice(-16)}-${value.replace(/[\\/:*?"<>|]/g, '_') || 'file'}`;
}
async function persist() {
  const saved = [...records.values()].filter((record) => record.status === 'complete' || record.status === 'paused');
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}
function progressFor(key: string) {
  return ({ bytesWritten, totalBytes }: { bytesWritten: number; totalBytes: number }) => {
    const record = records.get(key);
    if (!record || totalBytes <= 0) return;
    record.progress = Math.min(100, Math.round(bytesWritten * 100 / totalBytes));
    record.updatedAt = Date.now();
    emit();
  };
}
function waitForCompletion(key: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const unsubscribe = subscribeChatDownloads(() => {
      const record = records.get(key);
      if (record?.status === 'complete' && record.localUri) { unsubscribe(); resolve(record.localUri); }
      if (record?.status === 'failed' || record?.status === 'cancelled') { unsubscribe(); reject(new Error(record.error ?? 'Download stopped')); }
    });
  });
}

export async function initializeChatDownloads(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) as ChatDownloadRecord[] : [];
    saved.forEach((record) => {
      if (record.status === 'paused' && record.pauseState) records.set(record.key, record);
      else {
        try {
          if (record.localUri && new FileSystemFile(record.localUri).exists) records.set(record.key, record);
        } catch { /* Ignore removed files. */ }
      }
    });
    emit();
  } catch { /* The download cache is optional. */ }
}

void initializeChatDownloads();

export function subscribeChatDownloads(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); }
export function chatDownloadVersion() { return version; }
export function getChatDownload(key: string): ChatDownloadRecord | undefined { return records.get(key); }
export function getChatDownloads(): ChatDownloadRecord[] { return [...records.values()].sort((a, b) => b.updatedAt - a.updatedAt); }

async function runDownload(key: string, task: DownloadTask, resume: boolean): Promise<string> {
  tasks.set(key, task);
  try {
    const file = resume ? await task.resumeAsync() : await task.downloadAsync();
    if (!file && task.state === 'paused') {
      const record = records.get(key)!;
      Object.assign(record, { status: 'paused', pauseState: task.savable(), updatedAt: Date.now() });
      await persist();
      emit();
      return waitForCompletion(key);
    }
    if (!file) throw new Error('Download did not return a file');
    const record = records.get(key)!;
    Object.assign(record, { localUri: file.uri, progress: 100, status: 'complete', error: undefined, pauseState: undefined, updatedAt: Date.now() });
    tasks.delete(key);
    await persist();
    emit();
    return file.uri;
  } catch (error) {
    const record = records.get(key)!;
    if (task.state === 'paused') return waitForCompletion(key);
    Object.assign(record, {
      status: task.state === 'cancelled' ? 'cancelled' : 'failed',
      error: error instanceof Error ? error.message : 'Download failed',
      pauseState: undefined,
      updatedAt: Date.now(),
    });
    tasks.delete(key);
    await persist();
    emit();
    throw error;
  }
}

export async function downloadChatFile(key: string, url: string, fileName: string): Promise<string> {
  await initializeChatDownloads();
  const existing = records.get(key);
  if (existing?.status === 'complete' && existing.localUri && new FileSystemFile(existing.localUri).exists) return existing.localUri;
  if (existing?.status === 'paused') {
    void resumeChatDownload(key);
    return waitForCompletion(key);
  }
  if (tasks.has(key)) return waitForCompletion(key);
  const directory = new Directory(Paths.document, 'chat-downloads');
  directory.create({ idempotent: true, intermediates: true });
  const destination = new FileSystemFile(directory, safeFileName(key, fileName));
  if (destination.exists) destination.delete();
  const task = FileSystemFile.createDownloadTask(url, destination, { onProgress: progressFor(key) });
  records.set(key, { key, url, fileName, progress: 0, status: 'downloading', updatedAt: Date.now() });
  emit();
  return runDownload(key, task, false);
}

export async function pauseChatDownload(key: string): Promise<void> {
  const task = tasks.get(key);
  if (!task || task.state !== 'active') return;
  await task.pauseAsync();
  const record = records.get(key);
  if (!record) return;
  Object.assign(record, { status: 'paused', pauseState: task.savable(), updatedAt: Date.now() });
  await persist();
  emit();
}

export async function resumeChatDownload(key: string): Promise<void> {
  await initializeChatDownloads();
  const record = records.get(key);
  if (!record?.pauseState) return;
  const task = tasks.get(key) ?? DownloadTask.fromSavable(record.pauseState, { onProgress: progressFor(key) });
  Object.assign(record, { status: 'downloading', error: undefined, updatedAt: Date.now() });
  emit();
  void runDownload(key, task, true).catch(() => undefined);
}

export function cancelChatDownload(key: string) {
  tasks.get(key)?.cancel();
  tasks.delete(key);
  const record = records.get(key);
  if (record) Object.assign(record, { status: 'cancelled', error: 'Download cancelled', pauseState: undefined, updatedAt: Date.now() });
  void persist();
  emit();
}

export function removeChatDownload(key: string) {
  cancelChatDownload(key);
  const record = records.get(key);
  if (record?.localUri) {
    try { new FileSystemFile(record.localUri).delete(); } catch { /* File was already removed. */ }
  }
  records.delete(key);
  void persist();
  emit();
}
