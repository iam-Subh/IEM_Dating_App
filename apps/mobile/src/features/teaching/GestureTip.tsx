import React, {useEffect, useRef, useState} from 'react';
import {BackHandler, Pressable, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {GestureTeachingHand, type TeachingGesturePose} from './GestureTeachingHand';
import {gestureTipLayout, TIP_HAND_HEIGHT, TIP_HAND_SIZE, type TipFrame} from './gestureTipLayout';

export type GestureTipSpec = {
  pose: TeachingGesturePose;
  text: string;
  /** Fallback contact position in window coordinates. */
  x: number;
  y: number;
  /** Re-measure the actual control after this overlay has mounted. */
  anchor?: React.RefObject<View | null>;
  anchorPoint?: {x: number; y: number};
  direction?: 'left' | 'right' | 'down';
  textSide?: 'left' | 'right';
};
type Measurement = {layer: TipFrame; point: {x: number; y: number}; target: TipFrame | null};

/** The hand points at a measured control. Its caption has a separate layout. */
export function GestureTip({tip, onDone}: {tip: GestureTipSpec; onDone: () => void}) {
  const {width, height} = useWindowDimensions();
  const layer = useRef<View>(null);
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const [captionHeight, setCaptionHeight] = useState(66);
  const request = useRef(0);
  const done = useRef(onDone);
  done.current = onDone;

  const measure = () => {
    const token = ++request.current;
    layer.current?.measureInWindow((x, y, w, h) => {
      if (token !== request.current || w <= 0 || h <= 0) return;
      const bounds = {x, y, width: w, height: h};
      if (!tip.anchor?.current) {
        setMeasurement({layer: bounds, point: {x: tip.x, y: tip.y}, target: null});
        return;
      }
      tip.anchor.current.measureInWindow((tx, ty, tw, th) => {
        if (token !== request.current || tw <= 0 || th <= 0) return;
        const point = tip.anchorPoint ?? {x: 0.5, y: 0.5};
        setMeasurement({layer: bounds, point: {x: tx + tw * point.x, y: ty + th * point.y}, target: {x: tx, y: ty, width: tw, height: th}});
      });
    });
  };
  useEffect(() => {
    setMeasurement(null);
    const frame = requestAnimationFrame(measure);
    return () => {cancelAnimationFrame(frame); request.current++;};
  }, [tip, width, height]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {done.current(); return true;});
    return () => subscription.remove();
  }, []);
  const layout = measurement ? gestureTipLayout(measurement.point, measurement.layer, captionHeight) : null;
  const target = measurement?.target;
  return <View ref={layer} collapsable={false} style={[StyleSheet.absoluteFill, styles.layer]} onLayout={measure} accessibilityViewIsModal>
    <Pressable style={[StyleSheet.absoluteFill, styles.scrim]} onPress={() => done.current()} accessibilityRole="button" accessibilityLabel={`${tip.text} Tap to close.`}/>
    {layout && measurement ? <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.target, target
        ? {left: target.x - measurement.layer.x - 4, top: target.y - measurement.layer.y - 4, width: target.width + 8, height: target.height + 8, borderRadius: (Math.min(target.width, target.height) + 8) / 2}
        : {left: layout.contact.x - 15, top: layout.contact.y - 15, width: 30, height: 30, borderRadius: 15}]}/>
      <View style={[styles.hand, layout.hand]}>
        <GestureTeachingHand key={`${tip.pose}:${tip.x}:${tip.y}`} pose={tip.pose} text={tip.text} direction={tip.direction}
          textSide="none" anchorAtContact size={TIP_HAND_SIZE} onComplete={() => done.current()}/>
      </View>
      <View style={[styles.caption, layout.caption]} onLayout={event => setCaptionHeight(event.nativeEvent.layout.height)}>
        <Text style={styles.text}>{tip.text}</Text>
        <Text style={styles.dismiss}>Tap anywhere to close</Text>
      </View>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  layer: {zIndex: 50, elevation: 50},
  scrim: {backgroundColor: 'rgba(0,0,0,0.32)'},
  hand: {position: 'absolute', width: TIP_HAND_SIZE, height: TIP_HAND_HEIGHT},
  target: {position: 'absolute', borderWidth: 1.5, borderColor: '#F2C1BE'},
  caption: {position: 'absolute', borderRadius: 14, backgroundColor: '#292522', paddingHorizontal: 14, paddingVertical: 12, gap: 5},
  text: {fontFamily: 'DMSans_500Medium', color: '#F6E7D6', fontSize: 13, lineHeight: 19},
  dismiss: {fontFamily: 'DMSans_400Regular', color: '#B9ACA0', fontSize: 11, lineHeight: 15},
});
