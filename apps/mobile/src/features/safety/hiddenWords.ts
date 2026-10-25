import { useEffect, useState } from 'react';
import { api } from '../../services/api';

/**
 * Hidden Words (docs/SAFETY_AND_LEGAL.md 3): this person's list, read once
 * and shared by every screen. Messages and notes containing one are folded
 * away until tapped.
 */
let words: string[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<(next: string[]) => void>();
const publish = (next: string[]) => { words = next; listeners.forEach((listener) => listener(next)); };

export function loadHiddenWords(force = false) {
  if (loaded && !force) return Promise.resolve();
  loading ??= api.get('/safety/hidden-words')
    .then((response) => { loaded = true; publish(response.data.data ?? []); })
    .catch(() => undefined)
    .finally(() => { loading = null; });
  return loading;
}

export async function saveHiddenWords(next: string[]) {
  const response = await api.put('/safety/hidden-words', { words: next });
  loaded = true;
  publish(response.data.data ?? next);
}

/** Signing out: the next account starts empty. */
export function resetHiddenWords() { loaded = false; publish([]); }

export function useHiddenWords() {
  const [current, setCurrent] = useState(words);
  useEffect(() => {
    listeners.add(setCurrent);
    setCurrent(words);
    void loadHiddenWords();
    return () => { listeners.delete(setCurrent); };
  }, []);
  return current;
}
