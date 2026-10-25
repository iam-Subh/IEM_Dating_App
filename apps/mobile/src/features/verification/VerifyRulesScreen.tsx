import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, BackHandler, Easing, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { reminderColors, useResetCountdown } from './ReminderParts';
import { ReminderArt, type ReminderArtName } from './ReminderArt';
import { useVerificationStatus } from './useVerificationStatus';

export type VerifyReason = 'chat' | 'media' | 'rose' | 'roseSent' | 'likes' | 'paused' | 'follows' | 'mention' | 'standouts' | 'welcome' | 'area' | 'search';
type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * What each limit says (REMINDER_DESIGN.md, pattern E): what happened, when
 * it resets if it does, what verifying adds, and what still works.
 */
export const VERIFICATION_REASONS: Record<VerifyReason, {
  icon: IconName; art: ReminderArtName; title: string; body?: string; resetsIn?: string; benefits: string[]; keep: string; later: string;
}> = {
  welcome: { art: 'badge', icon: 'school-outline', title: 'Make your college official', body: 'Verify your college email - step 1 of your blue badge.', benefits: ['Unlimited chat', 'Unlimited likes', '5 Roses each week'], keep: 'It takes a minute: your college email and a 6-digit code.', later: 'Not now' },
  chat: { art: 'chat', icon: 'chatbubbles-outline', title: 'You’ve used your 30 messages', body: 'Verify your college to keep chatting.', benefits: ['Unlimited chat', 'Photos and files'], keep: 'Your conversations stay here.', later: 'Not now' },
  media: { art: 'media', icon: 'images-outline', title: 'Photos and files need verification', body: 'Verify your college to send photos, videos and files.', benefits: ['Photos and videos', 'Files', 'Unlimited chat'], keep: 'Messages and voice notes still work.', later: 'Back to chat' },
  rose: { art: 'rose', icon: 'rose-outline', title: 'You’ve used your trial Rose', body: 'Verified students get 5 Roses every week.', benefits: ['5 Roses each week', 'Unlimited likes'], keep: 'Likes still work.', later: 'Not now' },
  roseSent: { art: 'rose', icon: 'rose-outline', title: 'Your Rose is on its way', body: 'That was your trial Rose. Verify your college to get 5 every week.', benefits: ['5 Roses each week', 'Unlimited likes'], keep: 'You can keep browsing without verifying.', later: 'Keep browsing' },
  likes: { art: 'likes', icon: 'heart-outline', title: 'You’re out of likes', resetsIn: 'New likes in', benefits: ['Unlimited likes', 'Unlimited chat'], keep: 'You can still pass and message your matches.', later: 'Not now' },
  paused: { art: 'paused', icon: 'eye-off-outline', title: 'Your profile is paused', body: 'The 14 days to verify have ended, so other people can’t see you.', benefits: ['Visible again at once'], keep: 'Your matches and chats are still here.', later: 'Not now' },
  follows: { art: 'follow', icon: 'person-add-outline', title: 'You’ve sent today’s follow requests', resetsIn: 'More requests in', benefits: ['Unlimited follow requests'], keep: 'Your requests so far are on their way.', later: 'Not now' },
  mention: { art: 'mention', icon: 'at-outline', title: 'Mention anyone in your story', body: 'Verify your college to mention people beyond your matches.', benefits: ['Mention anyone'], keep: 'You can still mention your matches.', later: 'Back to my story' },
  standouts: { art: 'standouts', icon: 'star-outline', title: 'Get into Standouts', body: 'Verified students appear in Standouts.', benefits: ['A place in Standouts', '5 Roses each week'], keep: 'You can still browse Standouts.', later: 'Not now' },
  area: { art: 'campus', icon: 'globe-outline', title: 'Meet beyond your campus', body: 'Verify your college to see every campus.', benefits: ['All campuses', 'Both colleges'], keep: 'Your campus and Nearby still work.', later: 'Not now' },
  search: { art: 'search', icon: 'search-outline', title: 'You’ve reached today’s search limit', resetsIn: 'More searches in', benefits: ['Unlimited search', 'Every campus'], keep: 'People you’ve already seen stay in your results.', later: 'Not now' },
};

const OPEN_MS = 260;
const CLOSE_MS = 200;

/**
 * A limit, as a bottom sheet the way Tinder shows "You're out of likes":
 * short, swipe it away, the countdown when the limit resets, one button.
 */
export const VerifyRulesScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const status = useVerificationStatus();
  const candidate = route.params?.reason as VerifyReason;
  const reason = Object.prototype.hasOwnProperty.call(VERIFICATION_REASONS, candidate) ? candidate : 'chat';
  const content = VERIFICATION_REASONS[reason];
  const countdown = useResetCountdown(!!content.resetsIn);
  // Paused with the college done: what is missing is the selfie.
  const selfie = reason === 'paused' && !!status?.verified && !!status.owesRealPerson;

  const [height, setHeight] = useState(560);
  const shown = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);

  useEffect(() => {
    let live = true;
    const open = (reduced: boolean) => {
      if (!live) return;
      if (reduced) { shown.setValue(1); return; }
      Animated.timing(shown, { toValue: 1, duration: OPEN_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    };
    AccessibilityInfo.isReduceMotionEnabled().then(open).catch(() => open(true));
    return () => { live = false; shown.stopAnimation(); };
  }, [shown]);

  const close = (then?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(shown, { toValue: 0, duration: CLOSE_MS, easing: Easing.in(Easing.cubic), useNativeDriver: true })
      .start(() => (then ? then() : navigation.goBack()));
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { closeRef.current(); return true; });
    return () => listener.remove();
  }, []);

  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderMove: (_event, gesture) => drag.setValue(Math.max(0, gesture.dy)),
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dy > 110 || gesture.vy > 0.9) { closeRef.current(); return; }
      Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
    },
    onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start(),
  }), [drag]);

  const verify = () => navigation.replace(selfie ? 'RealPersonCheck' : 'VerifyCollege');
  const translateY = Animated.add(shown.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }), drag);

  return <View style={styles.root}>
    <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: shown }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} accessibilityRole="button" accessibilityLabel="Close" />
    </Animated.View>
    <Animated.View accessibilityViewIsModal onLayout={(event) => setHeight(event.nativeEvent.layout.height)} {...pan.panHandlers}
      style={[styles.sheet, { paddingBottom: insets.bottom + 12, transform: [{ translateY }] }]}>
      <View style={styles.handle} />
      <View style={styles.heading}>
        <ReminderArt name={selfie ? 'selfie' : content.art} size={112} motion="float" delay={OPEN_MS - 60} />
        <View style={styles.headingCopy}>
          <Text accessibilityRole="header" style={styles.title}>{content.title}</Text>
          {content.resetsIn
            ? <Text style={styles.reset} accessibilityLabel={`${content.resetsIn} ${countdown}`}>{content.resetsIn} <Text style={styles.time}>{countdown}</Text></Text>
            : <Text style={styles.body}>{selfie ? 'Complete your selfie check to make your profile visible again.' : content.body}</Text>}
        </View>
      </View>

      <View style={styles.benefits}>
        {content.benefits.map((benefit) => <View key={benefit} style={styles.benefit}>
          <Ionicons name="checkmark" size={16} color={reminderColors.success} />
          <Text style={styles.benefitText}>{benefit}</Text>
        </View>)}
      </View>
      <Text style={styles.keep}>{content.keep}</Text>

      <Pressable accessibilityRole="button" onPress={verify} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
        <Text style={styles.primaryText}>{selfie ? 'Start selfie check' : reason === 'paused' ? 'Verify and unpause' : 'Verify with college email'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => close()} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
        <Text style={styles.secondaryText}>{content.later}</Text>
      </Pressable>
    </Animated.View>
  </View>;
};

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { width: '100%', maxWidth: 560, alignSelf: 'center', backgroundColor: '#1D1B1E', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 8 },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: '#4A464C', marginBottom: 6 },
  heading: { alignItems: 'center', gap: 10 },
  headingCopy: { alignSelf: 'stretch', alignItems: 'center' },
  title: { fontFamily: 'DMSans_700Bold', fontSize: 20, lineHeight: 26, color: reminderColors.text, textAlign: 'center' },
  body: { fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 20, color: reminderColors.secondary, marginTop: 4, textAlign: 'center', maxWidth: 340 },
  reset: { fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 20, color: reminderColors.secondary, marginTop: 4, textAlign: 'center' },
  time: { fontFamily: 'DMSans_700Bold', color: reminderColors.text, fontVariant: ['tabular-nums'] },
  benefits: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 16, rowGap: 8, marginTop: 18 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  benefitText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: reminderColors.text },
  keep: { fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 18, color: reminderColors.muted, marginTop: 12, textAlign: 'center' },
  primary: { minHeight: 52, borderRadius: 26, backgroundColor: reminderColors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 22, paddingHorizontal: 16 },
  primaryText: { fontFamily: 'DMSans_700Bold', fontSize: 15, color: reminderColors.accentText },
  secondary: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  secondaryText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: reminderColors.secondary },
  pressed: { opacity: 0.75 },
});
