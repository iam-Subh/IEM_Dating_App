/** Two selections form a complete loop, returning both cards to their start. */
export const STANDOUTS_SELECTION_MS = 1100;
export const STANDOUTS_ICON_FRAME = {width: 192, height: 128};
export const STANDOUTS_CARD_SIZE = {width: 64, height: 66};
const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

export function standoutsCardPose(index: number, progress: number) {
  const turn = Math.floor(progress);
  const phase = progress - turn;
  const incoming = index === (turn + 1) % 2;
  const separate = smooth((phase - 0.12) / 0.24);
  const settle = smooth((phase - 0.44) / 0.32);
  return incoming ? {
    x: 54 - 48 * separate + 68 * settle,
    y: 20 + 14 * settle,
    rotation: -8 * separate * (1 - settle),
    heart: smooth((phase - 0.76) / 0.14),
    front: phase >= 0.42,
  } : {
    x: 74 + 24 * separate - 44 * settle,
    y: 34 - 14 * settle,
    rotation: 4 * separate * (1 - settle),
    heart: 1 - smooth((phase - 0.28) / 0.14),
    front: phase < 0.42,
  };
}

// Sample eased paths once. The native driver interpolates the card positions.
export const STANDOUTS_MOTION_STEPS = Array.from({length: 121}, (_, index) => index / 60);
export const STANDOUTS_CARD_PATHS = [0, 1].map(index => {
  const poses = STANDOUTS_MOTION_STEPS.map(progress => standoutsCardPose(index, progress));
  return {
    x: poses.map(pose => pose.x), y: poses.map(pose => pose.y),
    rotation: poses.map(pose => `${pose.rotation}deg`), heart: poses.map(pose => pose.heart),
  };
});

// Exchange layers only while the two cards are fully separated.
export const STANDOUTS_LAYER_STEPS = [0, 0.419, 0.421, 1.419, 1.421, 2];
export const STANDOUTS_FRONT_LAYERS = [[1, 1, 0, 0, 1, 1], [0, 0, 1, 1, 0, 0]];
