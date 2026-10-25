import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { requestPermissionsAsync, saveToLibraryAsync } from 'expo-media-library';
import { ChatMedia, hasStoryPosting, type StoryBatchItemInput } from '../../../../../modules/chat-media';
import { api } from '../../../../services/api';
import type { TrayStory } from '../../storyTypes';
import type { StoryDraftItem, StoryServerComposition } from '../composition/types';
import { deleteDraft } from '../drafts/draftStore';
import { deletePostDirectory } from '../render/renderStory';
import type { StoryAudience } from '../../settings/storySettings';
import { loadStorySource } from '../../storySources';

/**
 * Stories being posted in the background, for the tray ring, the "Posting…"
 * label, and Try again / Discard / Cancel.
 *
 * The app creates the batch on the server, then hands it to the native worker,
 * which does the rest without JavaScript. This store mirrors the worker: it
 * listens to its progress events while the app runs, and reconciles with the
 * worker's saved state when the app comes back. See STORY_CREATION_SPEC.md §11.
 */

export type PreparedStory = {
  itemId: string;
  kind: 'photo' | 'video';
  durationMs: number;
  partIndex?: number;
  partCount?: number;
  composition: StoryServerComposition;
  /** Size of a rendered photo; videos are measured after export. */
  size?: number;
  native: StoryBatchItemInput;
};

export type Posting = {
  batchId: string;
  createdAt: number;
  status: 'creating' | 'posting' | 'failed' | 'completed' | 'cancelled';
  progress: number;
  error: string | null;
  draftId: string | null;
  stories: PreparedStory[];
  /** Stories already live, in order, as the tray shows them. */
  published: TrayStory[];
  coverUri: string | null;
  /** "Your story" or Close Friends. Absent on posts saved by an older version: "Your story". */
  audience?: StoryAudience;
  demo?: boolean;
  /** No connection when creating the batch: it retries by itself. */
  offline?: boolean;
  attempts?: number;
};

const STORAGE_KEY = 'stories.posting.v1';
let postings: Posting[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const publishedListeners = new Set<(story: TrayStory) => void>();

function emit() {
  listeners.forEach((listener) => listener());
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(postings.filter((posting) => !posting.demo))).catch(() => undefined);
}

function update(batchId: string, change: Partial<Posting> | ((posting: Posting) => Partial<Posting>)) {
  postings = postings.map((posting) => (posting.batchId === batchId
    ? { ...posting, ...(typeof change === 'function' ? change(posting) : change) }
    : posting));
  emit();
}

export const getPostings = () => postings;

export function usePostings(): Posting[] {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, getPostings, getPostings);
}

/** Called with each story as it goes live, so the tray can show it at once. */
export function onStoryPublished(listener: (story: TrayStory) => void) {
  publishedListeners.add(listener);
  return () => publishedListeners.delete(listener);
}

function errorMessage(error: any): string {
  const data = error?.response?.data;
  if (data?.message && typeof data.message === 'string') return data.message;
  if (!error?.response) return 'No connection. Your story will post when you are back online.';
  return 'Your story could not be posted.';
}

function errorCode(error: any): string | undefined {
  return error?.response?.data?.code;
}

function parseStory(json: string | null): TrayStory | null {
  if (!json) return null;
  try {
    const story = JSON.parse(json);
    return story?.id ? story as TrayStory : null;
  } catch {
    return null;
  }
}

function addPublished(batchId: string, story: TrayStory) {
  const posting = postings.find((entry) => entry.batchId === batchId);
  if (!posting || posting.published.some((entry) => entry.id === story.id)) return;
  update(batchId, { published: [...posting.published, story] });
  publishedListeners.forEach((listener) => listener(story));
  if (!posting.demo) void maybeSaveToGallery(story);
}

/**
 * "Save story to gallery" (STORY_ARCHIVE_SPEC.md, section 5.2): every Story
 * is saved to the device gallery the moment it is shared, when the setting is
 * on. The posting worker is native and does not hand JS the rendered file, so
 * this re-fetches the story's own signed URL rather than reusing local bytes
 * - a small simplification against the spec's "nothing downloaded again".
 */
let saveToGalleryCache: { value: boolean; at: number } | null = null;
async function shouldSaveToGallery(): Promise<boolean> {
  if (saveToGalleryCache && Date.now() - saveToGalleryCache.at < 60_000) return saveToGalleryCache.value;
  try {
    const value = !!(await api.get('/stories/settings')).data?.data?.saveToGallery;
    saveToGalleryCache = { value, at: Date.now() };
    return value;
  } catch {
    return false;
  }
}

async function maybeSaveToGallery(story: TrayStory) {
  try {
    if (!(await shouldSaveToGallery())) return;
    const permission = await requestPermissionsAsync(true, [story.contentType.startsWith('video/') ? 'video' : 'photo']).catch(() => null);
    if (!permission?.granted) return;
    const source = await loadStorySource(story.id);
    if (source.locked || !source.url) return;
    const ext = source.contentType.startsWith('video/') ? 'mp4' : (source.contentType.includes('png') ? 'png' : 'jpg');
    const path = `${FileSystem.cacheDirectory}story-autosave-${story.id}.${ext}`;
    const { uri } = await FileSystem.downloadAsync(source.url, path);
    await saveToLibraryAsync(uri);
  } catch {
    // Best effort, silently: the Story is already posted either way (section 5.2).
  }
}

async function finish(batchId: string) {
  const posting = postings.find((entry) => entry.batchId === batchId);
  if (!posting) return;
  if (posting.draftId) await deleteDraft(posting.draftId).catch(() => undefined);
  await deletePostDirectory(batchId);
  await ChatMedia?.forgetStoryBatch(batchId).catch(() => undefined);
  // The ring turns into the normal story ring after a moment.
  setTimeout(() => {
    postings = postings.filter((entry) => entry.batchId !== batchId);
    emit();
  }, 1500);
}

let subscribed = false;
function listenToWorker() {
  listenToAppState();
  if (subscribed || !ChatMedia || !hasStoryPosting) return;
  subscribed = true;
  ChatMedia.addListener('storyBatchProgress', (event) => {
    if (!postings.some((posting) => posting.batchId === event.batchId)) return;
    if (event.phase === 'published') {
      const story = parseStory(event.story);
      if (story) addPublished(event.batchId, story);
    }
    if (event.phase === 'completed') {
      update(event.batchId, { status: 'completed', progress: 1, error: null });
      void finish(event.batchId);
      return;
    }
    if (event.phase === 'failed') {
      update(event.batchId, { status: 'failed', error: event.error ?? 'Your story could not be posted.' });
      return;
    }
    if (event.phase === 'cancelled') {
      update(event.batchId, { status: 'cancelled' });
      return;
    }
    update(event.batchId, (posting) => ({ progress: Math.max(posting.progress, event.progress), status: 'posting' }));
  });
}

const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** 15 s, 30 s, 1 min, … up to 5 min between attempts while offline. */
function scheduleOfflineRetry(batchId: string, attempts: number) {
  const existing = retryTimers.get(batchId);
  if (existing) clearTimeout(existing);
  const delay = Math.min(5 * 60_000, 15_000 * 2 ** Math.max(0, attempts - 1));
  retryTimers.set(batchId, setTimeout(() => {
    retryTimers.delete(batchId);
    const posting = postings.find((entry) => entry.batchId === batchId);
    if (posting?.offline && posting.status === 'creating') void start(batchId);
  }, delay));
}

/** Coming back to the app is a good moment to try again straight away. */
function retryOfflineNow() {
  for (const posting of postings) {
    if (!posting.demo && posting.offline && posting.status === 'creating') void start(posting.batchId);
  }
}

let appStateSubscribed = false;
function listenToAppState() {
  if (appStateSubscribed) return;
  appStateSubscribed = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') retryOfflineNow();
  });
}

/** Creates the batch on the server (idempotent) and hands it to the worker. */
async function start(batchId: string) {
  const posting = postings.find((entry) => entry.batchId === batchId);
  if (!posting) return;
  if (!ChatMedia || !hasStoryPosting) {
    update(batchId, { status: 'failed', error: 'Update the app to post stories.' });
    return;
  }
  update(batchId, { status: 'creating', error: null });
  const body = {
    batchId,
    audience: posting.audience ?? 'followers',
    items: posting.stories.map((story) => ({
      itemId: story.itemId,
      kind: story.kind,
      durationMs: Math.max(1, Math.round(story.durationMs)),
      ...(story.size ? { size: story.size } : {}),
      ...(story.partCount && story.partCount > 1 ? { partIndex: story.partIndex, partCount: story.partCount } : {}),
      composition: story.composition,
    })),
  };
  let ticket: { publishToken: string; items: Array<{ itemId: string; status: string; storyId: string | null }> };
  try {
    try {
      ticket = (await api.post('/stories/batches', body)).data.data;
    } catch (error) {
      if (errorCode(error) !== 'STORIES_NOT_ENABLED') throw error;
      // Sharing a story turns Stories on, as the earlier composer did.
      await api.put('/stories/settings', { storiesEnabled: true, allowFollowRequests: true });
      ticket = (await api.post('/stories/batches', body)).data.data;
    }
  } catch (error) {
    if (!(error as any)?.response) {
      // No connection: keep it posting and try again by itself, as Instagram
      // waits for the network instead of failing the share.
      const attempts = (postings.find((entry) => entry.batchId === batchId)?.attempts ?? 0) + 1;
      update(batchId, { status: 'creating', error: 'Waiting for connection…', offline: true, attempts });
      scheduleOfflineRetry(batchId, attempts);
      return;
    }
    update(batchId, { status: 'failed', error: errorMessage(error), offline: false });
    return;
  }
  update(batchId, { offline: false, attempts: 0 });
  try {
    await ChatMedia.enqueueStoryBatch({
      batchId,
      apiBaseUrl: String(api.defaults.baseURL ?? ''),
      publishToken: ticket.publishToken,
      title: posting.stories.length > 1 ? 'Posting your stories' : 'Posting your story',
      items: posting.stories.map((story) => story.native),
    });
    update(batchId, { status: 'posting' });
  } catch (error: any) {
    update(batchId, { status: 'failed', error: error?.message ?? 'Your story could not be posted.' });
  }
}

export function sharePrepared(input: {
  batchId: string;
  stories: PreparedStory[];
  draftId: string | null;
  coverUri: string | null;
  audience?: StoryAudience;
}) {
  listenToWorker();
  postings = [...postings, {
    batchId: input.batchId,
    createdAt: Date.now(),
    status: 'creating',
    progress: 0,
    error: null,
    draftId: input.draftId,
    stories: input.stories,
    published: [],
    coverUri: input.coverUri,
    audience: input.audience ?? 'followers',
  }];
  emit();
  void start(input.batchId);
}

/**
 * Demo mode: the same ring and "Posting…" states, with nothing sent anywhere.
 * The stories appear in the demo tray as they "post".
 */
export function shareDemo(input: { items: StoryDraftItem[]; audience?: StoryAudience; toTrayStory: (item: StoryDraftItem, index: number) => TrayStory }) {
  const batchId = `demo-${Date.now()}`;
  postings = [...postings, {
    batchId, createdAt: Date.now(), status: 'posting', progress: 0, error: null, draftId: null,
    stories: [], published: [], coverUri: input.items[0]?.media.uri ?? null, demo: true, audience: input.audience ?? 'followers',
  }];
  emit();
  const total = input.items.length;
  let step = 0;
  const timer = setInterval(() => {
    step += 1;
    const progress = Math.min(1, step / (total * 8));
    const done = Math.floor(progress * total + 1e-6);
    const posting = postings.find((entry) => entry.batchId === batchId);
    if (!posting) {
      clearInterval(timer);
      return;
    }
    while (posting && postings.find((entry) => entry.batchId === batchId)!.published.length < done) {
      const index = postings.find((entry) => entry.batchId === batchId)!.published.length;
      addPublished(batchId, input.toTrayStory(input.items[index], index));
    }
    update(batchId, { progress });
    if (progress >= 1) {
      clearInterval(timer);
      update(batchId, { status: 'completed' });
      setTimeout(() => {
        postings = postings.filter((entry) => entry.batchId !== batchId);
        emit();
      }, 1500);
    }
  }, 150);
}

export async function retryPosting(batchId: string) {
  const posting = postings.find((entry) => entry.batchId === batchId);
  if (!posting || posting.demo) return;
  const native = await ChatMedia?.getStoryBatch(batchId).catch(() => null);
  if (native && native.status !== 'cancelled') {
    update(batchId, { status: 'posting', error: null });
    try {
      await ChatMedia!.retryStoryBatch(batchId);
    } catch (error: any) {
      update(batchId, { status: 'failed', error: error?.message ?? 'Your story could not be posted.' });
    }
    return;
  }
  await start(batchId);
}

/** Stops posting. Stories already live stay live; the draft is kept. */
export async function cancelPosting(batchId: string) {
  const posting = postings.find((entry) => entry.batchId === batchId);
  if (!posting) return;
  const timer = retryTimers.get(batchId);
  if (timer) clearTimeout(timer);
  retryTimers.delete(batchId);
  if (!posting.demo) {
    await ChatMedia?.cancelStoryBatch(batchId).catch(() => undefined);
    await api.delete(`/stories/batches/${batchId}`).catch(() => undefined);
    await deletePostDirectory(batchId);
    await ChatMedia?.forgetStoryBatch(batchId).catch(() => undefined);
  }
  postings = postings.filter((entry) => entry.batchId !== batchId);
  emit();
}

/** Cancels and also deletes the draft. */
export async function discardPosting(batchId: string) {
  const draftId = postings.find((entry) => entry.batchId === batchId)?.draftId;
  await cancelPosting(batchId);
  if (draftId) await deleteDraft(draftId).catch(() => undefined);
}

/** On app start: reload unfinished posts and catch up with what the worker did meanwhile. */
export async function restorePostings() {
  if (loaded) return;
  loaded = true;
  listenToWorker();
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const saved: Posting[] = raw ? JSON.parse(raw) : [];
    postings = [...saved.filter((posting) => !postings.some((entry) => entry.batchId === posting.batchId)), ...postings];
    emit();
  } catch {
    return;
  }
  for (const posting of [...postings]) {
    if (posting.demo || posting.status === 'completed' || posting.status === 'cancelled') continue;
    const native = await ChatMedia?.getStoryBatch(posting.batchId).catch(() => null);
    if (!native) {
      // Never reached the worker (the app closed while creating it): start again.
      if (posting.status === 'creating') void start(posting.batchId);
      continue;
    }
    native.items.forEach((item) => {
      const story = parseStory(item.story);
      if (story) addPublished(posting.batchId, story);
    });
    if (native.status === 'completed') {
      update(posting.batchId, { status: 'completed', progress: 1 });
      void finish(posting.batchId);
    } else if (native.status === 'failed' || native.workState === 'failed' || native.workState === 'cancelled') {
      update(posting.batchId, { status: 'failed', error: native.error ?? 'Your story could not be posted.', progress: native.progress });
    } else {
      update(posting.batchId, { status: 'posting', progress: native.progress });
    }
  }
}

/** Copies a video into the post's folder, so the worker still finds it after the cache is cleared. */
export async function keepFile(uri: string, dir: string, name: string) {
  if (uri.startsWith(dir)) return uri;
  const ext = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(uri)?.[1] ?? 'mp4';
  const target = `${dir}${name}.${ext}`;
  await FileSystem.copyAsync({ from: uri, to: target });
  return target;
}
