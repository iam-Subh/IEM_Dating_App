import { Platform, View, ViewProps } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';

export const hasGlassSurface = Platform.OS === 'android'
  && Number(Platform.Version) >= 31
  && requireOptionalNativeModule('GlassSurface') != null;

export const GlassSource = hasGlassSurface
  ? requireNativeViewManager<ViewProps>('GlassSurface', 'Source') : View;
export const GlassSurface = hasGlassSurface
  ? requireNativeViewManager<ViewProps & { reduceTransparency?: boolean; cornerRadius?: number; bottomCornerRadius?: number; shape?: 'navigation' | 'pill' }>('GlassSurface', 'Surface') : View;
