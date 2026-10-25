/**
 * Calls back when the phone is shaken. Needs expo-sensors in the installed
 * build; on a build without it, nothing happens and tapping still works.
 */
let accelerometer: any = null;
try {
  accelerometer = require('expo-sensors').Accelerometer ?? null;
} catch {
  accelerometer = null;
}

/** Acceleration, in g, that counts as a shake; resting is 1. */
const THRESHOLD = 2.3;

export function onShake(callback: () => void): () => void {
  if (!accelerometer) return () => undefined;
  let last = 0;
  try {
    accelerometer.setUpdateInterval(100);
    const subscription = accelerometer.addListener(({ x, y, z }: { x: number; y: number; z: number }) => {
      const force = Math.sqrt(x * x + y * y + z * z);
      if (force > THRESHOLD && Date.now() - last > 800) {
        last = Date.now();
        callback();
      }
    });
    return () => subscription.remove();
  } catch {
    return () => undefined;
  }
}
