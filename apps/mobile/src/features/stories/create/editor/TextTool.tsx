import React, { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type TextInputProps } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { FontId, TextAnimation, TextLayer } from '../composition/types';
import { AnimatedStoryText, INVISIBLE_INK, TEXT_ANIMATIONS, TEXT_ANIMATION_NAMES, textFill } from './StoryText';
import { CENTER } from '../composition/types';
import { localId } from '../composition/story';
import { STORY_FONTS, fontById } from '../fonts';
import { ColorPicker } from './ColorPicker';
import { VerticalSizeSlider } from './VerticalSizeSlider';
import { useStoryBack } from '../backStack';
import { TextToolIcon } from './TextToolIcon';

type Props = {
  initial?: TextLayer | null;
  unit: number;
  viewport: { left: number; top: number; width: number; height: number };
  onDone: (layer: TextLayer | null) => void;
  /** Pick the text colour from the story itself. */
  onEyedropper?: (apply: (colour: string) => void) => void;
};

const ANIMATION_CYCLE: Array<TextAnimation | undefined> = [undefined, ...TEXT_ANIMATIONS];

/** Blue enough that a blue cursor would vanish on it. */
function isBluish(colour: string) {
  const hex = colour.replace('#', '');
  if (!/^[0-9a-f]{6}/i.test(hex)) return false;
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  return b > 140 && b > r + 40 && b > g;
}

/**
 * The text box, re-rendered only when its look changes - never because of a
 * keystroke. Android re-applies a text box's text whenever React renders it,
 * and doing that mid-typing (the highlight and the animation preview update
 * the tool on every letter) drew each letter twice and flickered. When it does
 * render, its default text is what is typed now, so nothing deleted returns.
 */
const StableTextInput = memo(
  forwardRef<TextInput, TextInputProps>(function StableTextInput(props, ref) {
    return <TextInput ref={ref} {...props} />;
  }),
  (previous, next) => {
    for (const key of Object.keys({ ...previous, ...next }) as Array<keyof TextInputProps>) {
      if (key === 'defaultValue') continue;
      if (previous[key] !== next[key]) return false;
    }
    return true;
  },
);

const BACKGROUNDS: TextLayer['background'][] = ['none', 'solid', 'translucent'];
const TEXT_PADDING = 12;
/**
 * The cursor drawn inside a filled text: a hair space painted in the cursor
 * colour. It has a sliver of width, so the line it sits on gets that much
 * extra room (CARET_ROOM) - otherwise a cursor in the middle of a full line
 * pushed its last letters onto a new one.
 */
// Between word joiners: a hair space alone is a place a line may break, so
// a cursor inside a long word made the line break at the cursor.
const CARET = '\u2060\u200A\u2060';
/** Instagram's blue: a cursor that stands out from the band and the letters. */
const CARET_BLUE = '#3897F0';
/** Room kept on each side of the text box for the size slider. */
const SLIDER_CLEARANCE = 58;
/** The colour row and the font row above the keyboard. */
const TOOL_ROWS_HEIGHT = 68;
const scrollStyle = { flex: 1 } as const;

/**
 * The keyboard's height the last time it opened. The text area keeps this
 * room from its first frame, so when the keyboard rises the middle doesn't
 * move and the cursor stays exactly where it started. Until a keyboard has
 * been seen, a share of the screen close to a phone keyboard.
 */
let rememberedKeyboard: number | null = null;
const ALIGNS: TextLayer['align'][] = ['center', 'left', 'right'];

/**
 * Instagram's Aa tool: type over the story, choose a font from the row
 * above the keyboard, a colour, an alignment, a highlight behind the lines, and
 * a size on the left. Done with empty text removes the layer.
 */
export function TextTool({ initial, unit, viewport, onDone, onEyedropper }: Props) {
  const insets = useSafeAreaInsets();
  const input = useRef<TextInput>(null);
  const scroll = useRef<ScrollView>(null);
  // The typed text lives in the input itself, and here only as a ref. With the
  // input controlled, every keystroke wrote the text back from React a moment
  // late: fast typing flickered, and an emoji (sent by the keyboard as text
  // still being composed) was interrupted and did not appear until later.
  const textRef = useRef(initial?.text ?? '');
  // Only the highlight layer behind the input follows the text as it changes.
  const [highlightText, setHighlightText] = useState(initial?.text ?? '');
  // Where the cursor is, for the cursor drawn inside a filled text (below).
  const [selection, setSelection] = useState(() => {
    const end = (initial?.text ?? '').length;
    return { start: end, end };
  });
  const onSelectionChange = useCallback((event: { nativeEvent: { selection: { start: number; end: number } } }) => {
    const next = event.nativeEvent.selection;
    setSelection((current) => (current.start === next.start && current.end === next.end ? current : next));
  }, []);
  // The drawn cursor blinks like the real one, and shows solid right after each change.
  const [caretOn, setCaretOn] = useState(true);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [keyboardRoom, setKeyboardRoom] = useState(() => rememberedKeyboard ?? Math.round(screenHeight * 0.36));
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      const height = Math.round(event.endCoordinates.height);
      if (height <= 0) return;
      rememberedKeyboard = height;
      // Only a real difference moves anything (the first time, if the estimate was off).
      setKeyboardRoom((current) => (Math.abs(current - height) > 4 ? height : current));
    });
    return () => shown.remove();
  }, []);
  // Clear of the size slider on the left (it sits at 6 and is 44 wide), with
  // the same margin on the right so centred text stays centred.
  const boxWidth = Math.round(screenWidth - 2 * SLIDER_CLEARANCE);
  /** The text's own line width: the box less its padding on each side. */
  const wrapWidth = boxWidth - 2 * TEXT_PADDING;
  const [font, setFont] = useState<FontId>(initial?.font ?? 'classic');
  const [color, setColor] = useState(initial?.color ?? '#FFFFFF');
  const [background, setBackground] = useState<TextLayer['background']>(initial?.background ?? 'none');
  const [align, setAlign] = useState<TextLayer['align']>(initial?.align ?? 'center');
  const [size, setSize] = useState(initial?.size ?? 90);
  const changeSize = useCallback((next: number) => setSize(Math.round(next)), []);
  const [animation, setAnimation] = useState<TextAnimation | undefined>(initial?.animation);
  const [toolHint, setToolHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToolHint = useCallback((message: string) => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
    setToolHint(message);
    hintTimer.current = setTimeout(() => setToolHint(null), 1600);
  }, []);
  useEffect(() => () => { if (hintTimer.current) clearTimeout(hintTimer.current); }, []);
  // The animation plays over the input once typing pauses; while typing, the
  // input's own text shows, so letters never vanish under the cursor.
  const [previewText, setPreviewText] = useState(initial?.text ?? '');
  const [typing, setTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
  }, []);
  const showPreview = !!animation && !typing && previewText.trim().length > 0;
  const settings = useRef({ highlighted: false, animation: undefined as TextAnimation | undefined });
  settings.current = { highlighted: background !== 'none', animation };
  useEffect(() => {
    if (background === 'none') return;
    setCaretOn(true);
    let on = true;
    let timer: ReturnType<typeof setTimeout>;
    const flip = () => {
      on = !on;
      setCaretOn(on);
      timer = setTimeout(flip, on ? 600 : 450);
    };
    timer = setTimeout(flip, 600);
    return () => clearTimeout(timer);
  }, [background, highlightText, selection]);

  const onChangeText = useCallback((value: string) => {
    // Android re-reports the same text when its text is re-applied (a size or
    // font change, the keyboard finishing a word). Answering those echoes with an
    // update could start another echo, and a chain of them ended in "Maximum
    // update depth exceeded". Only a real change does anything.
    if (value === textRef.current) return;
    textRef.current = value;
    if (settings.current.highlighted) setHighlightText(value);
    if (settings.current.animation) {
      setTyping(true);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => {
        setPreviewText(textRef.current);
        setTyping(false);
      }, 700);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => input.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, []);

  const finish = () => {
    const value = textRef.current.replace(/\s+$/, '');
    if (!value.trim()) {
      onDone(null);
      return;
    }
    onDone({
      id: initial?.id ?? localId('t'),
      kind: 'text',
      text: value,
      font,
      color,
      background,
      align,
      size: Math.round(size),
      // Always set, so turning the animation off on an existing layer clears it.
      animation,
      // The width the lines broke at while typing, so they break the same after Done.
      // With a fill the letters are laid out with room for the cursor; the posted text gets the same.
      wrap: Math.round((wrapWidth + (background !== 'none' ? caretRoom : 0)) / unit),
      transform: initial?.transform ?? { ...CENTER, y: 760 },
    });
  };

  // Back keeps what was typed, like tapping Done.
  useStoryBack(() => {
    finish();
    return true;
  });

  const face = fontById(font);
  const fontSize = size * face.scale * unit;
  /** Enough for the drawn cursor (a hair space is at most about a tenth of the font size). */
  const caretRoom = Math.ceil(fontSize * 0.12) + 2;
  const verticalInset = face.glow ? 0.5 : 0.2;
  const highlighted = background !== 'none';
  const fill = textFill(background, color);
  // The cursor is blue, unless the fill is itself blue-ish - then the letter colour.
  const caretColour = isBluish(color) ? fill.letters : CARET_BLUE;

  // Shared by the input and the highlight layer, so both wrap lines identically.
  const textMetrics = useMemo(() => ({
    fontFamily: face.family,
    fontSize,
    // No lineHeight: on Android it makes a multiline input jump on every keystroke.
    includeFontPadding: true,
    paddingVertical: Math.ceil(fontSize * verticalInset),
    paddingHorizontal: TEXT_PADDING,
    textAlign: align,
    width: boxWidth,
  }), [align, boxWidth, face.family, fontSize, verticalInset]);

  // Rebuilt only when a setting changes, never while typing. The box has a
  // fixed width: sized to its text and centred, it moved on every keystroke
  // and Android briefly drew the cursor at the old and new positions.
  const inputStyle = useMemo(() => ({
    ...textMetrics,
    textAlignVertical: 'center' as const,
    minHeight: Math.ceil(fontSize * (1.35 + verticalInset * 2)),
    // With a fill, the letters are drawn by the highlight layer together with
    // their band, so the band never trails the text by a frame; the box keeps
    // only the cursor and the typing. Without one, the box draws the letters.
    color: highlighted ? INVISIBLE_INK : fill.letters,
    backgroundColor: 'transparent',
    ...(face.glow && !highlighted ? { textShadowColor: color, textShadowRadius: fontSize * 0.45, textShadowOffset: { width: 0, height: 0 }, color: '#fff' } : {}),
    // The animated preview draws the text instead: the box steps out of sight,
    // so the two never show at once.
    ...(showPreview ? { opacity: 0 } : {}),
  }), [color, face.glow, fill.letters, fontSize, highlighted, showPreview, textMetrics, verticalInset]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={StyleSheet.absoluteFill} onPress={finish} accessibilityLabel="Finish text" />

      <View style={[styles.top, { top: insets.top }]}>
        <View style={styles.formatControls}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Text alignment: ${align}`}
          accessibilityHint="Tap to change text alignment." onLongPress={() => showToolHint(`Alignment: ${align}`)}
          onPress={() => {
            const next = ALIGNS[(ALIGNS.indexOf(align) + 1) % ALIGNS.length];
            setAlign(next);
            showToolHint(`Alignment: ${next}`);
          }} style={({ pressed }) => [styles.topButton, pressed && styles.pressed]}>
          <TextToolIcon name={align} size={22} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Text background: ${background}`}
          accessibilityState={{ selected: highlighted }} accessibilityHint="Tap to change text background."
          onLongPress={() => showToolHint(`Background: ${background}`)} onPress={() => {
            setHighlightText(textRef.current);
            const next = BACKGROUNDS[(BACKGROUNDS.indexOf(background) + 1) % BACKGROUNDS.length];
            setBackground(next);
            showToolHint(`Background: ${next}`);
          }} style={({ pressed }) => [styles.topButton, highlighted && styles.activeButton, pressed && styles.pressed]}>
          <TextToolIcon name="background" color={highlighted ? '#F3C1CA' : '#FFF4F6'}
            fill={highlighted ? fill.highlight : 'none'} letters={highlighted ? fill.letters : '#FFF4F6'} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Text animation: ${animation ? TEXT_ANIMATION_NAMES[animation] : 'off'}`}
          accessibilityState={{ selected: !!animation }} accessibilityHint="Tap to change text animation."
          onLongPress={() => showToolHint(`Animation: ${animation ? TEXT_ANIMATION_NAMES[animation] : 'off'}`)}
          onPress={() => {
            setPreviewText(textRef.current);
            setTyping(false);
            const next = ANIMATION_CYCLE[(ANIMATION_CYCLE.indexOf(animation) + 1) % ANIMATION_CYCLE.length];
            setAnimation(next);
            showToolHint(`Animation: ${next ? TEXT_ANIMATION_NAMES[next] : 'off'}`);
          }}
          style={({ pressed }) => [styles.topButton, !!animation && styles.activeButton, pressed && styles.pressed]}
        >
          <TextToolIcon name="animation" color={animation ? '#F3C1CA' : '#FFF4F6'} />
        </Pressable>
        </View>
        <View style={{ flex: 1 }} />
        <Pressable accessibilityRole="button" accessibilityLabel="Done editing text" hitSlop={4}
          onPress={finish} style={({ pressed }) => [styles.done, pressed && styles.pressed]}>
          <TextToolIcon name="done" size={16} color="#332027" />
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </View>
      {toolHint && <View pointerEvents="none" style={[styles.hint, { top: insets.top + 48 }]}>
        <Text accessibilityLiveRegion="polite" style={styles.hintText}>{toolHint}</Text>
      </View>}

      {/* A fixed room above the keyboard and the tool rows - not one that
          follows the keyboard, which moved the cursor as the keyboard rose. */}
      <View pointerEvents="box-none" style={[styles.area, { top: insets.top + 52, paddingBottom: keyboardRoom + TOOL_ROWS_HEIGHT }]}>
        <View pointerEvents="box-none" style={styles.aboveTools}>
        <ScrollView
          ref={scroll}
          style={scrollStyle}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator={false}
          // Growing text pushes up, not down: the newest line stays in view.
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
        >
        <Pressable style={styles.tapArea} onPress={finish} accessible={false}>
        <View style={{ width: boxWidth }}>
        {highlighted && !showPreview ? (
          // The highlight behind each line, laid out exactly like the input's text.
          <Text pointerEvents="none" style={[textMetrics, styles.highlightLayer, {
            width: boxWidth + caretRoom,
            // Half the room on each side for centred text, all of it on the far
            // side otherwise, so the letters sit exactly over the box's.
            left: align === 'center' ? -caretRoom / 2 : align === 'right' ? -caretRoom : 0,
          }]}>
            {/* Band and letters in one span, drawn in the same frame. The span sets
                its own colour: Android doesn't pass the parent's down reliably. */}
            {selection.start === selection.end ? (
              <>
                <Text style={{ backgroundColor: fill.highlight, color: fill.letters }}>{highlightText.slice(0, selection.start)}</Text>
                {/* The cursor, drawn in the same text as the letters and the band, so
                    it never runs ahead of them: a hair space the colour of the letters. */}
                <Text style={{ backgroundColor: caretOn ? caretColour : fill.highlight, color: INVISIBLE_INK }}>{CARET}</Text>
                <Text style={{ backgroundColor: fill.highlight, color: fill.letters }}>{highlightText.slice(selection.start)}</Text>
              </>
            ) : (
              // A selection: the box's own selection tint shows over the letters.
              <Text style={{ backgroundColor: fill.highlight, color: fill.letters }}>{highlightText}</Text>
            )}
          </Text>
        ) : null}
        {showPreview ? (
          // Exactly what will be posted: the same renderer, centred where the text is.
          <View pointerEvents="none" style={styles.preview}>
            <AnimatedStoryText key={`${animation}-${previewText}`} unit={unit}
              layer={{ text: previewText, font, color, background, align, size: Math.round(size), animation, wrap: wrapWidth / unit }} />
          </View>
        ) : null}
        <StableTextInput
          ref={input}
          // Always the text as typed now: Android applies this whenever the box
          // re-renders (a size or font change), so the opening text here brought
          // deleted text back, and leaving it out emptied the box.
          defaultValue={textRef.current}
          onChangeText={onChangeText}
          onSelectionChange={onSelectionChange}
          multiline
          autoCorrect
          // Capitals for Strong, Squeeze and Poster come from the keyboard. A
          // text transform rewrote what the keyboard was still composing,
          // which broke emoji and flickered.
          autoCapitalize={face.uppercase ? 'characters' : 'sentences'}
          textAlign={align}
          placeholder=" "
          placeholderTextColor="transparent"
          // A tint, so selected letters stay readable; white text under a white
          // selection disappeared. The cursor and the handles stay white.
          selectionColor="rgba(120,170,255,0.45)"
          // On a fill, the cursor takes the letter colour, or it vanishes on a white band.
          selectionHandleColor={highlighted ? fill.letters : '#FFFFFF'}
          cursorColor={highlighted ? fill.letters : '#FFFFFF'}
          // A multiline input scrolls inside itself on Android and shifts the text as it grows.
          scrollEnabled={false}
          // Hidden with the box while the animated preview plays, so no cursor line shows over it.
          // With a fill, the cursor is drawn with the letters instead (see the highlight layer).
          caretHidden={showPreview || highlighted}
          style={inputStyle}
        />
        </View>
        </Pressable>
        </ScrollView>
        </View>
      </View>

      {/* After the text box: the two overlap on the left, and the slider must win the touch. */}
      <View style={[styles.slider, { top: insets.top + 76 }]}>
        <VerticalSizeSlider value={size} min={40} max={200} onChange={changeSize} onChangeStep={3} />
      </View>

      <KeyboardStickyView style={[styles.bottom, { left: viewport.left, width: viewport.width }]}
        offset={{ closed: -insets.bottom, opened: 0 }}>
        <ColorPicker compact value={color} onChange={setColor} onEyedropper={onEyedropper ? () => onEyedropper(setColor) : undefined} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always"
          style={styles.fontRow} contentContainerStyle={styles.fonts}>
          {STORY_FONTS.map((entry) => (
            <Pressable
              key={entry.id}
              accessibilityRole="button"
              accessibilityLabel={`${entry.name} font`}
              onPress={() => setFont(entry.id)}
              style={[styles.fontChip, font === entry.id && styles.fontChipActive]}
            >
              <Text style={[styles.fontName, { fontFamily: entry.family }, font === entry.id && styles.fontNameActive]}>
                {entry.uppercase ? entry.name.toUpperCase() : entry.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </KeyboardStickyView>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 12, zIndex: 2 },
  formatControls: { flexDirection: 'row', backgroundColor: '#252325', borderRadius: 22, overflow: 'hidden' },
  topButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  activeButton: { backgroundColor: '#49343D' },
  pressed: { opacity: 0.65 },
  done: { minWidth: 76, height: 36, paddingHorizontal: 12, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: '#F3C1CA' },
  doneText: { color: '#332027', fontSize: 14, fontWeight: '700' },
  hint: { position: 'absolute', alignSelf: 'center', maxWidth: '85%', backgroundColor: '#252325', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7, zIndex: 3 },
  hintText: { color: '#FFF4F6', fontSize: 12, textAlign: 'center' },
  slider: { position: 'absolute', left: 6 },
  area: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  scrollContent: { flexGrow: 1 },
  aboveTools: { flex: 1 },
  // Fills the area, so a tap beside the text still finishes. The cursor starts
  // in the middle of the room above the tools; the text grows both ways and,
  // once it fills that room, scrolls with the newest line in view (Instagram).
  tapArea: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 4, paddingBottom: 6 },
  // Only the line backgrounds show; the letters themselves are the input's.
  highlightLayer: { position: 'absolute', top: 0, left: 0, color: INVISIBLE_INK },
  preview: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', bottom: 0, paddingBottom: 4, backgroundColor: 'transparent' },
  fontRow: { height: 32, flexGrow: 0 },
  fonts: { paddingHorizontal: 8, gap: 6, paddingVertical: 2, alignItems: 'center' },
  fontChip: { paddingHorizontal: 12, height: 28, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  fontChipActive: { backgroundColor: '#fff', borderColor: '#fff' },
  fontName: { color: '#fff', fontSize: 13 },
  fontNameActive: { color: '#000' },
});
