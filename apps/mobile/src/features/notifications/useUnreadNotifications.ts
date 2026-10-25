import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { api } from "../../services/api";
import type { Socket } from "socket.io-client";
import { getSocket, onSocketChange } from "../../services/socket";
import { NO_UNREAD, type Unread } from "./notificationModel";

/**
 * The unread notification count, one for the whole app: the bell on the deck
 * and the notification centre read the same number, and both move the moment
 * the server says something changed (`notifications_changed`).
 */
let shared: Unread = NO_UNREAD;
const listeners = new Set<(value: Unread) => void>();
let inFlight: Promise<void> | null = null;
let session = 0;

function publish(next: Unread) {
  shared = next;
  for (const listener of listeners) listener(next);
}

export function refreshUnread(): Promise<void> {
  const started = session;
  inFlight ??= api
    .get("/notifications/unread")
    .then((response) => {
      if (started === session) publish({ ...NO_UNREAD, ...(response.data.data ?? {}) });
    })
    .catch(() => undefined)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Optimistic: marked read on this phone before the server has answered. */
export function setUnread(update: (current: Unread) => Unread) {
  publish(update(shared));
}

/** On logout: the next account never sees this one's count. */
export function resetUnread() {
  session += 1;
  inFlight = null;
  publish(NO_UNREAD);
}

let socketBound: Socket | null = null;
let liveTimer: ReturnType<typeof setTimeout> | null = null;
const changed = () => {
  if (liveTimer) clearTimeout(liveTimer);
  liveTimer = setTimeout(() => void refreshUnread(), 200);
};
/** On the current socket; a reconnect re-reads too, for anything missed meanwhile. */
function bindSocket(socket: Socket | null = getSocket()) {
  if (socketBound === socket) return;
  socketBound?.off("notifications_changed", changed);
  socketBound?.off("connect", changed);
  socketBound = socket;
  socket?.on("notifications_changed", changed);
  socket?.on("connect", changed);
}
onSocketChange((socket) => bindSocket(socket));

export function useUnreadNotifications() {
  const [unread, setLocal] = useState<Unread>(shared);
  useEffect(() => {
    listeners.add(setLocal);
    setLocal(shared);
    bindSocket();
    void refreshUnread();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        bindSocket();
        void refreshUnread();
      }
    });
    return () => {
      listeners.delete(setLocal);
      subscription.remove();
    };
  }, []);
  const refresh = useCallback(() => refreshUnread(), []);
  return { unread, refresh };
}
