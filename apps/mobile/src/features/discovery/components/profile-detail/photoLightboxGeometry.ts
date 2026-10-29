export type PhotoLightboxFrame = {x: number; y: number; width: number; height: number};

export function fitLightboxPhoto(source: {width: number; height: number}, width: number, height: number, top: number, bottom: number): PhotoLightboxFrame {
  const availableHeight = Math.max(1, height - top - bottom);
  const ratio = Math.min(width / Math.max(1, source.width), availableHeight / Math.max(1, source.height));
  const imageWidth = source.width * ratio;
  const imageHeight = source.height * ratio;
  return {x: (width - imageWidth) / 2, y: top + (availableHeight - imageHeight) / 2, width: imageWidth, height: imageHeight};
}

/** Stretch the clipping frame, then counter-scale the image to keep its ratio. */
export function lightboxTransform(origin: PhotoLightboxFrame, destination: PhotoLightboxFrame, base: PhotoLightboxFrame, progress: number) {
  'worklet';
  const t = Math.max(0, Math.min(1, progress));
  const width = origin.width + (destination.width - origin.width) * t;
  const height = origin.height + (destination.height - origin.height) * t;
  const x = origin.x + (destination.x - origin.x) * t;
  const y = origin.y + (destination.y - origin.y) * t;
  const scaleX = Math.max(0.001, width / Math.max(1, base.width));
  const scaleY = Math.max(0.001, height / Math.max(1, base.height));
  const cover = Math.max(scaleX, scaleY);
  return {
    translateX: x + width / 2 - (base.x + base.width / 2),
    translateY: y + height / 2 - (base.y + base.height / 2),
    scaleX, scaleY,
    imageScaleX: cover / scaleX,
    imageScaleY: cover / scaleY,
    radius: 14 * (1 - t) / ((scaleX + scaleY) / 2),
  };
}
