import { Alert, Linking } from 'react-native';

/**
 * Where people write to us: support, grievances, appeals (docs/SAFETY_AND_LEGAL.md 6).
 * One place to change it; the server's documents read SUPPORT_EMAIL too.
 */
export const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL || 'noreply.iemconnect@gmail.com';

/** Opens the mail app with the subject filled in; says where to write if there is no mail app. */
export async function writeToSupport(subject: string, body = '') {
  const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ''}`;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Write to us', `Email ${SUPPORT_EMAIL} with "${subject}" in the subject.`);
  }
}
