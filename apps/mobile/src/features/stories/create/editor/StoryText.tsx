import React, { useEffect, useMemo } from 'react';
import { Text, View, type TextStyle } from 'react-native';
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming, type SharedValue,
} from 'react-native-reanimated';
import type { TextAnimation, TextLayer } from '../composition/types';
import { fontById } from '../fonts';

type StoryTextProps = Pick<TextLayer, 'text' | 'font' | 'color' | 'background' | 'align' | 'size' | 'wrap'>;

/** Lines break at the width the text was typed at; older text kept the old width. */
const wrapOf = (layer: StoryTextProps) => layer.wrap ?? 960;

/** The colour's red, green and blue: #RGB, #RRGGBB, #RRGGBBAA or rgb()/rgba(). */
function channels(colour: string): [number, number, number] | null {
  const value = colour.trim();
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  let hex = value.replace('#', '');
  if (hex.length === 3 || hex.length === 4) hex = hex.slice(0, 3).split('').map((digit) => digit + digit).join('');
  if (hex.length < 6 || !/^[0-9a-f]{6}/i.test(hex)) return null;
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
}

/**
 * The letter colour that reads best on a filled highlight, as Instagram picks
 * it: black on light fills (white, yellow, light pink), white on everything
 * else. One rule for the editor and the posted story, so they always agree.
 */
export function contrastFor(colour: string) {
  const rgb = channels(colour);
  if (!rgb) return '#000000';
  const [r, g, b] = rgb;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.7 ? '#000000' : '#FFFFFF';
}

/** The colour at this opacity, as rgba(). */
export function withAlpha(colour: string, alpha: number) {
  const rgb = channels(colour);
  return rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})` : `rgba(0,0,0,${alpha})`;
}

/**
 * The highlight behind the lines and the letter colour on it. Both fills take
 * the chosen colour - solid, or see-through - and the letters take black or
 * white, whichever reads on it. One rule for the editor and the posted story.
 */
export function textFill(background: TextLayer['background'], colour: string) {
  if (background === 'solid') return { highlight: colour, letters: contrastFor(colour) };
  if (background === 'translucent') return { highlight: withAlpha(colour, 0.55), letters: contrastFor(colour) };
  return { highlight: 'transparent', letters: colour };
}

/**
 * The padding a highlight keeps around each line: a no-break space, so it stays
 * glued to the text. An ordinary space could be put on a line of its own when
 * the text filled the width, which drew a thin white bar above and below it.
 */
const PAD = '\u00A0';

/** The characters as drawn, with the highlight's padding. */
function displayText(layer: StoryTextProps) {
  const text = fontById(layer.font).uppercase ? layer.text.toUpperCase() : layer.text;
  return layer.background !== 'none' ? `${PAD}${text.split('\n').join(`${PAD}\n${PAD}`)}${PAD}` : text;
}

/**
 * The line width: the width it was typed at, plus room for the two padding
 * spaces a highlight adds, so the padding never pushes a word onto a new line.
 */
function lineWidth(layer: StoryTextProps, unit: number) {
  const base = wrapOf(layer) * unit;
  if (layer.background === 'none') return base;
  return base + layer.size * fontById(layer.font).scale * unit * 0.6;
}

/**
 * Letters that are laid out but not seen. Not 'transparent': on Android a
 * nested text span reads colour 0 (fully transparent) as "no colour set" and
 * falls back to black, which drew a second, black copy of the text. Alpha 1 of
 * 255 is a real colour and invisible.
 */
export const INVISIBLE_INK = 'rgba(0,0,0,0.004)';

const HIDDEN: TextStyle = { color: INVISIBLE_INK, backgroundColor: 'transparent', textShadowColor: 'transparent' };

/**
 * Text as Instagram draws it: the font's own look, a highlight behind each
 * line when the background is on, and a glow for Neon.
 *
 * `revealed` shows only the first characters (the typewriter animation). The
 * rest is laid out but transparent, so the text keeps its size and place.
 */
export function StoryText({ layer, unit, revealed }: { layer: StoryTextProps; unit: number; revealed?: number }) {
  const font = fontById(layer.font);
  const fontSize = layer.size * font.scale * unit;
  const highlighted = layer.background !== 'none';
  const { highlight, letters: colour } = textFill(layer.background, layer.color);
  const chars = Array.from(displayText(layer));
  const cut = revealed === undefined ? chars.length : Math.min(chars.length, revealed);
  const shown = chars.slice(0, cut).join('');
  const hidden = chars.slice(cut).join('');
  return (
    <Text
      style={{
        fontFamily: font.family,
        fontSize,
        // The font's own line spacing, the same as while typing, so the text
        // keeps its size when it is placed.
        includeFontPadding: false,
        color: highlighted ? colour : font.glow ? '#FFFFFF' : layer.color,
        textAlign: layer.align,
        maxWidth: lineWidth(layer, unit),
        // Only Neon glows; a shadow on plain text thickened the letters.
        ...(font.glow && !highlighted ? { textShadowColor: layer.color, textShadowRadius: fontSize * 0.45, textShadowOffset: { width: 0, height: 0 } } : {}),
      }}
    >
      {highlighted
        // A nested span gets a background per line, like Instagram's highlight.
        ? <Text style={{ backgroundColor: highlight }}>{shown}</Text>
        : shown}
      {hidden ? <Text style={HIDDEN}>{hidden}</Text> : null}
    </Text>
  );
}

export const TEXT_ANIMATIONS: TextAnimation[] = ['typewriter', 'pop', 'bounce', 'pulse'];
export const TEXT_ANIMATION_NAMES: Record<TextAnimation, string> = { typewriter: 'Typewriter', pop: 'Pop', bounce: 'Bounce', pulse: 'Pulse' };

/*
 * Instagram's text effects move letters, not the block:
 * - Typewriter: typed out one letter at a time, held, then typed again.
 * - Pop: each letter springs in, one after another, held, then again.
 * - Bounce: a wave runs through the letters, each hopping in turn.
 * - Pulse: the whole text beats like a heart - two quick beats, then a rest.
 *
 * One clock drives every letter on the UI thread, so nothing re-renders while
 * it plays and every letter stays in step.
 */
type Timing = { cycle: number; step: number };

const POP_MS = 420;
const BOUNCE_MS = 1100;
const PULSE_MS = 1500;

function timingFor(animation: TextAnimation, letters: number): Timing {
  const count = Math.max(1, letters);
  switch (animation) {
    case 'typewriter': {
      // Slow enough to see each letter arrive, even in a short word.
      const step = Math.max(55, Math.min(160, 1800 / count));
      return { step, cycle: step * count + 1600 };
    }
    case 'pop': {
      const step = Math.max(35, Math.min(90, 900 / count));
      return { step, cycle: step * count + POP_MS + 1700 };
    }
    case 'bounce':
      return { step: 0, cycle: BOUNCE_MS };
    case 'pulse':
    default:
      return { step: 0, cycle: PULSE_MS };
  }
}

function useClock(cycle: number) {
  const clock = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(clock);
    clock.value = 0;
    clock.value = withRepeat(withTiming(cycle, { duration: cycle, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(clock);
  }, [clock, cycle]);
  return clock;
}

function AnimatedLetter({ char, index, animation, timing, clock, amplitude, style }: {
  char: string; index: number; animation: TextAnimation; timing: Timing; clock: SharedValue<number>; amplitude: number; style: TextStyle;
}) {
  const step = timing.step;
  const motion = useAnimatedStyle(() => {
    const t = clock.value;
    if (animation === 'typewriter') {
      return { opacity: t >= (index + 1) * step ? 1 : 0 };
    }
    if (animation === 'pop') {
      const p = Math.max(0, Math.min(1, (t - index * step) / POP_MS));
      // Ease out with a little overshoot, so each letter springs into place.
      const c1 = 2.2;
      const c3 = c1 + 1;
      const eased = p <= 0 ? 0 : 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
      return { opacity: Math.min(1, p * 3), transform: [{ scale: Math.max(0, eased) }] };
    }
    if (animation === 'bounce') {
      // A wave through the letters: each hops in turn, then rests on the line.
      const phase = (t / BOUNCE_MS) * Math.PI * 2 - index * 0.55;
      return { transform: [{ translateY: -amplitude * Math.max(0, Math.sin(phase)) }] };
    }
    return {};
  }, [animation, index, step, amplitude]);
  // A no-break space: a lone ordinary space can measure or paint as nothing on
  // Android, which left a black gap in a filled line.
  return <Animated.Text style={[style, motion]}>{char === ' ' ? '\u00A0' : char}</Animated.Text>;
}

const JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' } as const;

/**
 * Animated story text, drawn live in the editor, the text tool's preview and
 * the viewer (never baked into the media). Laid out word by word so lines wrap
 * where words end, with every letter its own animated piece.
 */
export function AnimatedStoryText({ layer, unit }: { layer: StoryTextProps & { animation?: TextAnimation }; unit: number }) {
  const animation = layer.animation;
  const font = fontById(layer.font);
  const fontSize = layer.size * font.scale * unit;
  const highlighted = layer.background !== 'none';
  const { highlight, letters: colour } = textFill(layer.background, layer.color);
  const text = displayText(layer);
  // Words split at ordinary spaces only - \s would also split off the no-break padding.
  const lines = useMemo(() => text.split('\n').map((line) => line.split(/([ \t]+)/).filter((part) => part.length > 0)), [text]);
  const total = Array.from(text.replace(/\n/g, '')).length;
  const timing = useMemo(() => timingFor(animation ?? 'pulse', total), [animation, total]);
  const clock = useClock(timing.cycle);

  const letterStyle = useMemo<TextStyle>(() => ({
    fontFamily: font.family,
    fontSize,
    includeFontPadding: false,
    color: highlighted ? colour : font.glow ? '#FFFFFF' : layer.color,
    ...(highlighted ? { backgroundColor: highlight } : {}),
    ...(font.glow && !highlighted ? { textShadowColor: layer.color, textShadowRadius: fontSize * 0.45, textShadowOffset: { width: 0, height: 0 } } : {}),
  }), [colour, font.family, font.glow, fontSize, highlight, highlighted, layer.color]);

  const pulse = useAnimatedStyle(() => {
    if (animation !== 'pulse') return {};
    // Two beats - big, then smaller - and a rest, like a heartbeat.
    const t = clock.value;
    const first = t > 0 && t < 220 ? Math.sin((t / 220) * Math.PI) * 0.14 : 0;
    const second = t > 260 && t < 480 ? Math.sin(((t - 260) / 220) * Math.PI) * 0.08 : 0;
    return { transform: [{ scale: 1 + first + second }] };
  }, [animation]);

  if (!animation) return <StoryText layer={layer} unit={unit} />;
  let index = 0;
  return (
    <Animated.View style={[{ maxWidth: lineWidth(layer, unit), alignItems: JUSTIFY[layer.align] }, pulse]}>
      {lines.map((parts, line) => (
        <View key={line} style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: JUSTIFY[layer.align], maxWidth: '100%' }}>
          {parts.length === 0 ? <Text style={letterStyle}> </Text> : parts.map((part, word) => (
            // A word longer than the line breaks inside itself instead of running off the screen.
            <View key={word} style={{ flexDirection: 'row', flexWrap: 'wrap', maxWidth: '100%' }}>
              {Array.from(part).map((char) => {
                const at = index;
                index += 1;
                return (
                  <AnimatedLetter key={at} char={char} index={at} animation={animation} timing={timing}
                    clock={clock} amplitude={fontSize * 0.28} style={letterStyle} />
                );
              })}
            </View>
          ))}
        </View>
      ))}
    </Animated.View>
  );
}
