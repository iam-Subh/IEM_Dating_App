import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import type { StoryDraftItem } from '../composition/types';

/**
 * Story drafts, kept on the phone as Instagram keeps them: at most 20, each
 * deleted 7 days after it was first saved, every layer still editable.
 *
 * A draft owns copies of its media, so it survives the camera roll changing
 * and the cache being cleared.
 */

export const MAX_DRAFTS = 20;
export const DRAFT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const INDEX_KEY = 'stories.drafts.v1';
const ROOT = `${FileSystem.documentDirectory}story-drafts/`;

export type DraftSummary = {
  id: string;
  createdAt: number;
  updatedAt: number;
  count: number;
  coverUri: string | null;
  coverKind: 'photo' | 'video';
};

export class DraftLimitError extends Error {
  constructor() {
    super(`You can keep up to ${MAX_DRAFTS} drafts. Delete one to save another.`);
  }
}

async function readIndex(): Promise<DraftSummary[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const writeIndex = (index: DraftSummary[]) => AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index));

const draftDir = (id: string) => `${ROOT}${id}/`;

function extensionOf(uri: string, fallback: string) {
  const match = /\.([a-z0-9]{2,5})(?:\?|#|$)/i.exec(uri);
  return match ? match[1].toLowerCase() : fallback;
}

/** Copies a file into the draft folder unless it already lives there. */
async function own(uri: string, dir: string, name: string, fallbackExt: string) {
  if (uri.startsWith(dir)) return uri;
  if (!uri.startsWith('file://') && !uri.startsWith('content://')) return uri;
  const target = `${dir}${name}.${extensionOf(uri, fallbackExt)}`;
  await FileSystem.deleteAsync(target, { idempotent: true });
  await FileSystem.copyAsync({ from: uri, to: target });
  return target;
}

/** Days left before a draft is deleted, for the countdown on its thumbnail. */
export const daysLeft = (draft: Pick<DraftSummary, 'createdAt'>, now = Date.now()) =>
  Math.max(0, Math.ceil((draft.createdAt + DRAFT_LIFETIME_MS - now) / (24 * 60 * 60 * 1000)));

/** Removes expired drafts and their files; returns the rest, newest first. */
export async function listDrafts(now = Date.now()): Promise<DraftSummary[]> {
  const index = await readIndex();
  const live = index.filter((draft) => now - draft.createdAt < DRAFT_LIFETIME_MS);
  const expired = index.filter((draft) => !live.includes(draft));
  if (expired.length) {
    await Promise.all(expired.map((draft) => FileSystem.deleteAsync(draftDir(draft.id), { idempotent: true }).catch(() => undefined)));
    await writeIndex(live);
  }
  return [...live].sort((first, second) => second.updatedAt - first.updatedAt);
}

export async function saveDraft(items: StoryDraftItem[], existingId?: string | null): Promise<string> {
  if (!items.length) throw new Error('There is nothing to save');
  const index = await listDrafts();
  const existing = existingId ? index.find((draft) => draft.id === existingId) : undefined;
  if (!existing && index.length >= MAX_DRAFTS) throw new DraftLimitError();
  const id = existing?.id ?? `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const dir = draftDir(id);
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);

  const owned: StoryDraftItem[] = [];
  for (const item of items) {
    const media = { ...item.media, uri: await own(item.media.uri, dir, `${item.id}-media`, item.media.kind === 'video' ? 'mp4' : 'jpg') };
    const layers = await Promise.all(item.layers.map(async (layer) => (
      layer.kind === 'photo' || layer.kind === 'frame' ? { ...layer, uri: await own(layer.uri, dir, `${layer.id}-sticker`, 'jpg') } : layer
    )));
    owned.push({ ...item, media, layers });
  }
  await FileSystem.writeAsStringAsync(`${dir}draft.json`, JSON.stringify(owned));

  const now = Date.now();
  const summary: DraftSummary = {
    id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    count: owned.length,
    coverUri: owned[0].media.uri,
    coverKind: owned[0].media.kind,
  };
  await writeIndex([summary, ...index.filter((draft) => draft.id !== id)]);
  return id;
}

export async function loadDraft(id: string): Promise<StoryDraftItem[] | null> {
  try {
    const raw = await FileSystem.readAsStringAsync(`${draftDir(id)}draft.json`);
    const items = JSON.parse(raw);
    return Array.isArray(items) ? items as StoryDraftItem[] : null;
  } catch {
    return null;
  }
}

export async function deleteDraft(id: string): Promise<void> {
  const index = await readIndex();
  await writeIndex(index.filter((draft) => draft.id !== id));
  await FileSystem.deleteAsync(draftDir(id), { idempotent: true }).catch(() => undefined);
}
