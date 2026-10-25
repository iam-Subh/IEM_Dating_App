import { useSyncExternalStore } from 'react';
import type { Image } from 'react-native-nitro-image';

/**
 * The latest small copy of the camera picture, for Layout's blurred cells.
 * Kept outside React state so a new frame redraws only those cells, not the
 * whole camera screen.
 */
let current: Image | null = null;
const listeners = new Set<() => void>();

export function publishLiveBlur(image: Image | null) {
  current = image;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useLiveBlur(): Image | null {
  return useSyncExternalStore(subscribe, () => current);
}
