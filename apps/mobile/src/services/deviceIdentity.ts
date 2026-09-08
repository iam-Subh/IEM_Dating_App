import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'iem-device-id-v1';
let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  const stored = await AsyncStorage.getItem(KEY);
  if (stored && /^[A-Za-z0-9_-]{16,100}$/.test(stored)) {
    cached = stored;
    return stored;
  }
  const bytes = Array.from({ length: 24 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
  cached = `device_${bytes}`;
  await AsyncStorage.setItem(KEY, cached);
  return cached;
}
