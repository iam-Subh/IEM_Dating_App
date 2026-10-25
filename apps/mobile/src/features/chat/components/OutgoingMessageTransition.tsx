import React, { useCallback, useRef } from 'react';
import type { LayoutChangeEvent, View } from 'react-native';
import Animated, { Easing, measure, runOnUI, useAnimatedRef, useAnimatedStyle, useReducedMotion, useSharedValue, type SharedValue } from 'react-native-reanimated';
import {
  INPUT_TO_BUBBLE_TEXT, riseOffset, riseProgress, TELEGRAM_EASE_OUT, TELEGRAM_EASE_OUT_QUINT, TELEGRAM_Y_CURVE,
  type ChatSendMotion, type Rise,
} from '../chatSendMotion';

const yCurve = Easing.bezierFn(...TELEGRAM_Y_CURVE);
const easeOut = Easing.bezierFn(...TELEGRAM_EASE_OUT);
const easeOutQuint = Easing.bezierFn(...TELEGRAM_EASE_OUT_QUINT);

/** The rows' shared send motion: each send's lift, and the clock they run on. */
export type RiseClock = { rises: SharedValue<Rise[]>; now: SharedValue<number> };

/**
 * A message sent from this screen: the real row rises into place from the
 * type box, as Telegram's does - on the list curve, from the box's text size -
 * in the same frames the rows above lift by its height. No copy is drawn, so
 * rapid sends each move on their own and cannot collide.
 */
export function OutgoingMessageTransition({ id, motion, clock, children }: {
  id: string;
  motion: ChatSendMotion;
  clock: RiseClock;
  children: React.ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  const ref = useAnimatedRef<View>();
  // Hidden for the frame before its start is known, so it never blinks at its end place.
  const shown = useSharedValue(!motion.has(id) || reducedMotion);
  const fromY = useSharedValue(0);
  const fromScale = useSharedValue(1);
  const started = useRef(false);
  const onLayout = useCallback((event?: LayoutChangeEvent) => {
    if (started.current) return;
    started.current = true;
    const origin = motion.take(id);
    const height = event?.nativeEvent?.layout?.height;
    if (!origin || reducedMotion || !height) { shown.value = true; return; }
    // Where it rises from: the type box's bottom (typed), or the Send button.
    const field = origin.field?.rect ?? null;
    const startBottom = field ? field.y + field.height : origin.y + 22;
    const typed = Boolean(field && origin.text?.trim());
    motion.rise(id, height);
    runOnUI(() => {
      'worklet';
      const target = measure(ref);
      if (target) {
        fromY.value = Math.max(0, startBottom - (target.pageY + target.height));
        fromScale.value = typed ? INPUT_TO_BUBBLE_TEXT : 1;
      }
      shown.value = true;
    })();
  }, [fromScale, fromY, id, motion, reducedMotion, ref, shown]);
  const style = useAnimatedStyle(() => {
    const now = clock.now.value;
    const own = clock.rises.value.find(rise => rise.id === id);
    const p = own ? riseProgress(own, now, (x: number) => x) : 1;
    const pY = yCurve(p);
    const pX = easeOut(easeOutQuint(p));
    return {
      opacity: shown.value ? 1 : 0,
      transformOrigin: 'right bottom',
      transform: [
        { translateY: fromY.value * (1 - pY) },
        { scale: pX + fromScale.value * (1 - pX) },
      ],
    };
  });
  return <Animated.View ref={ref} collapsable={false} onLayout={onLayout} style={style}>{children}</Animated.View>;
}

/**
 * Every list row: while sends land below it, it is drawn back down by what is
 * left of their lifts (riseOffset), so it glides up with them instead of
 * jumping when the list makes room.
 */
export function RisingRow({ clock, selfId, children }: { clock: RiseClock; selfId: string | null; children: React.ReactNode }) {
  // Lifts from before this row appeared moved others, not it.
  const mountedAt = useRef(Date.now()).current;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: riseOffset(clock.rises.value, clock.now.value, selfId, mountedAt, yCurve) }],
  }), [selfId]);
  return <Animated.View style={style}>{children}</Animated.View>;
}
