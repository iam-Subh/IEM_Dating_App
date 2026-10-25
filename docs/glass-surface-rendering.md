# Glass surface rendering

## Files and integration

`apps/mobile/src/navigation/GlassTabBar.tsx` is the active bar. On supported Android clients, `MainTabNavigator` wraps its tabs with `GlassSource` and publishes the tab state to a sibling bar overlay. This physically excludes the bar from the source subtree. Other clients use the standard tab-bar slot. `CustomTabBar.tsx` is preserved. The new component uses it only on iOS.

`apps/mobile/modules/glass-surface` is a local Expo module. Expo autolinking discovers it under the mobile project's `modules` directory. Rebuild the Android client after Kotlin changes. Reloading Metro does not install native code.

## Android drawing

1. `GlassSourceView` records its children into a `RenderNode` with a hardware recording canvas. Android can reuse the child display lists.
2. `GlassSurfaceView` and its controls are siblings outside that source subtree.
3. Android draws the bar above the source in normal hierarchy order. The bar resolves the sibling source and converts window positions into source-relative sampling coordinates.
4. The bar samples that source through `RenderEffect`. Android 13 and newer use an AGSL edge-refraction shader. Android 12 uses hardware blur.
5. Foreground controls draw after the material. They do not enter their own background.

There is no software `root.draw(bitmapCanvas)`, bitmap readback, polling timer, or `onPreDraw` capture listener in this module. Recording occurs when Android draws the source. The source belongs to the tabs, so pushed root-stack pages do not enter it. Render nodes release display lists on detach.

The bar uses the previous contour and button dimensions. The shader uses an approximate signed distance to the capsule and center bulge; the native path clips the final silhouette. This is an independent implementation, not Telegram code.

The native outline has a uniform 1 dp inset inside its view. The shader applies the same inset and scale, so the refraction boundary follows the visible outline. The Android material and frosted fallback have no outer border stroke. Button spacing is unchanged.

The surface adds a translucent `#1C1C1C` wash after it draws the refracted background. This keeps the pill visible over near-black pages without an outline or glow. The wash retains limited transparency for refraction. The frosted fallback uses the same material color.

The refraction material uses a 2 dp blur radius. Its lens curve follows the existing custom bar: a 16.335 dp strength coefficient (11 × 1.35 × 1.1), a squared rim ramp, a calm outer bevel, and a fade before opposing normals meet. These masks reduce the actual displacement below the strength coefficient. The contour fade ends at 19.4 dp from the edge. No reflection or glow is added. Android 12 retains a 5 dp blur radius. The distance field remains approximate, so this does not establish exact visual parity with the old renderer.

## Fallbacks and limits

Older Android versions and clients without the module use the frosted bar. A refraction shader compilation failure falls back to hardware blur. Reduce-transparency mode uses a solid material. iOS uses the existing OS-backed implementation.

Separate Android surfaces, such as some video players and maps, may not appear in the recorded source. The current integration assumes a fixed, unscaled bar inside the main tabs. It is not a general portal for arbitrary transformed overlays.

## Verification

Run `npm run typecheck --workspace apps/mobile`. From `apps/mobile/android`, run `gradlew.bat :app:assembleDebug -PreactNativeArchitectures=arm64-v8a`.

On a device, check all five tab buttons, scrolling behind the bar, Edit profile and Settings opening and Back, rapid repeated navigation, app background and resume, and text size changes. Compare transition frame timing against the former renderer. A successful build alone does not establish smooth animation. Check Android 12 blur and iOS separately before claiming cross-platform visual parity.

Initial connected-phone debug check: Android build and mobile typecheck passed. Profile glass, scrolling background updates, Edit profile opening, and Back were checked. An isolated gfxinfo sample around Edit profile and Back contained 67 frames: p50 13 ms, p95 44 ms, p99 81 ms, and 5 janky frames (7.46%). This small sample is not a release benchmark or a controlled comparison against the former renderer. Further device and fallback checks remain necessary.
