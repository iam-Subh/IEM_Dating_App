import type { ViewStyle } from 'react-native';
import type { StoryFilterParams } from '../../../../modules/chat-media';

/**
 * Colour filters, swiped through in the editor.
 *
 * Each is a small set of parameters, not a lookup table, because the same
 * parameters must drive two renderers: a colour matrix in the editor and on
 * photos (Skia), and Media3's effects when a video is exported on the device.
 */
export type StoryFilter = { id: string; name: string; params: StoryFilterParams };

const neutral: StoryFilterParams = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, grayscale: false };

export const STORY_FILTERS: StoryFilter[] = [
  { id: 'normal', name: 'Normal', params: neutral },
  { id: 'paris', name: 'Paris', params: { ...neutral, brightness: 0.04, contrast: -0.08, saturation: -10, warmth: 0.15 } },
  { id: 'oslo', name: 'Oslo', params: { ...neutral, brightness: 0.03, contrast: 0.05, saturation: -15, warmth: -0.35 } },
  { id: 'lagos', name: 'Lagos', params: { ...neutral, contrast: 0.12, saturation: 20, warmth: 0.25 } },
  { id: 'melbourne', name: 'Melbourne', params: { ...neutral, brightness: 0.05, contrast: -0.15, saturation: -20, warmth: 0.1 } },
  { id: 'jakarta', name: 'Jakarta', params: { ...neutral, contrast: 0.18, saturation: 25 } },
  { id: 'abudhabi', name: 'Abu Dhabi', params: { ...neutral, brightness: 0.02, saturation: 10, warmth: 0.45 } },
  { id: 'buenosaires', name: 'Buenos Aires', params: { ...neutral, brightness: -0.02, contrast: 0.22, saturation: -25, warmth: 0.05 } },
  { id: 'newyork', name: 'New York', params: { ...neutral, contrast: 0.28, grayscale: true } },
  { id: 'jaipur', name: 'Jaipur', params: { ...neutral, brightness: 0.03, contrast: 0.08, saturation: 35, warmth: 0.3 } },
  { id: 'cairo', name: 'Cairo', params: { ...neutral, brightness: 0.06, contrast: -0.2, saturation: -35, warmth: 0.2 } },
  { id: 'tokyo', name: 'Tokyo', params: { ...neutral, brightness: 0.04, contrast: 0.06, saturation: -5, warmth: -0.25 } },
  { id: 'rio', name: 'Rio de Janeiro', params: { ...neutral, brightness: 0.05, contrast: 0.1, saturation: 30, warmth: 0.12 } },
];

export const filterById = (id: string) => STORY_FILTERS.find((filter) => filter.id === id) ?? STORY_FILTERS[0];

type Matrix5 = number[];

const identity = (): Matrix5 => [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1];

/** 5 × 5 product `second · first`: apply `first`, then `second`. */
function then(first: Matrix5, second: Matrix5): Matrix5 {
  const out = new Array(25).fill(0);
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      let sum = 0;
      for (let k = 0; k < 5; k += 1) sum += second[row * 5 + k] * first[k * 5 + col];
      out[row * 5 + col] = sum;
    }
  }
  return out;
}

const LUMA = [0.2126, 0.7152, 0.0722];

function saturationMatrix(amount: number): Matrix5 {
  const s = amount;
  const [r, g, b] = LUMA;
  return [
    r * (1 - s) + s, g * (1 - s), b * (1 - s), 0, 0,
    r * (1 - s), g * (1 - s) + s, b * (1 - s), 0, 0,
    r * (1 - s), g * (1 - s), b * (1 - s) + s, 0, 0,
    0, 0, 0, 1, 0,
    0, 0, 0, 0, 1,
  ];
}

/**
 * The 4 × 5 colour matrix (20 numbers, translations in 0–1) for Skia's
 * ColorMatrix, applying the parameters in the same order as the native export:
 * grayscale, saturation, warmth, contrast, brightness.
 */
export function colorMatrix(params: StoryFilterParams): number[] {
  let matrix = identity();
  if (params.grayscale) matrix = then(matrix, saturationMatrix(0));
  if (params.saturation) matrix = then(matrix, saturationMatrix(Math.max(0, 1 + params.saturation / 100)));
  if (params.warmth) {
    const warm = identity();
    warm[0] = 1 + 0.12 * params.warmth;
    warm[12] = 1 - 0.12 * params.warmth;
    matrix = then(matrix, warm);
  }
  if (params.contrast) {
    // Media3's Contrast: factor (1 + c) / (1 - c), pivoting on mid grey.
    const factor = (1 + params.contrast) / (1.0001 - params.contrast);
    const offset = (1 - factor) / 2;
    const contrast = identity();
    contrast[0] = factor; contrast[6] = factor; contrast[12] = factor;
    contrast[4] = offset; contrast[9] = offset; contrast[14] = offset;
    matrix = then(matrix, contrast);
  }
  if (params.brightness) {
    const bright = identity();
    bright[4] = params.brightness; bright[9] = params.brightness; bright[14] = params.brightness;
    matrix = then(matrix, bright);
  }
  return matrix.slice(0, 20);
}

type ViewFilter = Exclude<NonNullable<ViewStyle['filter']>, string>[number];

/**
 * The same filter as native view filters, for previewing on the editor's photo
 * and video views (Android 12+). The export still uses the exact parameters.
 */
export function viewFilters(params: StoryFilterParams): ViewFilter[] {
  const filters: ViewFilter[] = [];
  if (params.grayscale) filters.push({ grayscale: 1 });
  if (params.saturation) filters.push({ saturate: Math.max(0, 1 + params.saturation / 100) });
  if (params.warmth > 0) filters.push({ sepia: Math.min(1, params.warmth * 0.35) });
  if (params.warmth < 0) filters.push({ hueRotate: `${Math.round(params.warmth * 14)}deg` });
  if (params.contrast) filters.push({ contrast: (1 + params.contrast) / (1.0001 - params.contrast) });
  if (params.brightness) filters.push({ brightness: 1 + params.brightness });
  return filters;
}

export const isNeutral = (params: StoryFilterParams) =>
  !params.grayscale && !params.brightness && !params.contrast && !params.saturation && !params.warmth;
