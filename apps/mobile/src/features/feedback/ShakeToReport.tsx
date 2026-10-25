import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Alert, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Accelerometer } from 'expo-sensors';
import { navigationRef } from '../../navigation/navigationRef';
import { captureCurrentScreen } from './capture';
import { currentScreen } from './diagnostics';

/**
 * Shake the phone to report a problem (docs/FEEDBACK.md) - the screen is
 * captured first, so the report starts with what went wrong. On by default,
 * off in Settings > App settings. Never on screens where the phone moves
 * anyway: the camera, the selfie check, Stories, the report form itself.
 */
const KEY = 'feedback.shake.v1';
const QUIET_SCREENS = new Set(['RealPersonCheck', 'CreateStory', 'StoryViewer', 'ReportProblem', 'MyReports', 'Map']);
/** In g: a deliberate shake, not walking or a bump. Two within the window. */
const FORCE = 2.3;
const WINDOW_MS = 800;
const COOLDOWN_MS = 6000;

let enabled = true;
const listeners = new Set<() => void>();
void AsyncStorage.getItem(KEY).then((value) => { enabled = value !== 'off'; listeners.forEach((listener) => listener()); }).catch(() => undefined);

export function setShakeToReport(next: boolean) {
  enabled = next;
  listeners.forEach((listener) => listener());
  void AsyncStorage.setItem(KEY, next ? 'on' : 'off').catch(() => undefined);
}
export function useShakeToReport() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => enabled);
}

/** Mounted once, for a signed-in person. */
export function ShakeToReportHost() {
  const on = useShakeToReport();
  const hits = useRef<number[]>([]);
  const busy = useRef(false);
  const lastAt = useRef(0);

  useEffect(() => {
    if (!on) return;
    let subscription: { remove: () => void } | null = null;
    const listen = () => {
      if (subscription) return;
      Accelerometer.setUpdateInterval(100);
      subscription = Accelerometer.addListener(({ x, y, z }) => {
        if (Math.sqrt(x * x + y * y + z * z) < FORCE) return;
        const now = Date.now();
        hits.current = [...hits.current.filter((at) => now - at < WINDOW_MS), now];
        if (hits.current.length >= 2 && !busy.current && now - lastAt.current > COOLDOWN_MS) {
          hits.current = [];
          lastAt.current = now;
          void offerReport();
        }
      });
    };
    const stop = () => { subscription?.remove(); subscription = null; };
    // Only while the app is on screen: no sensor use in the background.
    if (AppState.currentState === 'active') listen();
    const appState = AppState.addEventListener('change', (state) => (state === 'active' ? listen() : stop()));
    return () => { appState.remove(); stop(); };
  }, [on]);

  const offerReport = async () => {
    const screen = currentScreen();
    if (!navigationRef.isReady() || (screen && QUIET_SCREENS.has(screen))) return;
    busy.current = true;
    const screenshot = await captureCurrentScreen();
    Alert.alert('Report a problem?', "Shaking your phone opens a report. Tell us what's not working.", [
      { text: 'Turn off shaking', onPress: () => { busy.current = false; setShakeToReport(false); Alert.alert('Shake to report is off', 'Turn it back on in Settings > App settings.'); } },
      { text: 'Not now', style: 'cancel', onPress: () => { busy.current = false; } },
      { text: 'Report', onPress: () => { busy.current = false; navigationRef.navigate('ReportProblem', { source: 'shake', screenshot, screen }); } },
    ], { cancelable: true, onDismiss: () => { busy.current = false; } });
  };

  return null;
}
