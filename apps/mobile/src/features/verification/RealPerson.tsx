import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Svg, {Circle, Path} from 'react-native-svg';
import { api } from '../../services/api';
import { refreshVerificationStatus, useVerificationStatus } from './useVerificationStatus';
import { BadgeSteps, ReminderBanner, ReminderRow, reminderColors } from './ReminderParts';
import { ArtRing, ReminderArt } from './ReminderArt';
import { useVerificationPreview } from './VerificationPreviewContext';
import { useSocketEvent } from '../../services/useSocketEvent';

/**
 * The real-person check in the person's own screens
 * (features/verification/PHOTO_VERIFICATION_PLAN.md 6). The incomplete-check
 * shortcut and check result appear only on the account owner's screens.
 */

export type FaceStatus = {
  status: 'none' | 'verified' | 'needs_fix' | 'pending_review' | 'failed' | 'removed';
  reason: string | null;
  required: boolean;
  attemptsLeft: number;
  media: { url: string; kind: 'photo' | 'video'; status: 'unsure' | 'mismatch' | 'no_face' }[];
};

export function useFaceStatus() {
  const preview = useVerificationPreview();
  const [face, setFace] = useState<FaceStatus | null>(null);
  const load = useCallback(async () => {
    if (preview) return;
    try { setFace((await api.get('/verification/face')).data.data); } catch { /* offline: show nothing */ }
  }, [preview]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  // A team decision or a finished check shows at once, without leaving the screen.
  useSocketEvent('verification_changed', () => { void load(); }, { enabled: !preview, onReconnect: true });
  return { face: preview?.face ?? face, reload: load };
}

/**
 * The grey badge on the owner's photo until the blue badge is earned
 * (college email and selfie check). Only they see it; a tap opens the step
 * still missing, the college email first.
 */
export function RealPersonProfileBadge() {
  const navigation = useNavigation<any>();
  const status = useVerificationStatus();
  if (!status || (status.verified && status.realPersonVerified)) return null;
  const college = !status.verified;
  return <Pressable accessibilityRole="button"
    accessibilityLabel={college ? 'Get your blue badge: verify your college email' : 'Get your blue badge: complete your selfie check'}
    accessibilityHint={college ? 'Opens college verification.' : 'Opens the selfie check.'}
    onPress={() => navigation.navigate(college ? 'VerifyCollege' : 'RealPersonCheck')} hitSlop={8}
    style={({pressed}) => [styles.profileBadge, pressed && {opacity: 0.7}]}>
    <Svg width={28} height={28} viewBox="0 0 28 28" accessible={false}>
      <Path fill="#8C8983" d="M23 12l-2.44-2.79.34-3.69-3.61-.82L15.4 1.5 12 2.96 8.6 1.5 6.71 4.69 3.1 5.5l.34 3.7L1 12l2.44 2.79-.34 3.7 3.61.82L8.6 22.5l3.4-1.47 3.4 1.46 1.89-3.19 3.61-.82-.34-3.69L23 12Z"/>
      <Path d="m7.4 12.1 3.1 3.1 6.3-6.3" fill="none" stroke="#F2EFE9" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
      <Circle cx={20.5} cy={20.5} r={5.5} fill="#100F0D"/>
      <Path d="M20.5 17.5v6M17.5 20.5h6" fill="none" stroke="#D9D5CE" strokeWidth={1.7} strokeLinecap="round"/>
    </Svg>
  </Pressable>;
}

/**
 * Profile tab: the blue badge in one row - both steps, what is next, any
 * deadline - until both are done (REMINDER_DESIGN.md, pattern A). A tap
 * opens the next step, the college email first.
 */
export function BlueBadgeRow({ flush = false }: { flush?: boolean }) {
  const navigation = useNavigation<any>();
  const status = useVerificationStatus();
  const { face } = useFaceStatus();
  if (!status) return null;
  const college = status.verified;
  const selfie = face ? face.status === 'verified' : status.realPersonVerified;
  if (college && selfie && !status.expired) return null;
  if (status.expired) {
    return <ReminderRow tone="warn" leading={<ReminderArt name="renew" size={42} />}
      flush={flush} title="Renew your college verification" subtitle="Your blue badge is off until you re-verify." value="Re-verify"
      onPress={() => navigation.navigate('VerifyCollege')} />;
  }
  if (face?.status === 'needs_fix') {
    return <ReminderRow tone="danger" leading={<ReminderArt name="correction" size={42} />}
      flush={flush} title="Fix your profile media" subtitle="A photo or video doesn't match your selfie." value="Review"
      onPress={() => navigation.navigate('EditProfile')} />;
  }
  const days = status.graceDaysLeft;
  const soon = days !== null && days <= 4;
  const due = (what: string) => `${what} due in ${days} ${days === 1 ? 'day' : 'days'}`;
  const steps = [
    { label: 'College email', done: college, ...(!college && soon && status.limited ? { note: due('College email'), tone: 'warn' as const } : {}) },
    { label: 'Selfie check', done: selfie,
      ...(face?.status === 'pending_review' ? { note: 'Selfie in review', tone: 'warn' as const }
        : !selfie && soon && status.owesRealPerson ? { note: due('Selfie'), tone: 'warn' as const } : {}) },
  ];
  const done = steps.filter((step) => step.done).length;
  return <ReminderRow flush={flush} tone={status.paused ? 'danger' : 'neutral'}
    leading={<ArtRing name={status.paused ? 'paused' : 'badge'} progress={done / 2} color={status.paused ? reminderColors.danger : BADGE_BLUE} />}
    title={status.paused ? 'Your profile is paused' : 'Get your blue badge'}
    subtitle={<BadgeSteps steps={steps} />} value={`${done} of 2`}
    onPress={() => navigation.navigate(college ? 'RealPersonCheck' : 'VerifyCollege')} />;
}

const BADGE_BLUE = '#7DB3FF';

/** Edit profile: each photo that is not them, by its address - marked on its tile. */
export function useFaceMediaIssues() {
  const { face } = useFaceStatus();
  return useMemo(() => {
    const issues: Record<string, FaceStatus['media'][number]['status']> = {};
    face?.media.forEach((item) => { if (item.kind === 'photo') issues[item.url] = item.status; });
    return issues;
  }, [face]);
}

/** Edit profile, over the photos: one line saying what is marked, and the video's own problem. */
export function FaceMediaNote() {
  const { face } = useFaceStatus();
  if (!face?.media.length) return null;
  const photos = face.media.filter((item) => item.kind === 'photo' && item.status !== 'unsure');
  const video = face.media.find((item) => item.kind === 'video' && item.status !== 'unsure');
  const reviewing = face.media.every((item) => item.status === 'unsure');
  if (reviewing) {
    return <ReminderBanner flush icon="time-outline" tone="warn" action="" style={[styles.mediaNote, styles.mediaReviewNote]}
      text="Our team is checking a photo. You can keep using the app." />;
  }
  const lines = [
    photos.length ? `${photos.length === 1 ? '1 photo needs' : `${photos.length} photos need`} replacing - marked below.` : '',
    video ? (video.status === 'no_face' ? 'Show your face in your video.' : "Your video doesn't seem to show you.") : '',
  ].filter(Boolean);
  return <ReminderBanner flush art="correction" tone="danger" action="" style={styles.mediaNote} text={lines.join(' ')} />;
}

/** Settings > Account: status, start, and remove (PHOTO_VERIFICATION_PLAN.md 11). */
export function useRealPersonActions(reload: () => void) {
  const navigation = useNavigation<any>();
  return {
    start: () => navigation.navigate('RealPersonCheck'),
    remove: async () => {
      await api.delete('/verification/face');
      await Promise.all([reload(), refreshVerificationStatus()]);
    },
  };
}

const styles = StyleSheet.create({
  profileBadge: {width: 28, height: 28, alignItems: 'center', justifyContent: 'center', flexShrink: 0},
  mediaNote: { marginTop: 4, marginBottom: 14 },
  mediaReviewNote: { backgroundColor: '#3A342A' },
});
