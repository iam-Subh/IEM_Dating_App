import * as Notifications from 'expo-notifications';

/**
 * Notification buttons (NOTIFICATIONS_PLAN.md 8). A push names its set by
 * `categoryId` (the server's BUTTONS_OF_KIND). Buttons that don't open the
 * app are handled in the background task (backgroundTask.ts) - or by the
 * response listener when the app is running.
 */
export const BUTTON_SETS: Record<string, Notifications.NotificationAction[]> = {
  message: [
    {
      identifier: 'reply', buttonTitle: 'Reply',
      textInput: { submitButtonTitle: 'Send', placeholder: 'Write a reply…' },
      options: { opensAppToForeground: false },
    },
    { identifier: 'read', buttonTitle: 'Mark as read', options: { opensAppToForeground: false } },
  ],
  match: [{ identifier: 'say_hi', buttonTitle: 'Say hi', options: { opensAppToForeground: true } }],
  like: [{ identifier: 'see_who', buttonTitle: 'See who', options: { opensAppToForeground: true } }],
  follow_request: [
    { identifier: 'accept', buttonTitle: 'Accept', options: { opensAppToForeground: false } },
    { identifier: 'decline', buttonTitle: 'Decline', options: { opensAppToForeground: false, isDestructive: true } },
  ],
  story_mention: [{ identifier: 'view', buttonTitle: 'View', options: { opensAppToForeground: true } }],
  story_failed: [{ identifier: 'retry', buttonTitle: 'Try again', options: { opensAppToForeground: true } }],
  verify: [{ identifier: 'verify_now', buttonTitle: 'Verify now', options: { opensAppToForeground: true } }],
  selfie_verified: [{ identifier: 'view_profile', buttonTitle: 'View profile', options: { opensAppToForeground: true } }],
  signin: [
    { identifier: 'mine', buttonTitle: 'It was me', options: { opensAppToForeground: false } },
    { identifier: 'not_me', buttonTitle: 'Not me', options: { opensAppToForeground: true, isDestructive: true } },
  ],
};

/** Buttons handled without opening the app. */
export const BACKGROUND_ACTIONS = new Set(['reply', 'read', 'accept', 'decline', 'mine']);

export async function setUpButtons() {
  await Promise.all(Object.entries(BUTTON_SETS).map(([id, actions]) =>
    Notifications.setNotificationCategoryAsync(id, actions).catch(() => undefined)));
}
