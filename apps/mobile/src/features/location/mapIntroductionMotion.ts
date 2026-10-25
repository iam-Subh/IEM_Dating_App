export const MAP_INTRODUCTION_MS = 3500;

/** Uncrumple the paper, hold the square map, then enlarge it. */
export function paperIntroductionMotion(progress: number) {
  'worklet';
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const open = Math.max(0, Math.min(1, (p - .08) / .60));
  const grow = Math.max(0, Math.min(1, (p - .75) / .21));
  const textFade = Math.max(0, Math.min(1, (p - .65) / .16));
  const fade = Math.max(0, Math.min(1, (p - .9) / .1));
  const fold = 1 - open;
  const expand = grow * grow * (3 - 2 * grow);
  return {
    fold, expand,
    rotation: 12 * (1 - expand),
    scale: 1,
    headingOpacity: 1 - textFade * textFade * (3 - 2 * textFade),
    opacity: 1 - fade * fade * (3 - 2 * fade),
  };
}
