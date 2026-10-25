import AsyncStorage from '@react-native-async-storage/async-storage';
import { store } from '../../store';
import { SelectedChatMedia } from './components/attachmentTypes';
import type { ResumableUploadRef } from './resumableUpload';

export interface PersistentMediaUploadJob {
  tempId: string;
  matchId: string;
  items: SelectedChatMedia[];
  mediaKeys: Array<string | null>;
  content: string;
  replyToId?: string;
  messageType: 'media' | 'document' | 'voice';
  messageMetadata?: Record<string, unknown>;
  queuedAt: number;
  /** Background uploads in flight, per item, so a restarted app resumes them. */
  resumable?: Array<ResumableUploadRef | null>;
}

let mutation: Promise<void> = Promise.resolve();

function queueKey(): string | null {
  const userId = store.getState().auth.user?.id;
  return userId ? `@chat:mediaQueue:${userId}` : null;
}

async function read(key: string | null): Promise<PersistentMediaUploadJob[]> {
  if (!key) return [];
  try {
    const value = await AsyncStorage.getItem(key);
    return value ? JSON.parse(value) : [];
  } catch {
    return [];
  }
}

function serialize(work: () => Promise<void>): Promise<void> {
  const result = mutation.then(work, work);
  mutation = result.catch(() => undefined);
  return result;
}

export function getPersistentMediaJobs(): Promise<PersistentMediaUploadJob[]> {
  return read(queueKey());
}

export function savePersistentMediaJob(job: PersistentMediaUploadJob): Promise<void> {
  const key = queueKey();
  return serialize(async () => {
    if (!key) return;
    const jobs = await read(key);
    const next = jobs.filter((item) => item.tempId !== job.tempId);
    next.push(job);
    await AsyncStorage.setItem(key, JSON.stringify(next));
  });
}

export function removePersistentMediaJob(tempId: string): Promise<void> {
  const key = queueKey();
  return serialize(async () => {
    if (!key) return;
    const jobs = await read(key);
    await AsyncStorage.setItem(key, JSON.stringify(jobs.filter((item) => item.tempId !== tempId)));
  });
}
