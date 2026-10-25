import { Inter_500Medium } from '@expo-google-fonts/inter';
import { Montserrat_600SemiBold } from '@expo-google-fonts/montserrat';
import { Pacifico_400Regular } from '@expo-google-fonts/pacifico';
import { CourierPrime_400Regular } from '@expo-google-fonts/courier-prime';
import { Anton_400Regular } from '@expo-google-fonts/anton';
import { DancingScript_700Bold } from '@expo-google-fonts/dancing-script';
import { PlayfairDisplay_700Bold } from '@expo-google-fonts/playfair-display';
import { Fredoka_600SemiBold } from '@expo-google-fonts/fredoka';
import { BebasNeue_400Regular } from '@expo-google-fonts/bebas-neue';
import { ArchivoBlack_400Regular } from '@expo-google-fonts/archivo-black';
import { Righteous_400Regular } from '@expo-google-fonts/righteous';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import type { FontId } from './composition/types';

/**
 * Instagram's story fonts, matched to open fonts with the same character:
 * Classic (a plain bold sans), Modern (geometric), Neon (a glowing script),
 * Typewriter, Strong (a heavy condensed display face), and the newer
 * Signature, Editor, Bubble, Squeeze, Poster, Deco and Elegant.
 */
export type StoryFont = {
  id: FontId;
  name: string;
  family: string;
  /** Glow drawn around the letters, for Neon. */
  glow?: boolean;
  uppercase?: boolean;
  /** Relative size, so a line reads at a similar size in every face. */
  scale: number;
};

export const STORY_FONTS: StoryFont[] = [
  // Instagram's Classic is a plain medium-weight sans, not bold.
  { id: 'classic', name: 'Classic', family: 'Inter_500Medium', scale: 1 },
  { id: 'modern', name: 'Modern', family: 'Montserrat_600SemiBold', scale: 0.95 },
  { id: 'neon', name: 'Neon', family: 'Pacifico_400Regular', glow: true, scale: 1 },
  { id: 'typewriter', name: 'Typewriter', family: 'CourierPrime_400Regular', scale: 1.05 },
  { id: 'strong', name: 'Strong', family: 'Anton_400Regular', uppercase: true, scale: 1.1 },
  { id: 'signature', name: 'Signature', family: 'DancingScript_700Bold', scale: 1.2 },
  { id: 'editor', name: 'Editor', family: 'PlayfairDisplay_700Bold', scale: 1 },
  { id: 'bubble', name: 'Bubble', family: 'Fredoka_600SemiBold', scale: 1.05 },
  { id: 'squeeze', name: 'Squeeze', family: 'BebasNeue_400Regular', uppercase: true, scale: 1.25 },
  { id: 'poster', name: 'Poster', family: 'ArchivoBlack_400Regular', uppercase: true, scale: 0.95 },
  { id: 'deco', name: 'Deco', family: 'Righteous_400Regular', scale: 1 },
  { id: 'elegant', name: 'Elegant', family: 'CormorantGaramond_600SemiBold', scale: 1.15 },
];

export const fontById = (id: FontId) => STORY_FONTS.find((font) => font.id === id) ?? STORY_FONTS[0];

/** For expo-font's useFonts. */
export const STORY_FONT_SOURCES = {
  Inter_500Medium,
  Montserrat_600SemiBold,
  Pacifico_400Regular,
  CourierPrime_400Regular,
  Anton_400Regular,
  DancingScript_700Bold,
  PlayfairDisplay_700Bold,
  Fredoka_600SemiBold,
  BebasNeue_400Regular,
  ArchivoBlack_400Regular,
  Righteous_400Regular,
  CormorantGaramond_600SemiBold,
};

/** Instagram's palette row. */
export const STORY_COLORS = [
  '#FFFFFF', '#000000', '#3897F0', '#70C050', '#FDCB5C', '#FD8D32', '#ED4956', '#D10869',
  '#A307BA', '#ED0013', '#ED858E', '#FFD2D3', '#FFDBB4', '#FFC382', '#D28F47', '#996439',
  '#432324', '#1C4A28', '#262626', '#363636', '#555555', '#737373', '#999999', '#B2B2B2',
];

/** Backgrounds cycled by the colour button when the media does not fill the canvas. */
export const STORY_BACKGROUNDS: string[][] = [
  ['#262626', '#101010'],
  ['#833AB4', '#FD1D1D', '#FCB045'],
  ['#4F5BD5', '#962FBF', '#D62976'],
  ['#0F2027', '#203A43', '#2C5364'],
  ['#FDCB5C', '#ED4956'],
  ['#70C050', '#1C4A28'],
  ['#FFFFFF', '#FFFFFF'],
  ['#000000', '#000000'],
];
