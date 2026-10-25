import React, {useState} from 'react';
import {Image, PixelRatio, StyleSheet, View} from 'react-native';
import Svg, {Path, Rect} from 'react-native-svg';

const portrait = require('../../../assets/illustrations/face-man-3d-mobile.png');

/** One static, front-facing 3D portrait in a single square frame. */
export function FaceTurnIllustration() {
  const [size, setSize] = useState(0);
  const frameSize = PixelRatio.roundToNearestPixel(size * 0.78);
  const framePadding = 3;
  const frameCanvasSize = frameSize + framePadding * 2;
  // Crop before the rounded bust base. The shirt fills the lower edge.
  const portraitSize = frameSize / 0.86;
  const edge = 1, tangent = 28;
  const farEdge = frameSize - edge, farTangent = frameSize - tangent;
  // All four corner marks follow the same curve as the thin frame.
  const corners = [
    `M${edge} ${tangent}A27 27 0 0 1 ${tangent} ${edge}`,
    `M${farTangent} ${edge}A27 27 0 0 1 ${farEdge} ${tangent}`,
    `M${farEdge} ${farTangent}A27 27 0 0 1 ${farTangent} ${farEdge}`,
    `M${tangent} ${farEdge}A27 27 0 0 1 ${edge} ${farTangent}`,
  ].join(' ');

  return <View style={s.canvas} pointerEvents="none" onLayout={({nativeEvent: {layout}}) => {
    const next = Math.floor(Math.min(layout.width, layout.height));
    setSize(previous => previous === next ? previous : next);
  }}>
    {size > 0 && <View style={{width: frameSize, height: frameSize}}>
      <View style={[s.portraitBox, {width: frameSize, height: frameSize}]}>
        <Image source={portrait} style={{position: 'absolute', top: 0,
          left: (frameSize - portraitSize) / 2, width: portraitSize, height: portraitSize}}
          resizeMode="contain" fadeDuration={0}/>
      </View>
      {/* Keep the stroke and its antialiasing inside the SVG viewport. */}
      <Svg width={frameCanvasSize} height={frameCanvasSize}
        viewBox={`${-framePadding} ${-framePadding} ${frameCanvasSize} ${frameCanvasSize}`}
        style={[s.frame, {top: -framePadding, left: -framePadding}]}>
        <Rect x={edge} y={edge} width={frameSize - 2} height={frameSize - 2} rx={27}
          fill="none" stroke="#DDCAD1" strokeWidth={1}/>
        <Path d={corners} fill="none" stroke="#712C48" strokeWidth={2} strokeLinecap="round"/>
      </Svg>
    </View>}
  </View>;
}

const s = StyleSheet.create({
  canvas: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  portraitBox: {overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
    borderRadius: 28, backgroundColor: '#F3ECEE'},
  frame: {position: 'absolute', top: 0, left: 0, backgroundColor: 'transparent'},
});
