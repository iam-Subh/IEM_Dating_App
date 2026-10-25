import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * This phone, as Active sessions shows it: brand, model, OS and app version.
 * From React Native's own platform constants, so no extra native module.
 * Sent as `X-Device-Info` on every request; the server stores it on the
 * session at most once every five minutes.
 */
function describe() {
  const constants = (Platform.constants ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
  const info: Record<string, string | undefined> = {
    platform: Platform.OS,
    appVersion: text(Constants.expoConfig?.version),
  };
  if (Platform.OS === 'android') {
    const brand = text(constants.Brand) ?? text(constants.Manufacturer);
    info.brand = brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : undefined;
    info.model = text(constants.Model);
    info.osVersion = text(constants.Release) ? `Android ${constants.Release}` : `Android API ${Platform.Version}`;
    // The phone's Android ID: lets the server keep banned people from signing
    // up again and allow two Google sign-ups per phone (GOOGLE_SIGNUP_PLAN.md
    // 6.1). Never stored on sessions. Read only when the native module is in
    // this build, so an older build simply sends none.
    const application = requireOptionalNativeModule<{ androidId?: string | null }>('ExpoApplication');
    info.androidId = text(application?.androidId ?? undefined);
  } else if (Platform.OS === 'ios') {
    info.brand = 'Apple';
    info.model = text(constants.interfaceIdiom) === 'pad' ? 'iPad' : 'iPhone';
    info.osVersion = `iOS ${text(constants.osVersion) ?? Platform.Version}`;
  } else {
    info.osVersion = 'Web';
  }
  return JSON.stringify(Object.fromEntries(Object.entries(info).filter(([, value]) => value)));
}

export const DEVICE_INFO_HEADER = describe();
