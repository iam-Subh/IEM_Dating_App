import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';
import type { NotificationItem } from './notificationModel';

export type SystemNoticeAction = 'explore' | 'profile' | 'edit_profile' | 'sessions' | 'verification' | 'selfie';
type Tone = 'warm' | 'success' | 'attention' | 'security' | 'update' | 'neutral';
type Notice = {
  title: string;
  body: string;
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  tone: Tone;
  layout: 'welcome' | 'attention' | 'standard';
  action: { label: string; destination: SystemNoticeAction } | null;
};

export const SYSTEM_NOTICE_TONES = {
  warm: { accent: '#F2CD99', icon: '#493522', surface: '#2B231C' },
  success: { accent: '#A8DCC0', icon: '#253A30', surface: '#1C2822' },
  attention: { accent: '#EDC885', icon: '#413322', surface: '#29231B' },
  security: { accent: '#FFB5A6', icon: '#4B302A', surface: '#2B201D' },
  update: { accent: '#D5C1F2', icon: '#393045', surface: '#25212C' },
  neutral: { accent: '#DFC7D0', icon: '#3B3035', surface: '#242022' },
} as const;

export function isSystemNotice(item: NotificationItem) {
  return item.category === 'account' && !item.actor;
}

/** Rewrite known templates only. Keep review notes and unknown messages intact. */
export function systemNoticeOf(item: NotificationItem): Notice {
  const title = item.title.trim();
  const body = item.body.trim();
  const notice: Notice = {
    title: title || 'Account update', body, label: 'Account update', icon: 'information-circle',
    tone: 'neutral', layout: 'standard', action: null,
  };
  if (item.type === 'team') return { ...notice, label: 'App update', icon: 'megaphone', tone: 'update' };
  if (/^Welcome to IEM Connect[!.]?$/i.test(title)) return {
    ...notice, title: 'Welcome to IEM Connect 👋', label: 'Getting started', icon: 'hand-left', tone: 'warm', layout: 'welcome',
    body: !body || /^Your college email is verified\.?$/i.test(body)
      ? 'Meet people from your college. Start by exploring profiles.' : body,
    action: { label: 'Open Explore', destination: 'explore' },
  };
  const signIn = /^New sign-in on (.+)$/i.exec(title);
  if (signIn) return {
    ...notice, title: 'New sign-in', label: 'Account security', icon: 'shield-half', tone: 'security', layout: 'attention',
    body: `Your account was used to sign in on ${signIn[1]}. ${body === 'Not you? Tap to secure your account.'
      ? 'Review your devices if this was not you.' : body}`.trim(),
    action: { label: 'Review devices', destination: 'sessions' },
  };
  if (/^Your profile pauses in \d+ days?$/i.test(title)) return {
    ...notice, label: 'Verification reminder', icon: 'time', tone: 'attention', layout: 'attention',
    body: body === 'Open the app to finish verifying and stay visible. It takes a minute.'
      ? 'Finish verification to keep your profile visible.' : body,
    action: { label: 'Finish verification', destination: 'verification' },
  };
  if (title === 'Your profile is paused') return {
    ...notice, label: 'Profile visibility', icon: 'eye-off', tone: 'attention', layout: 'attention',
    body: body === "Others can't see you right now. Open the app to finish verifying and it unpauses at once - your matches and chats are still here."
      ? 'Your profile is hidden until you finish verification. Your existing matches and chats are still available.' : body,
    action: { label: 'Finish verification', destination: 'verification' },
  };
  if (/^Your college verification ends in \d+ days?$/i.test(title)) return {
    ...notice, label: 'College verification', icon: 'school', tone: 'attention',
    body: body === 'Re-verify with your college email to keep your blue badge.'
      ? 'Verify your college email again to renew your verification.' : body,
    action: { label: 'Verify college email', destination: 'verification' },
  };
  if (title === 'Selfie check complete' || title === 'Selfie check completed' || title === "You're verified as a real person ✓") return {
    ...notice, title: 'Selfie check complete', label: 'Selfie check', icon: 'scan', tone: 'success',
    body: body === 'Thanks - your photos match your selfie.' || body === 'Your selfie matched your profile photos.'
      ? 'Your profile photos match your selfie.' : body,
    action: { label: 'View your profile', destination: 'profile' },
  };
  if (title === 'Your video needs a look' || title === 'One of your photos needs a look') return {
    ...notice, title: title === 'Your video needs a look' ? 'Review your profile video' : 'Review your profile photos',
    label: 'Profile media', icon: title === 'Your video needs a look' ? 'videocam' : 'images', tone: 'attention', layout: 'attention',
    body: body === "It doesn't seem to show you. Replace or remove it to keep your real-person check."
      ? 'A photo or video could not be matched to your selfie. Replace or remove it to keep your real-person check.' : body,
    action: { label: 'Edit photos and video', destination: 'edit_profile' },
  };
  if (title === 'Please take a new selfie' || title === "We couldn't verify you") return {
    ...notice, title: title === 'Please take a new selfie' ? 'Retake your selfie' : 'Selfie check not completed',
    label: 'Verification', icon: 'scan', tone: 'attention', layout: 'attention',
    body: body === 'Make sure your main photo shows your face, then try again.'
      ? 'Make sure your main profile photo shows your face, then try again.' : body,
    action: { label: 'Open selfie check', destination: 'selfie' },
  };
  if (title === 'Your birthday was updated') return {
    ...notice, title: 'Birthday updated', label: 'Profile update', icon: 'calendar', tone: 'success',
    body: body === 'Thanks - your profile shows the new date.' ? 'Your profile now shows the new date of birth.' : body,
    action: { label: 'View your profile', destination: 'profile' },
  };
  if (title === "We couldn't change your birthday") return {
    ...notice, title: 'Birthday change not approved', label: 'Profile update', icon: 'calendar', tone: 'attention',
    body: body === "The ID didn't match the new date. Write to support if you think this is a mistake."
      ? 'The date on your ID did not match your request. Contact support if this is incorrect.' : body,
  };
  if (title === 'Thanks - we acted on your report' || title === 'We reviewed your report') return {
    ...notice, title: title === 'Thanks - we acted on your report' ? 'Action taken on your report' : title,
    label: 'Safety update', icon: 'shield-checkmark', tone: 'success',
    body: body === 'Thanks for helping keep IEM Connect safe.'
      ? title === 'Thanks - we acted on your report'
        ? 'We took action after reviewing your report. Thank you for helping keep IEM Connect safe.'
        : 'Our team reviewed your report. Thank you for helping keep IEM Connect safe.'
      : body,
  };
  return notice;
}
