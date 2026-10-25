import { AppState, type AppStateStatus } from 'react-native';
import type { Socket } from 'socket.io-client';

/**
 * Keeps "Active now" honest: while the app is on screen it pings every two
 * minutes, and it says so the moment it goes to the background, so a phone in
 * a pocket with the connection still open doesn't read as online.
 */

const HEARTBEAT_MS = 2 * 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let subscription: { remove: () => void } | null = null;
let connectHandler: (() => void) | null = null;
let current: Socket | null = null;

const beat = () => current?.emit('presence_heartbeat');

function onAppState(state: AppStateStatus) {
  if (state === 'active') {
    beat();
    if (!timer) timer = setInterval(beat, HEARTBEAT_MS);
  } else if (state === 'background') {
    if (timer) { clearInterval(timer); timer = null; }
    current?.emit('presence_background');
  }
}

/** Call after the socket is created; safe to call again. */
export function startPresenceHeartbeat(socket: Socket) {
  stopPresenceHeartbeat();
  current = socket;
  subscription = AppState.addEventListener('change', onAppState);
  // A reconnect is a fresh connection: tell the server where the app is.
  connectHandler = () => onAppState(AppState.currentState);
  socket.on('connect', connectHandler);
  onAppState(AppState.currentState);
}

export function stopPresenceHeartbeat() {
  subscription?.remove();
  subscription = null;
  if (timer) { clearInterval(timer); timer = null; }
  if (connectHandler) current?.off('connect', connectHandler);
  connectHandler = null;
  current = null;
}
