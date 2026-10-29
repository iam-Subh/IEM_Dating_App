import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useVerificationStatus, type VerificationStatus } from './useVerificationStatus';
import { reminderColors, useResetCountdown } from './ReminderParts';
import { ReminderArt, type ReminderArtName } from './ReminderArt';
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

/** One of the deck's verify reminders, shown as a card in the deck. */
export type DeckPrompt = {
  key: string;
  art: ReminderArtName;
  tone: 'neutral' | 'warn';
  title: string;
  body: string;
  action: string;
  onPress: () => void;
  /** "Keep browsing" hides it for this many days. */
  days: number;
};

/**
 * The deck's verify reminders, most urgent first - shown as a card in the
 * deck rather than a banner above it, so the profiles keep their room. The
 * states that stop swiping have their own card (DeckReminderCard), so they are
 * not repeated here. "Keep browsing" puts each away for as long as the
 * banner's close did.
 *
 * - a verified student's first unverified card: the "Verified students only" tip;
 * - a verification that ran out: "Re-verify";
 * - the pause coming in 4 days or fewer (college, or the selfie);
 * - likes running low (once a day);
 * - after ~20 swipes, a gentle nudge - at most one a day.
 *
 * Once, on first reaching the deck after onboarding, the welcome sheet.
 */
export function useDeckPrompt({ swipes, topCardUnverified, cardShown = false }: { swipes: number; topCardUnverified?: boolean; /** The deck's own card is up (useDeckReminderCard). */ cardShown?: boolean }) {
  const status = useVerificationStatus();
  const navigation = useNavigation<any>();
  const focused = useIsFocused();
  const [swipeNudge, setSwipeNudge] = useState(false);
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

  // Every reminder that applies now, most urgent first.
  const candidates: DeckPrompt[] = [];
  if (status) {
    const verify = () => navigation.navigate('VerifyCollege');
    const selfie = () => navigation.navigate('RealPersonCheck');
    const days = status.graceDaysLeft;
    const inDays = days === 1 ? '1 day' : `${days} days`;
    if (status.verified && topCardUnverified) {
      candidates.push({ key: 'verified-only-tip', art: 'preferences', tone: 'neutral', title: 'Only verified students?',
        body: 'You can choose to see only people who verified their college.', action: 'Open preferences',
        onPress: () => navigation.navigate('Preferences'), days: Infinity });
    }
    if (status.expired) {
      candidates.push({ key: 'deck-reverify', art: 'renew', tone: 'warn', title: 'Your college verification has ended',
        body: 'Re-verify to keep your blue badge and everything it unlocks.', action: 'Re-verify', onPress: verify, days: 1 });
    }
    if (!status.limited) {
      if (status.owesRealPerson && days !== null && days <= 4) {
        candidates.push({ key: `deck-selfie-pause-${days}`, art: 'deadline', tone: 'warn', title: `Your profile pauses in ${inDays}`,
          body: 'Complete your selfie check to stay visible to everyone.', action: 'Start selfie check', onPress: selfie, days: 1 });
      }
    } else {
      if (days !== null && days <= 4) {
        candidates.push({ key: `deck-pause-${days}`, art: 'deadline', tone: 'warn', title: `Your profile pauses in ${inDays}`,
          body: 'Verify your college to stay visible. It takes a minute.', action: 'Verify my college', onPress: verify, days: 1 });
      }
      if (status.likesLeft !== null && status.likesLeft > 0 && status.likesLeft <= 5) {
        candidates.push({ key: 'deck-likes-low', art: 'likes', tone: 'neutral',
          title: `${status.likesLeft} ${status.likesLeft === 1 ? 'like' : 'likes'} left today`,
          body: 'Verify your college for unlimited likes. It takes a minute, and verified profiles get more matches.',
          action: 'Verify now', onPress: verify, days: 1 });
      }
      if (swipeNudge) {
        candidates.push({ key: 'deck-swipes', art: 'badge', tone: 'neutral', title: 'Get your blue badge',
          body: 'Verifying your college is step 1. Verified profiles are trusted more, and get more matches.',
          action: 'Verify now', onPress: verify, days: 1 });
      }
    }
  }

  // Which of them were put away: unknown counts as away, so nothing flashes up.
  const keys = candidates.map((prompt) => prompt.key).join('|');
  const [away, setAway] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!keys) return;
    let live = true;
    void Promise.all(keys.split('|').map(async (key) => [key, preview ? false : await isNudgeDismissed(key)] as const))
      .then((entries) => { if (live) setAway((current) => ({ ...current, ...Object.fromEntries(entries) })); });
    return () => { live = false; };
  }, [keys, preview]);
  const prompt = cardShown ? null : candidates.find((entry) => away[entry.key] === false) ?? null;
  const keepBrowsing = () => {
    if (!prompt) return;
    setAway((current) => ({ ...current, [prompt.key]: true }));
    if (!preview) void dismissNudge(prompt.key, prompt.days);
  };
  return { prompt, keepBrowsing };
}

/** A verify reminder in the deck's place: art, what it is, one button, and "Keep browsing". */
export function DeckPromptCard({ prompt, onKeepBrowsing }: { prompt: DeckPrompt; onKeepBrowsing: () => void }) {
  const [height, setHeight] = useState(0);
  const art = Math.round(Math.max(96, Math.min(200, height - 300)));
  const warn = prompt.tone === 'warn';
  return <View style={card.root} onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
    {height ? <ReminderArt name={prompt.art} size={art} motion="lively" glow={warn ? '#F0C17A' : '#8FB7FF'} /> : <View style={{ height: 96 }} />}
    <Text accessibilityRole="header" style={card.title}>{prompt.title}</Text>
    <Text style={card.body}>{prompt.body}</Text>
    <View style={card.actions}>
      <Pressable accessibilityRole="button" onPress={prompt.onPress} style={({ pressed }) => [card.primary, pressed && card.pressed]}>
        <Text style={card.primaryText}>{prompt.action}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onKeepBrowsing} style={({ pressed }) => [card.secondary, pressed && card.pressed]}>
        <Text style={card.secondaryText}>Keep browsing</Text>
      </Pressable>
    </View>
  </View>;
}

/** The reminder previews (development/ReminderPreview.tsx): the card the deck would show now. */
export function DeckVerifyPrompt(props: { swipes: number; topCardUnverified?: boolean }) {
  const { prompt, keepBrowsing } = useDeckPrompt(props);
  return prompt ? <DeckPromptCard prompt={prompt} onKeepBrowsing={keepBrowsing} /> : null;
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
