import React, { useRef, useState } from 'react';
import { Image, ImageSourcePropType, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View,
  useWindowDimensions } from 'react-native';
import { TEACH_ART } from './teachArt';

type Slide = { art: ImageSourcePropType; title: string; body: string };

// Three cards, one idea each - what the app is, how to get noticed, and that you're safe.
const SLIDES: Slide[] = [
  { art: TEACH_ART.welcomeCampus, title: 'Meet people on your campus',
    body: 'IEM Connect is made for IEM–UEM students. Verify your college email and you get a blue tick.' },
  { art: TEACH_ART.welcomeRose, title: 'Stand out',
    body: 'Like someone, comment on a photo, or send a Rose to land at the top of their Likes.' },
  { art: TEACH_ART.welcomeShield, title: 'You’re in control',
    body: 'Hide at places you choose, and block or report anyone from their profile or chat.' },
];

/** The welcome cards, before the first Explore. Skip is always there. */
export function WelcomeTour({ onDone, doneLabel = 'Start exploring', topInset = 0, bottomInset = 0 }: {
  onDone: () => void;
  /** The last card's button: what comes next. */
  doneLabel?: string;
  topInset?: number;
  bottomInset?: number;
}) {
  const { width } = useWindowDimensions();
  const pager = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const last = index === SLIDES.length - 1;

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    if (next !== index && next >= 0 && next < SLIDES.length) setIndex(next);
  };
  const next = () => {
    if (last) { onDone(); return; }
    pager.current?.scrollTo({ x: (index + 1) * width, animated: true });
  };

  return <View style={[styles.page, { paddingTop: topInset + 4, paddingBottom: bottomInset + 16 }]}>
    <View style={styles.header}>
      {!last && <Pressable onPress={onDone} accessibilityRole="button" hitSlop={8}
        style={({ pressed }) => [styles.skip, pressed && styles.pressed]}>
        <Text style={styles.skipText}>Skip</Text>
      </Pressable>}
    </View>
    <ScrollView ref={pager} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
      onScroll={onScroll} scrollEventThrottle={32} style={styles.pager}>
      {SLIDES.map((slide, i) => <View key={slide.title} style={[styles.slide, { width }]}
        accessible accessibilityLabel={`${slide.title}. ${slide.body} Card ${i + 1} of ${SLIDES.length}.`}>
        <Image source={slide.art} style={styles.art} resizeMode="contain" accessible={false} />
        <Text style={styles.title}>{slide.title}</Text>
        <Text style={styles.body}>{slide.body}</Text>
      </View>)}
    </ScrollView>
    <View style={styles.footer}>
      <View style={styles.dots} accessible={false}>
        {SLIDES.map((slide, i) => <View key={slide.title} style={[styles.dot, i === index && styles.dotOn]} />)}
      </View>
      <Pressable onPress={next} accessibilityRole="button"
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
        <Text style={styles.buttonText}>{last ? doneLabel : 'Next'}</Text>
      </Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#100F0D' },
  header: { height: 52, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  skip: { height: 44, paddingHorizontal: 8, justifyContent: 'center' },
  skipText: { color: '#C7BFB6', fontFamily: 'DMSans_500Medium', fontSize: 15 },
  pager: { flex: 1 },
  slide: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 24 },
  art: { width: 260, height: 260, marginBottom: 28 },
  title: { color: '#F4EEE5', fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 33, lineHeight: 39,
    textAlign: 'center', paddingBottom: 6, marginBottom: 10, includeFontPadding: true, maxWidth: 360 },
  body: { color: '#C7BFB6', fontFamily: 'DMSans_400Regular', fontSize: 15, lineHeight: 24, textAlign: 'center', maxWidth: 340 },
  footer: { paddingHorizontal: 24, gap: 20, alignItems: 'center' },
  dots: { flexDirection: 'row', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3A3836' },
  dotOn: { width: 22, backgroundColor: '#F7D8E0' },
  button: { width: '100%', maxWidth: 440, minHeight: 52, borderRadius: 26, backgroundColor: '#F7D8E0',
    alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#3A222B', fontFamily: 'DMSans_700Bold', fontSize: 16 },
  pressed: { opacity: 0.72 },
});
