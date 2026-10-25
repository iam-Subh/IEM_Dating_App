import { Platform } from 'react-native';
import * as Brightness from 'expo-brightness';

/**
 * Full screen brightness while the selfie steps run: the bright screen lights
 * the face, which helps in a dim room. Only this app's window changes - no
 * permission, the phone's own setting is untouched - and it goes back when the
 * steps end, fail, or the check closes.
 */
let saved: number | null = null;
let raised = false;
// One change at a time, in order: a quick close must not land before the raise.
let queue: Promise<void> = Promise.resolve();
const next = (step: () => Promise<void>) => {
  queue = queue.then(step).catch(() => undefined);
  return queue;
};

export function raiseCaptureBrightness() {
  if (raised) return queue;
  raised = true;
  return next(async () => {
    if (Platform.OS !== 'android') saved = await Brightness.getBrightnessAsync();
    await Brightness.setBrightnessAsync(1);
  });
}

export function restoreCaptureBrightness() {
  if (!raised) return queue;
  raised = false;
  return next(async () => {
    // Android: the window follows the system setting again, auto-brightness included.
    if (Platform.OS === 'android') await Brightness.restoreSystemBrightnessAsync();
    else if (saved !== null) await Brightness.setBrightnessAsync(saved);
    saved = null;
  });
}
