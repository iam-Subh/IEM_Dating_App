import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useVerificationStatus, type VerificationStatus } from './useVerificationStatus';
import { ReminderBanner, reminderColors, useResetCountdown } from './ReminderParts';
import { ReminderArt } from './ReminderArt';
import { dismissNudge, isNudgeDismissed, popupAvailableToday, spendPopupToday } from './nudges';
import { navigationRef } from '../../navigation/navigationRef';
import { useVerificationPreview } from './VerificationPreviewContext';

/** After about this many swipes in one sitting. */
const SWIPES_BEFORE_NUDGE = 20;

export type DeckCardKind = 'likes' | 'paused' | 'selfiePaused';

/** "Keep browsing" on the out-of-likes card holds for the rest of that day. */
let likesCardClosedOn: string | null = null;
const istDay = () => new Date(Date.now() + 5.5 * 60 * 60_000).toISOString().slice(0, 10);

function deckCardFor(status: VerificationStatus | null): DeckCardKind | null {
  if (!status) return null;
  if (!status.limited && status.owesRealPerson && status.paused) return 'selfiePaused';
  if (!status.limited) return null;
  if (status.paused) return 'paused';
  if (status.likesLeft === 0 && likesCardClosedOn !== istDay()) return 'likes';
  return null;
}

/**
 * The deck's own card for a state that stops swiping (REMINDER_DESIGN.md,
 * pattern D) - like Hinge's "You've seen everyone", in the card's place
 * rather than over it: out of likes for today, or a paused profile.
 */
export function useDeckReminderCard(demo = false) {
  const status = useVerificationStatus();
  const [, setClosed] = useState(0);
  const kind = demo ? null : deckCardFor(status);
  const keepBrowsing = kind === 'likes' ? () => { likesCardClosedOn = istDay(); setClosed((value) => value + 1); } : undefined;
  return { kind, keepBrowsing };
}

export function DeckReminderCard({ kind, onKeepBrowsing }: { kind: DeckCardKind; onKeepBrowsing?: () => void }) {
  const navigation = useNavigation<any>();
  const countdown = useResetCountdown(kind === 'likes');
  const likes = kind === 'likes';
  const selfie = kind === 'selfiePaused';
  // The kitten takes what the words and buttons leave of the card's height.
  const [height, setHeight] = useState(0);
  const art = Math.round(Math.max(96, Math.min(212, height - (likes ? 330 : 270))));
  return <View style={card.root} onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
    {height ? <ReminderArt name={likes ? 'kittenLikes' : 'kittenPaused'} size={art} motion="lively" bounce={likes}
      glow={likes ? '#FF7FA0' : '#F0C17A'} /> : <View style={{ height: 96 }} />}
    <Text accessibilityRole="header" style={card.title}>{likes ? 'You’re out of likes' : 'Your profile is paused'}</Text>
    {likes ? <>
      <Text style={card.label}>New likes in</Text>
      <Text style={card.countdown} accessibilityLabel={`New likes in ${countdown}`}>{countdown}</Text>
    </> : <Text style={card.body}>{selfie
      ? 'Other people can’t see you until you complete your selfie check. Your matches and chats are still here.'
      : 'Other people can’t see you until you verify your college. Your matches and chats are still here.'}</Text>}
    {likes ? <View style={card.benefits}>
      {['Unlimited likes', 'Unlimited chat', '5 Roses each week'].map((benefit) => <View key={benefit} style={card.benefit}>
        <Ionicons name="checkmark" size={15} color={reminderColors.success} /><Text style={card.benefitText}>{benefit}</Text>
      </View>)}
    </View> : null}
    <View style={card.actions}>
      <Pressable accessibilityRole="button" onPress={() => navigation.navigate(selfie ? 'RealPersonCheck' : 'VerifyCollege')}
        style={({ pressed }) => [card.primary, pressed && card.pressed]}>
        <Text style={card.primaryText}>{likes ? 'Verify for unlimited likes' : selfie ? 'Start selfie check' : 'Verify and unpause'}</Text>
      </Pressable>
      {onKeepBrowsing ? <Pressable accessibilityRole="button" onPress={onKeepBrowsing} style={({ pressed }) => [card.secondary, pressed && card.pressed]}>
        <Text style={card.secondaryText}>Keep browsing</Text>
      </Pressable> : null}
    </View>
  </View>;
}

/**
 * The deck's slim reminders, most urgent first. The states that stop
 * swiping have their own card (above), so they are not repeated here.
 *
 * - a verified student's first unverified card: the "Verified students only" tip;
 * - a verification that ran out: "Re-verify";
 * - the pause coming in 4 days or fewer (college, or the selfie);
 * - likes running low, or used up after "Keep browsing";
 * - after ~20 swipes, a gentle nudge - at most one a day.
 *
 * Once, on first reaching the deck after onboarding, the welcome sheet.
 */
export function DeckVerifyBanner({ swipes, topCardUnverified, cardShown = false }: { swipes: number; topCardUnverified?: boolean; /** The deck's own card is up (useDeckReminderCard). */ cardShown?: boolean }) {
  const status = useVerificationStatus();
  const navigation = useNavigation<any>();
  const focused = useIsFocused();
  const [swipeNudge, setSwipeNudge] = useState(false);
  const outOfLikes = !!status?.limited && status.likesLeft === 0;
  const countdown = useResetCountdown(outOfLikes);
  // A preview shows the nudge from the swipe count alone, and never opens the welcome sheet.
  const preview = !!useVerificationPreview();
  useEffect(() => {
    if (preview || !status?.limited || status.paused || !focused) return;
    let live = true;
    void (async () => {
      const shown = await isNudgeDismissed('welcome');
      const available = await popupAvailableToday();
      if (!live || shown || !available || !navigationRef.isReady()) return;
      void dismissNudge('welcome');
      void spendPopupToday();
      navigationRef.navigate('VerifyRules', { reason: 'welcome' });
    })();
    return () => { live = false; };
  }, [preview, status?.limited, status?.paused, focused]);
  useEffect(() => {
    if (!status?.limited || !focused || swipeNudge || swipes < SWIPES_BEFORE_NUDGE) return;
    if (preview) { setSwipeNudge(true); return; }
    let live = true;
    void popupAvailableToday().then((available) => {
      if (!live || !available) return;
      setSwipeNudge(true);
      void spendPopupToday();
    });
    return () => { live = false; };
  }, [preview, status?.limited, focused, swipeNudge, swipes]);

  if (!status || cardShown) return null;
  const verify = () => navigation.navigate('VerifyCollege');
  const selfie = () => navigation.navigate('RealPersonCheck');
  const days = status.graceDaysLeft;
  const inDays = days === 1 ? '1 day' : `${days} days`;
  if (status.verified && topCardUnverified) {
    return <ReminderBanner art="preferences" text="Tip: show only students who verified their college." action="Preferences"
      onPress={() => navigation.navigate('Preferences')} dismissKey="verified-only-tip" dismissDays={Infinity} />;
  }
  if (status.expired) {
    return <ReminderBanner art="renew" tone="warn" text="Your college verification has ended." action="Re-verify" onPress={verify}
      dismissKey="deck-reverify" dismissDays={1} />;
  }
  if (!status.limited) {
    if (status.owesRealPerson && days !== null && days <= 4) {
      return <ReminderBanner art="deadline" tone="warn" text={`Your profile pauses in ${inDays}. Complete your selfie check.`} action="Start" onPress={selfie} />;
    }
    return null;
  }
  if (days !== null && days <= 4) {
    return <ReminderBanner art="deadline" tone="warn" text={`Your profile pauses in ${inDays}. Verify to stay visible.`} onPress={verify} />;
  }
  if (outOfLikes) {
    return <ReminderBanner art="likes" tone="warn" text={`Out of likes · new likes in ${countdown}`} onPress={verify} />;
  }
  if (status.likesLeft !== null && status.likesLeft <= 5) {
    return <ReminderBanner art="likes" text={`${status.likesLeft} ${status.likesLeft === 1 ? 'like' : 'likes'} left today. Verify for unlimited likes.`} onPress={verify} />;
  }
  if (swipeNudge) {
    return <ReminderBanner art="badge" text="Verify your college: step 1 of your blue badge." onPress={verify} dismissKey="deck-swipes" dismissDays={1} />;
  }
  return null;
}

const card = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 10, right: 10, bottom: 0, borderRadius: 24, backgroundColor: '#1A181B', borderWidth: StyleSheet.hairlineWidth, borderColor: reminderColors.line, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 20, overflow: 'hidden' },
  title: { fontFamily: 'DMSans_700Bold', fontSize: 23, lineHeight: 29, color: reminderColors.text, textAlign: 'center', marginTop: 8 },
  label: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: reminderColors.muted, marginTop: 16, letterSpacing: 0.3 },
  countdown: { fontFamily: 'DMSans_700Bold', fontSize: 40, lineHeight: 48, color: reminderColors.text, fontVariant: ['tabular-nums'], marginTop: 2 },
  body: { fontFamily: 'DMSans_400Regular', fontSize: 14.5, lineHeight: 21, color: reminderColors.secondary, textAlign: 'center', marginTop: 10, maxWidth: 320 },
  benefits: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 14, rowGap: 6, marginTop: 18 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  benefitText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: reminderColors.secondary },
  actions: { alignSelf: 'stretch', marginTop: 26, gap: 4 },
  primary: { minHeight: 52, borderRadius: 26, backgroundColor: reminderColors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  primaryText: { fontFamily: 'DMSans_700Bold', fontSize: 15, color: reminderColors.accentText },
  secondary: { minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: reminderColors.secondary },
  pressed: { opacity: 0.75 },
});
