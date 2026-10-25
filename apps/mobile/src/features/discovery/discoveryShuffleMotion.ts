export const CARD_TRANSFER_MS = 2000;

/** One front card leaves the stack, changes depth while clear, then returns underneath. */
export function discoveryShuffleMotion(index: number, progress: number) {
  'worklet';
  const turn = Math.floor(progress);
  const phase = progress - turn;
  const depth = ((index - turn) % 3 + 3) % 3;
  const out = Math.max(0, Math.min(1, (phase - .12) / .34));
  const back = Math.max(0, Math.min(1, (phase - .54) / .36));
  const easedOut = out * out * (3 - 2 * out);
  const easedBack = back * back * (3 - 2 * back);
  const spacing = easedOut * (1 - easedBack);
  const rotations = [0, -3, 3];
  if (depth === 0) {
    return {
      x: 98 * spacing,
      y: -10 * easedOut - 6 * easedBack,
      rotation: 5 * easedOut - 2 * easedBack,
      scale: 1 - .12 * easedBack,
      zIndex: phase < .5 ? 3 : 0,
    };
  }
  return {
    x: -84 * spacing,
    y: -8 * depth + 8 * easedBack,
    rotation: rotations[depth] + (rotations[depth - 1] - rotations[depth]) * easedBack,
    scale: 1 - .06 * depth + .06 * easedBack,
    zIndex: 3 - depth,
  };
}
