import { Platform } from 'react-native';
import * as Application from 'expo-application';
import { navigationRef } from '../../navigation/navigationRef';

/**
 * The technical details a bug report can carry (docs/FEEDBACK.md): the app
 * version, the phone, the screen, and the app's last few errors. Never
 * messages, passwords or tokens - anything that looks like one is cut out.
 */
const MAX_ERRORS = 20;
const recentErrors: { at: string; message: string }[] = [];
let installed = false;

const SECRET = /(bearer\s+)[\w.-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+|[\w.+-]+@[\w-]+\.[\w.]+/gi;
const clean = (value: unknown) => String(value instanceof Error ? `${value.name}: ${value.message}` : typeof value === 'string' ? value : (() => {
  try { return JSON.stringify(value); } catch { return String(value); }
})()).replace(SECRET, '[hidden]').slice(0, 300);

function remember(parts: unknown[]) {
  recentErrors.push({ at: new Date().toISOString(), message: parts.map(clean).join(' ').slice(0, 400) });
  if (recentErrors.length > MAX_ERRORS) recentErrors.shift();
}

/** Once, at start-up: keeps the last errors the app logged or crashed with. */
export function installErrorMemory() {
  if (installed) return;
  installed = true;
  const original = console.error;
  console.error = (...parts: unknown[]) => { remember(parts); original(...parts); };
  const global = (globalThis as any).ErrorUtils;
  const previous = global?.getGlobalHandler?.();
  global?.setGlobalHandler?.((error: unknown, fatal?: boolean) => { remember([fatal ? 'Fatal:' : 'Error:', error]); previous?.(error, fatal); });
}

export function currentScreen(): string | null {
  try { return navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name ?? null : null; } catch { return null; }
}

export function appVersion() {
  return `${Application.nativeApplicationVersion ?? '?'} (${Application.nativeBuildVersion ?? '?'})`;
}

export function collectDiagnostics(screen = currentScreen()) {
  const constants = (Platform as any).constants ?? {};
  return {
    appVersion: appVersion(),
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    device: [constants.Brand, constants.Model].filter(Boolean).join(' ') || null,
    screen,
    at: new Date().toISOString(),
    recentErrors: [...recentErrors],
  };
}
