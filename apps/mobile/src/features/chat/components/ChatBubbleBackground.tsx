import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

interface Props {
  outgoing: boolean;
  groupPosition: 'single' | 'top' | 'middle' | 'bottom';
  color: string;
}

/**
 * The bubble body is a plain View and only the tail is drawn.
 *
 * It used to be a single SVG path sized from a measured width and height. That
 * meant the background lagged one frame behind every resize - expanding or
 * collapsing a long message, an edit, a late reply quote - and painted at the
 * old size for that frame. Clipping the overspill only traded the problem for
 * square corners while the clip was active.
 *
 * A View sized by layout has no such frame: it resizes in the same commit as
 * the text, and its corners are rounded by the platform, which is smoother than
 * a hand-written arc. The tail is the one part that cannot be expressed as a
 * border radius, so it stays an SVG - but at a fixed size in its own box, so it
 * never rescales and never needs measuring.
 */
const CORNER = 20;
/** Corner where a bubble joins the one above it in a group. */
const JOINED_CORNER = 6;
const TAIL_WIDTH = 6;
const TAIL_HEIGHT = 11;

// Telegram's terminal edge: an inward elliptical arc from the bottom corner out
// to the tip, then back along the baseline. Its left edge is straight and sits
// flush against the body's square corner, so the two meet without a seam.
const TAIL_PATH = 'M 0 0 A 6.5 10 0 0 0 5.708 9.925 L 5.4 11 H 0 Z';

export const ChatBubbleBackground = React.memo(({ outgoing, groupPosition, color }: Props) => {
  const joinedAbove = groupPosition === 'middle' || groupPosition === 'bottom';
  const hasTail = groupPosition === 'single' || groupPosition === 'bottom';

  // The tail side is squared off so the tail can continue from it.
  const tailSideBottom = hasTail ? 0 : JOINED_CORNER;
  const tailSideTop = joinedAbove ? JOINED_CORNER : CORNER;

  const radii = outgoing
    ? {
        borderTopLeftRadius: CORNER,
        borderTopRightRadius: tailSideTop,
        borderBottomLeftRadius: CORNER,
        borderBottomRightRadius: tailSideBottom,
      }
    : {
        borderTopRightRadius: CORNER,
        borderTopLeftRadius: tailSideTop,
        borderBottomRightRadius: CORNER,
        borderBottomLeftRadius: tailSideBottom,
      };

  return (
    <>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: color }, radii]} />
      {hasTail && (
        <Svg
          pointerEvents="none"
          width={TAIL_WIDTH}
          height={TAIL_HEIGHT}
          style={[styles.tail, outgoing ? { right: -TAIL_WIDTH } : { left: -TAIL_WIDTH }]}
        >
          <Path
            d={TAIL_PATH}
            fill={color}
            transform={outgoing ? undefined : `translate(${TAIL_WIDTH} 0) scale(-1 1)`}
          />
        </Svg>
      )}
    </>
  );
});

const styles = StyleSheet.create({
  tail: { position: 'absolute', bottom: 0 },
});
