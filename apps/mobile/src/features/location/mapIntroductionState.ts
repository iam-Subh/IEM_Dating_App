import AsyncStorage from '@react-native-async-storage/async-storage';

type Storage = {getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<unknown>};

/** Remember only whether this account completed the map introduction. */
export function createMapIntroductionTracker(storage: Storage) {
  const seen = new Map<string, boolean>();
  const pending = new Map<string, Promise<boolean>>();
  const key = (account: string) => 'iem.map-introduction.v1:' + encodeURIComponent(account);
  return {
    hasSeen: (account: string) => seen.get(account),
    needsIntroduction(account: string): Promise<boolean> {
      if (seen.has(account)) return Promise.resolve(!seen.get(account));
      const existing = pending.get(account);
      if (existing) return existing;
      const read = storage.getItem(key(account)).then(value => {
        // A completion can occur while a storage read is still pending.
        const completed = seen.get(account) === true || value === 'seen';
        seen.set(account, completed);
        return !completed;
      }).catch(() => seen.get(account) !== true).finally(() => pending.delete(account));
      pending.set(account, read);
      return read;
    },
    complete(account: string) {
      seen.set(account, true);
      // The map opens immediately. A storage write never blocks the animation.
      return storage.setItem(key(account), 'seen').then(() => undefined).catch(() => undefined);
    },
  };
}

export const mapIntroductionTracker = createMapIntroductionTracker(AsyncStorage);
