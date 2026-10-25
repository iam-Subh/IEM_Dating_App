/**
 * The screenshot a report starts with. react-native-view-shot is native: on a
 * build without it there is simply no screenshot, never a crash.
 */
function viewShot(): any | null {
  try { return require('react-native-view-shot'); } catch { return null; }
}

export async function captureCurrentScreen(): Promise<string | null> {
  const module = viewShot();
  if (!module?.captureScreen) return null;
  try { return await module.captureScreen({ format: 'jpg', quality: 0.8, result: 'tmpfile' }); } catch { return null; }
}

/** A view as an image (the screenshot after "Hide private details"). */
export async function captureView(ref: unknown): Promise<string | null> {
  const module = viewShot();
  if (!module?.captureRef) return null;
  try { return await module.captureRef(ref, { format: 'jpg', quality: 0.85, result: 'tmpfile' }); } catch { return null; }
}

export const canCapture = () => !!viewShot()?.captureRef;
