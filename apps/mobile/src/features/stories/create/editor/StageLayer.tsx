import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import type { Transform } from '../composition/types';

export type LayerSizes = Record<string, { w: number; h: number }>;

type Props = {
  id: string;
  unit: number;
  transforms: SharedValue<Record<string, Transform>>;
  sizes: SharedValue<LayerSizes>;
  dragging: SharedValue<string | null>;
  overBin: SharedValue<boolean>;
  /** Kept mounted (and measured) but not drawn: the text being edited in the Text tool. */
  hidden?: boolean;
  children: React.ReactNode;
};

/**
 * A text, sticker, emoji or music layer on the stage. It takes no touches
 * itself: the stage's one gesture finds the layer under the first finger and
 * moves it, so a pinch or twist works with the second finger anywhere, as on
 * Instagram. Its natural size is measured here for that hit test.
 *
 * It shows on its very first frame: the layer is centred on its point by a
 * percentage of its own size, so it never waits for a measurement (which
 * left a new text invisible for a moment after Done).
 */
export function StageLayer({ id, unit, transforms, sizes, dragging, overBin, hidden = false, children }: Props) {
  const style = useAnimatedStyle(() => {
    const transform = transforms.value[id];
    if (!transform) return { opacity: 0 };
    const binned = dragging.value === id && overBin.value;
    // A zero-size point at the layer's centre: it turns and scales about
    // itself, and the content is centred on it below.
    return {
      opacity: binned ? 0.5 : 1,
      transform: [
        { translateX: transform.x * unit },
        { translateY: transform.y * unit },
        { rotate: `${transform.rotation}deg` },
        { scale: transform.scale * (binned ? 0.6 : 1) },
      ],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      collapsable={false}
      style={[styles.point, style]}
    >
      <View
        collapsable={false}
        // Plain style, not the animated one: hiding the text being edited must
        // take effect on the same frame, or its old copy shows under the editor.
        style={[styles.centred, hidden && styles.hidden]}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          sizes.modify((all) => {
            'worklet';
            all[id] = { w: width / unit, h: height / unit };
            return all;
          });
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  point: { position: 'absolute', left: 0, top: 0, width: 0, height: 0 },
  // Sized by its content, then pulled back by half of itself onto the point.
  centred: { position: 'absolute', left: 0, top: 0, transform: [{ translateX: '-50%' }, { translateY: '-50%' }] },
  hidden: { opacity: 0 },
});
