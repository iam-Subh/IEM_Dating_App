/**
 * Where a person's ring is on screen right now, so a closing Story can shrink
 * back into it (StoryViewerScreen). The Stories tray registers the finder
 * while it is mounted; with no tray, or the ring scrolled out of sight, there
 * is no target and the viewer simply closes.
 */
export type ScreenRect = { x: number; y: number; width: number; height: number };
type Finder = (ownerId: string) => Promise<ScreenRect | null>;

let finder: Finder | null = null;

export function registerStoryRingFinder(next: Finder) {
  finder = next;
  return () => { if (finder === next) finder = null; };
}

export async function findStoryRing(ownerId: string): Promise<ScreenRect | null> {
  if (!finder) return null;
  try { return await finder(ownerId); } catch { return null; }
}

/** When a Story last closed: coming back from one is not a reason to re-sort the row. */
let lastClosedAt = 0;
export const markStoryClosed = () => { lastClosedAt = Date.now(); };
export const closedRecently = (withinMs = 4000) => Date.now() - lastClosedAt < withinMs;
