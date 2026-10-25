import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { getSocket, onSocketChange } from './socket';

/** The current socket, following sign-in and sign-out. */
export function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(getSocket);
  useEffect(() => {
    setSocket(getSocket());
    return onSocketChange(setSocket);
  }, []);
  return socket;
}

/**
 * How every screen listens to the server (one pattern for the whole app):
 *
 * - on whichever socket is current, so a screen that opened before the
 *   connection existed, or outlived a sign-in, still hears;
 * - `onReconnect`: after every reconnect, so what was sent while the phone
 *   was offline or the app asleep is caught up by re-reading. `true` runs the
 *   handler with no data; a function runs that instead.
 */
export function useSocketEvent<T = any>(
  events: string | string[],
  handler: (data?: T) => void,
  { enabled = true, onReconnect = false }: { enabled?: boolean; onReconnect?: boolean | (() => void) } = {},
) {
  const socket = useSocket();
  const ref = useRef(handler);
  ref.current = handler;
  const reconnectRef = useRef(onReconnect);
  reconnectRef.current = onReconnect;
  const key = Array.isArray(events) ? events.join('|') : events;
  useEffect(() => {
    if (!enabled || !socket) return;
    const names = key.split('|');
    const listener = (data?: T) => ref.current(data);
    names.forEach((name) => socket.on(name, listener));
    // `connect` fires on the first connection too; a reconnect is any after it.
    let connectedOnce = socket.connected;
    const reconnected = () => {
      const action = reconnectRef.current;
      if (connectedOnce && action) (typeof action === 'function' ? action : () => ref.current())();
      connectedOnce = true;
    };
    socket.on('connect', reconnected);
    return () => {
      names.forEach((name) => socket.off(name, listener));
      socket.off('connect', reconnected);
    };
  }, [socket, key, enabled]);
}
