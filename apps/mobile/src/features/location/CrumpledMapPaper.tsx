import React, {useEffect, useMemo} from 'react';
import {Canvas, ImageShader, Vertices, useImage} from '@shopify/react-native-skia';
import {useDerivedValue, type SharedValue} from 'react-native-reanimated';
import {createPaperMesh, unfoldPaperMesh} from './paperMesh';

/** A single textured surface. Adjacent triangles share the same crease points. */
export function CrumpledMapPaper({size, open, onReady}: {
  size: number; open: SharedValue<number>; onReady: () => void;
}) {
  const image = useImage(require('../../../assets/map/paper-map.png'));
  const mesh = useMemo(() => createPaperMesh(), []);
  const frame = useDerivedValue(() => unfoldPaperMesh(mesh, open.value, size));
  const vertices = useDerivedValue(() => frame.value.vertices);
  const colors = useDerivedValue(() => frame.value.colors);
  useEffect(() => {if (image) onReady();}, [image, onReady]);
  return <Canvas style={{width: size, height: size}} pointerEvents="none">
    {image && <Vertices vertices={vertices} textures={mesh.textures} mode="triangles">
      <ImageShader image={image} tx="clamp" ty="clamp" fit="fill" rect={{x: 0, y: 0, width: 768, height: 768}}/>
    </Vertices>}
    {image && <Vertices vertices={vertices} colors={colors} color="white" mode="triangles" blendMode="multiply"/>}
  </Canvas>;
}
