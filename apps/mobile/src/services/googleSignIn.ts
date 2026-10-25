import { TurboModuleRegistry } from 'react-native';
import type * as GoogleSignInModule from '@react-native-google-signin/google-signin';

/**
 * Google's native sign-in sheet (features/auth/GOOGLE_SIGNUP_PLAN.md). It
 * returns an ID token issued to our Web client ID, which the server checks
 * with Google before trusting anything in it.
 *
 * The package is loaded only when someone taps "Continue with Google": it
 * needs its native part in the app build, and a build made before it was
 * added would otherwise crash at launch instead of just saying so here.
 */

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
let google: typeof GoogleSignInModule | null | undefined;

function load() {
  if (google !== undefined) return google;
  // Asked without loading anything: the package itself throws while loading
  // when its native part is missing, and in development that error is
  // reported before any catch here can see it.
  if (!TurboModuleRegistry.get('RNGoogleSignin')) {
    google = null;
    return google;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    google = require('@react-native-google-signin/google-signin') as typeof GoogleSignInModule;
    // No offline access and only the basic profile: an email and a name are all the app needs.
    google.GoogleSignin.configure({ webClientId: WEB_CLIENT_ID });
  } catch {
    google = null;
  }
  return google;
}

export type GoogleResult =
  | { kind: 'token'; idToken: string }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

/**
 * Shows Google's account picker. Signs out of Google in the app first, so the
 * picker always asks which account, instead of silently reusing the last one.
 */
export async function signInWithGoogle(): Promise<GoogleResult> {
  if (!WEB_CLIENT_ID) return { kind: 'error', message: 'Google sign-in is not set up in this build.' };
  const module = load();
  if (!module) return { kind: 'error', message: 'This version of the app needs an update to sign in with Google.' };
  const { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } = module;
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    await GoogleSignin.signOut().catch(() => undefined);
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return { kind: 'cancelled' };
    const idToken = response.data.idToken;
    if (!idToken) return { kind: 'error', message: 'Google did not return a sign-in token. Try again.' };
    return { kind: 'token', idToken };
  } catch (error) {
    if (isErrorWithCode(error)) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED || error.code === statusCodes.IN_PROGRESS) return { kind: 'cancelled' };
      if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        return { kind: 'error', message: 'Google Play services are needed to sign in with Google.' };
      }
    }
    return { kind: 'error', message: 'Google sign-in did not work. Try again.' };
  }
}
