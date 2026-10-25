import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Chat notifications drawn natively (apps/mobile/src/features/notifications/MESSAGE_NOTIFICATIONS_PLAN.md).
 * Null on iPhone and on builds made before this module: the app then tells
 * the server it can't draw chats, and gets today's ready-made notifications.
 */
type Subscription = { remove(): void };
type ChatNotifyNative = {
  setSession(apiBase: string, token: string, userId: string): void;
  clearSession(): void;
  pushKey(): string;
  setAppState(foreground: boolean, activeMatchId: string | null, bannersEnabled: boolean): void;
  clearChat(matchId: string, removeShortcut: boolean): void;
  reportChat(matchId: string, name: string, avatarUrl: string | null): void;
  takeShare(): SharedContent | null;
  startProximity(): boolean;
  stopProximity(): void;
  playEarpiece(uri: string, positionMs: number, rate: number): void;
  stopEarpiece(): number;
  addListener(event: 'onShare' | 'onEarpieceEnded', listener: () => void): Subscription;
  addListener(event: 'onProximity', listener: (event: { near: boolean }) => void): Subscription;
};

/** Text or a picture shared from another app; `matchId` when shared straight to a chat. */
export type SharedContent = { matchId?: string | null; text?: string | null; file?: string | null; mimeType?: string | null };

const native: ChatNotifyNative | null = Platform.OS === 'android'
  ? requireOptionalNativeModule('ChatNotify') as ChatNotifyNative | null
  : null;

export const drawsChatNotifications = native !== null;

export function setChatNotifySession(apiBase: string, token: string, userId: string) {
  native?.setSession(apiBase, token, userId);
}

export function clearChatNotifySession() {
  native?.clearSession();
}

/** This phone's key for encrypted chat pushes (section 11); null without the native module. */
export function chatPushKey(): string | null {
  try { return native?.pushKey() ?? null; } catch { return null; }
}

export function setChatNotifyAppState(foreground: boolean, activeMatchId: string | null, bannersEnabled: boolean) {
  native?.setAppState(foreground, activeMatchId, bannersEnabled);
}

export function clearChatNotification(matchId: string, removeShortcut = false) {
  native?.clearChat(matchId, removeShortcut);
}

/** A chat opened in the app: its shortcut for the Conversations section and the share sheet (section 12). */
export function reportChatShortcut(matchId: string, name: string, avatarUrl: string | null) {
  native?.reportChat(matchId, name, avatarUrl);
}

/** What another app shared into this one, once; then `onShared` for shares while the app is open. */
export function takeSharedContent(): SharedContent | null {
  try { return native?.takeShare() ?? null; } catch { return null; }
}

export function onShared(listener: () => void): Subscription | null {
  return native?.addListener('onShare', listener) ?? null;
}

// --- Raise to ear (section 7) ---

export const canRaiseToEar = native !== null;

export function startProximity(onChange: (near: boolean) => void): Subscription | null {
  if (!native) return null;
  const subscription = native.addListener('onProximity', ({ near }) => onChange(near));
  if (!native.startProximity()) {
    subscription.remove();
    return null;
  }
  return { remove: () => { subscription.remove(); native.stopProximity(); } };
}

export function playThroughEarpiece(uri: string, positionMs: number, rate: number, onEnded: () => void): Subscription | null {
  if (!native) return null;
  const subscription = native.addListener('onEarpieceEnded', onEnded);
  native.playEarpiece(uri, positionMs, rate);
  return subscription;
}

/** Stops the earpiece; the position in ms, for the speaker to continue from. */
export function stopEarpiece(): number {
  return native?.stopEarpiece() ?? 0;
}
