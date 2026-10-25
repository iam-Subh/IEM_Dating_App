import { Alert } from 'react-native';
import {
  ensureLocationServices,
  locationErrorMessage,
  openSystemSettings,
  readPermission,
  requestPermission,
  sendCurrentLocation,
} from './locationClient';

/**
 * Share the phone's location right where it's needed - choosing "People
 * nearby" - instead of sending someone to a settings page. The server keeps a
 * fix shared moments ago and uses it when the switch to nearby is saved.
 *
 * Call only from a tap: it can show the system permission dialog. Explains
 * anything that stops it, and resolves true once a location was sent.
 */
export async function shareLocationNow(): Promise<boolean> {
  try {
    let permission = await readPermission();
    if (permission.status !== 'granted') {
      if (permission.status === 'denied' && !permission.canAskAgain) return blocked();
      permission = await requestPermission();
      if (permission.status !== 'granted') {
        if (!permission.canAskAgain) return blocked();
        Alert.alert('Location not shared', 'People nearby needs your location. You can choose an area at your college instead.');
        return false;
      }
    }
    if (!(await ensureLocationServices())) {
      Alert.alert('Location is off', 'Turn on location on your phone, then try again.');
      return false;
    }
    await sendCurrentLocation(permission.accuracy);
    return true;
  } catch (error) {
    Alert.alert("Couldn't share your location", locationErrorMessage(error));
    return false;
  }
}

function blocked() {
  Alert.alert('Allow location', 'Location access is turned off for this app. Allow it in your phone settings to use People nearby.', [
    { text: 'Not now', style: 'cancel' },
    { text: 'Open settings', onPress: () => openSystemSettings() },
  ]);
  return false;
}
