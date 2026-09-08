import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const REFRESH_TOKEN_KEY = 'iem_refresh_token';
const LOGGED_OUT_KEY = 'iem_logged_out';
let loggedOut = false;
async function retryStorage(work: () => Promise<void>) {
  for (let attempt = 0; ; attempt++) {
    try { await work(); return; } catch (error) { if (attempt === 2) throw error; }
  }
}
let webSessionToken: string | null = null;
let mutation: Promise<unknown> = Promise.resolve();
const serialize = <T>(work: () => Promise<T>): Promise<T> => {
  const next = mutation.then(work, work);
  mutation = next.catch(() => undefined);
  return next;
};
const read = () => Platform.OS === 'web' ? Promise.resolve(webSessionToken) : SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
const write = (token: string) => {
  if (Platform.OS === 'web') { webSessionToken = token; return Promise.resolve(); }
  return SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
};

export const credentialStore = {
  getRefreshToken: () => serialize(async () => {
    if (loggedOut || await AsyncStorage.getItem(LOGGED_OUT_KEY) === '1') return null;
    return read();
  }),
  setRefreshToken: (token: string) => serialize(async () => {
    await write(token);
    await retryStorage(() => AsyncStorage.removeItem(LOGGED_OUT_KEY));
    loggedOut = false;
  }),
  rotateRefreshToken: (expected: string, token: string, isCurrent: () => boolean) => serialize(async () => {
    if (loggedOut || !isCurrent() || await read() !== expected || !isCurrent()) throw new Error('Session changed');
    await write(token);
  }),
  clear: () => {
    loggedOut = true;
    return serialize(async () => {
      loggedOut = true;
      const results = await Promise.allSettled([
        retryStorage(() => AsyncStorage.setItem(LOGGED_OUT_KEY, '1')),
        retryStorage(async () => {
          if (Platform.OS === 'web') webSessionToken = null;
          else await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
        }),
      ]);
      if (results.some(result => result.status === 'rejected')) throw new Error('Credential cleanup incomplete');
    });
  },
};
