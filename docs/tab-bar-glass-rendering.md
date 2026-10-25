# Tab bar glass rendering

## Reference

Telegram's Android shader samples the background with edge refraction, then composites a foreground tint. The shader does not add a mirrored rim or a fixed dark edge shadow.

- https://github.com/DrKLO/Telegram/blob/master/TMessagesProj/src/main/res/raw/liquid_glass_shader.agsl
- https://github.com/DrKLO/Telegram/blob/master/TMessagesProj/src/main/java/org/telegram/ui/Components/blur3/LiquidGlassEffect.java

The app retains its raised center button. This differs from Telegram's straight capsule. The material should have soft background blur, limited edge distortion, and a faint border.

## Rendering rules

- Put navigation controls inside the native glass view. Its Android capture omits that view and its children. Sibling controls enter the background capture and produce blurred duplicate icons and pink glow.
- Disable the package's decorative rim, specular highlights, and mirrored edge reflection. Keep refraction enabled.
- Use a thin SVG stroke for the custom contour.
- Keep the center button opaque and without elevation or shadow.
- Preserve the platform accessibility override and the frosted fallback.

## Native correction

`patches/react-native-liquid-glassmorphism+1.2.1.patch` makes the Android inner shadow follow the specular setting. Previously the shader subtracted up to 0.12 from RGB even with lighting disabled. Dark backgrounds became black at the edges.

The root postinstall script applies the patch. Rebuild the native client after this patch changes. Metro reload alone cannot update a compiled shader.

The patch also fades custom-shape refraction to zero before opposing edge normals meet in the interior. Without this limit, the upper and lower displaced background samples produce a horizontal seam through the bar. The outer edge retains refraction.

Background change detection compares the full local bitmap region with reused pixel buffers. The original 6-by-5 sample grid could miss slowly moving text and hold a stale glass image. Changed captures request a current-frame repaint and a deferred fallback. Unchanged captures do not request another frame. This corrects missed updates; it does not remove the cost of the shared full-screen software capture.

## Stack transitions

Keep the glass view and its controls mounted beneath stack screens during navigation. Do not replace the material with a static fill when the tabs lose focus. Disable tab interaction and accessibility while another screen covers the tabs.

The native patch resolves the nearest ancestor with native ID `liquid-glass-backdrop`. `MainTabNavigator` provides this boundary with `collapsable={false}`. Capture and sample coordinates use that same boundary. This excludes the root screen stack and screens above the tabs from the software draw. Unscoped glass views retain the package's window-root behavior.

Telegram prepares the previous fragment before animating Back in `ActionBarLayout.closeLastFragment` and `prepareForMoving`. Its main tab glass also uses a tab-content source. This app applies those isolation and visibility principles. It still uses the package's bitmap capture and GPU effect, rather than Telegram's RenderNode source implementation. Rebuild Android before testing this change; a Metro reload cannot apply the native boundary fix.

Reference: https://github.com/DrKLO/Telegram/blob/master/TMessagesProj/src/main/java/org/telegram/ui/ActionBar/ActionBarLayout.java

## Device checks

Run the mobile typecheck and the Android ARM64 debug build. Check the installed build with text behind the bar and while scrolling. Confirm that the center button and each tab accept taps. Device screenshots are necessary; TypeScript and bundle checks cannot validate glass appearance. Repeat visual checks on iOS before claiming identical appearance across platforms.
