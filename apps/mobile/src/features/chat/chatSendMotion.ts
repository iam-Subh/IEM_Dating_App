
export type FieldRect = { x: number; y: number; width: number; height: number };
/**
 * Where the send came from. `field` is the input box, filled in by an async
 * measure after the tap (`rect` is null until then); `text` what was typed.
 * With both, the sent bubble rises from the type box, as Telegram's does.
 */
export type SendOrigin = { x: number; y: number; capturedAt: number; field?: { rect: FieldRect | null }; text?: string };

/** Only sends made on this screen can animate. History and retries cannot. */
export function createChatSendMotion() {
  let origin: SendOrigin | null = null;
  const pending = new Map<string, SendOrigin>();
  const riseListeners = new Set<(id: string, height: number) => void>();
  return {
    /**
     * A sent row took its place at the newest end: it rises from the type box
     * and the rows above lift by its height (Telegram's list animator).
     */
    onRise(listener: (id: string, height: number) => void) { riseListeners.add(listener); return () => { riseListeners.delete(listener); }; },
    rise(id: string, height: number) { for (const listener of riseListeners) listener(id, height); },
    setOrigin(next: SendOrigin) { origin = next; },
    register(id: string, now = Date.now()) {
      for (const [key, value] of pending) {
        if (now - value.capturedAt > 1500) pending.delete(key);
      }
      if (origin && now - origin.capturedAt < 1000) pending.set(id, { ...origin, capturedAt: now });
      origin = null;
    },
    has(id: string, now = Date.now()) {
      const value = pending.get(id);
      return Boolean(value && now - value.capturedAt < 1500);
    },
    take(id: string, now = Date.now()) {
      const value = pending.get(id);
      pending.delete(id);
      return value && now - value.capturedAt < 1500 ? value : null;
    },
  };
}

export type ChatSendMotion = ReturnType<typeof createChatSendMotion>;


// Telegram for Android's send transition (TextMessageEnterTransition and
// ChatListItemAnimator): 250 ms. Vertical motion on the list animator's curve;
// horizontal motion and the text's scale on EASE_OUT over EASE_OUT_QUINT; the
// bubble and the text's new colour fade in over the first 40%.
export const TELEGRAM_SEND_MS = 250;
export const TELEGRAM_Y_CURVE = [0.19919472913616398, 0.010644531250000006, 0.27920937042459737, 0.91025390625] as const;
export const TELEGRAM_EASE_OUT = [0, 0, 0.58, 1] as const;
export const TELEGRAM_EASE_OUT_QUINT = [0.23, 1, 0.32, 1] as const;
/** The input's text size over the bubble's (VoiceRecordBar 17, MessageBubble 16). */
export const INPUT_TO_BUBBLE_TEXT = 17 / 16;


/** One send's lift: the rows above it rise by `height`, starting at `t0` (Date.now ms). */
export type Rise = { id: string; height: number; t0: number };

/** How far through a lift the Y motion is (Telegram's list curve), 0..1. */
export function riseProgress(rise: Rise, now: number, yCurve: (x: number) => number) {
  'worklet';
  const t = Math.min(1, Math.max(0, (now - rise.t0) / TELEGRAM_SEND_MS));
  return yCurve(t);
}

/**
 * Where a row is drawn while sends land below it: back down by what is left
 * of every lift that started after it appeared, except its own. The lifts add
 * up, so rapid sends never reset one another; each ends on the same curve.
 */
export function riseOffset(rises: readonly Rise[], now: number, selfId: string | null, mountedAt: number, yCurve: (x: number) => number) {
  'worklet';
  let offset = 0;
  for (const rise of rises) {
    if (rise.id === selfId || rise.t0 < mountedAt) continue;
    offset += rise.height * (1 - riseProgress(rise, now, yCurve));
  }
  return offset;
}
