import type { BoomerangStyle, PhotoEffect } from '../../../../../modules/chat-media';

export const BOOMERANG_STYLES: Array<{ id: BoomerangStyle; name: string }> = [
  { id: 'classic', name: 'Classic' },
  { id: 'slomo', name: 'SloMo' },
  { id: 'echo', name: 'Echo' },
  { id: 'duo', name: 'Duo' },
];

/** How long the camera records for a Boomerang. */
export const BOOMERANG_CLIP_MS = 1200;

export const PHOTO_EFFECTS: Array<{ id: PhotoEffect | 'none'; name: string; emoji?: string }> = [
  { id: 'none', name: 'Original' },
  { id: 'blur', name: 'Blur background' },
  { id: 'mono', name: 'B&W background' },
  { id: 'studio', name: 'Studio' },
  { id: 'glasses', name: 'Sunglasses', emoji: '🕶️' },
  { id: 'crown', name: 'Crown', emoji: '👑' },
  { id: 'hearts', name: 'Hearts', emoji: '💖' },
];
