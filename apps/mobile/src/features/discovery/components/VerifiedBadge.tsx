import React from "react";
import Svg, { Path } from "react-native-svg";

/**
 * The blue badge: college email and selfie check both verified. `muted` is
 * the grey one, shown only to the person themselves while a step is missing.
 */
export function VerifiedBadge({ size = 20, muted = false }: { size?: number; muted?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={muted ? "Blue badge not earned yet" : "Verified profile"}>
      <Path fill={muted ? "#8C8983" : "#3B82F6"} d="M23 12l-2.44-2.79.34-3.69-3.61-.82L15.4 1.5 12 2.96 8.6 1.5 6.71 4.69 3.1 5.5l.34 3.7L1 12l2.44 2.79-.34 3.7 3.61.82L8.6 22.5l3.4-1.47 3.4 1.46 1.89-3.19 3.61-.82-.34-3.69L23 12Z" />
      <Path d="m7.4 12.1 3.1 3.1 6.3-6.3" fill="none" stroke={muted ? "#F2EFE9" : "#FFFFFF"} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
