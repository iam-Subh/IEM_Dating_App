import { useFaceStatus, useRealPersonActions } from '../../features/verification/RealPerson';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../services/api';
import { VerifiedBadge } from '../../features/discovery/components/VerifiedBadge';
import { reminderColors } from '../../features/verification/ReminderParts';
import { SettingsCard, SettingsEmptyState, SettingsPage, settingsLayout, settingsPalette as palette } from '../../core/settings/SettingsLayout';
import { PasswordPromptModal } from '../../components/PasswordPromptModal';
import { signInWithGoogle } from '../../services/googleSignIn';

/**
 * Settings > Account: what this account signs in with - its email and
 * password, Google, or both - and the college email that verifies it
 * (features/auth/GOOGLE_SIGNUP_PLAN.md 1.2). A Google account can add a
 * password; an email account can connect Google; Google can be disconnected
 * only while a password remains to sign in with.
 */

type Account = {
  signUpMethod: 'email' | 'google';
  email: string | null;
  emailVerifiedAt: string | null;
  collegeEmail: string | null;
  collegeEmailVerifiedAt: string | null;
  collegeVerificationExpired?: boolean;
  google: { email: string; linkedAt: string } | null;
  hasPassword: boolean;
  memberSince: string;
};

function verifiedOn(iso: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : `Verified ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

const METHOD_LABEL: Record<Account['signUpMethod'], string> = { email: 'Email', google: 'Google' };

export const AccountScreen = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try { const response = await api.get('/auth/account'); setAccount(response.data.data); }
    catch { setFailed(true); }
    finally { setLoading(false); }
  }, []);
  // Coming back from verifying shows the college email.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const { face, reload: reloadFace } = useFaceStatus();
  const realPerson = useRealPersonActions(reloadFace);
  const [addingPassword, setAddingPassword] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const addPassword = async (password: string) => {
    setPasswordBusy(true);
    setPasswordError('');
    try {
      await api.post('/auth/account/password', { password });
      setAddingPassword(false);
      await load();
    } catch (error: any) {
      setPasswordError(error?.response?.data?.message ?? 'Could not add the password. Try again.');
    } finally { setPasswordBusy(false); }
  };

  const [googleBusy, setGoogleBusy] = useState(false);
  const connectGoogle = async () => {
    if (googleBusy) return;
    setGoogleBusy(true);
    try {
      const result = await signInWithGoogle();
      if (result.kind === 'cancelled') return;
      if (result.kind === 'error') { Alert.alert('Google', result.message); return; }
      await api.post('/auth/account/google', { idToken: result.idToken });
      await load();
    } catch (error: any) {
      Alert.alert('Could not connect Google', error?.response?.data?.message ?? 'Check your connection and try again.');
    } finally { setGoogleBusy(false); }
  };
  const disconnectGoogle = () => {
    if (!account?.hasPassword) {
      Alert.alert('Add a password first', 'Without Google you need a password to sign in. Add one, then disconnect Google.');
      return;
    }
    Alert.alert('Disconnect Google?', 'You will sign in with your email and password instead.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: async () => {
        try { await api.delete('/auth/account/google'); await load(); }
        catch (error: any) { Alert.alert('Could not disconnect Google', error?.response?.data?.message ?? 'Try again.'); }
      } },
    ]);
  };

  if (!account) {
    return <SettingsPage title="Account">
      {loading ? <View style={settingsLayout.loading}><ActivityIndicator color={palette.accent} /></View>
        : <SettingsEmptyState icon="cloud-offline-outline" title="Could not load your account" message="Check your connection and try again." onRetry={failed ? load : undefined} />}
    </SettingsPage>;
  }

  const collegeDone = !!account.collegeEmailVerifiedAt && !account.collegeVerificationExpired;
  const faceDone = face?.status === 'verified';
  const badgeEarned = collegeDone && faceDone;
  const stepsDone = [collegeDone, faceDone].filter(Boolean).length;
  return <SettingsPage title="Account">
    <ScrollView contentContainerStyle={[settingsLayout.content, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
      <View style={styles.signedUp}>
        <Ionicons name={account.signUpMethod === 'google' ? 'logo-google' : 'mail-outline'} size={18} color={palette.accent} />
        <Text style={styles.signedUpText}>You signed up with <Text style={styles.strong}>{METHOD_LABEL[account.signUpMethod].toLowerCase()}</Text>.</Text>
      </View>

      <SettingsCard title="Sign-in methods" icon="key-outline">
        <MethodRow icon="mail-outline" label="Email"
          value={account.email ?? 'Not added'} note={account.email ? verifiedOn(account.emailVerifiedAt) ?? 'Not verified' : null}
          badge={account.signUpMethod === 'email' ? 'Signed up' : undefined} muted={!account.email}
          detail={account.email && account.hasPassword ? 'Sign in with this email and your password.' : undefined} />
        <MethodRow icon="lock-closed-outline" label="Password"
          value={account.hasPassword ? 'Set' : 'Not added'} muted={!account.hasPassword}
          detail={account.hasPassword ? undefined : 'You signed up with Google. Add a password to also sign in with your email.'}
          action={account.hasPassword
            ? { label: 'Change', onPress: () => navigation.navigate('ChangePassword') }
            : { label: 'Add', onPress: () => { setPasswordError(''); setAddingPassword(true); } }} />
        <MethodRow icon="logo-google" label="Google"
          value={account.google?.email ?? 'Not connected'} note={account.google ? 'Connected' : null}
          badge={account.signUpMethod === 'google' ? 'Signed up' : undefined} muted={!account.google}
          detail={account.google ? 'Choose this Google account to sign in - no password needed.' : 'Connect Google to sign in with it next time.'}
          action={account.google
            ? { label: 'Disconnect', onPress: disconnectGoogle }
            : { label: googleBusy ? '...' : 'Connect', onPress: connectGoogle }} />
      </SettingsCard>

      {/* The blue badge: both steps done (blue-badge.ts on the server). Only you see these steps. */}
      <View style={styles.badgeCard}>
        <View style={styles.badgeHead}>
          <VerifiedBadge size={28} muted={!badgeEarned} />
          <View style={styles.badgeHeadCopy}>
            <Text style={styles.badgeTitle}>{badgeEarned ? 'Your blue badge is on' : 'Get your blue badge'}</Text>
            <Text style={styles.badgeSummary}>{badgeEarned ? 'Both checks complete.' : `${stepsDone} of 2 checks complete.`}</Text>
          </View>
        </View>
        <BadgeStep icon={account.collegeVerificationExpired ? 'refresh-outline' : 'mail-outline'} title="College email"
          status={account.collegeVerificationExpired ? { tone: 'warn', text: 'Ended - your badge is hidden' }
            : collegeDone ? { tone: 'done', text: verifiedOn(account.collegeEmailVerifiedAt) ?? 'Verified' } : { tone: 'todo', text: 'Not done' }}
          detail={collegeDone ? account.collegeEmail ?? account.email ?? undefined : 'Your college email and a 6-digit code. Also unlocks unlimited chat.'}
          action={account.collegeVerificationExpired ? { label: 'Re-verify', onPress: () => navigation.navigate('VerifyCollege') }
            : collegeDone ? undefined : { label: 'Verify', onPress: () => navigation.navigate('VerifyCollege') }} />
        {/* The real-person check (PHOTO_VERIFICATION_PLAN.md 11). */}
        <BadgeStep icon={face?.status === 'needs_fix' ? 'image-outline' : 'scan-outline'} title="Selfie check" last
          status={!face ? { tone: 'todo', text: 'Checking…' }
            : face.status === 'verified' ? { tone: 'done', text: 'Verified' }
            : face.status === 'pending_review' ? { tone: 'warn', text: 'Being checked by our team' }
            : face.status === 'needs_fix' ? { tone: 'warn', text: 'A photo needs fixing' } : { tone: 'todo', text: 'Not done' }}
          detail={!face ? undefined : face.status === 'verified' ? 'Your selfie stays private.'
            : face.status === 'needs_fix' ? 'A photo or video no longer matches your selfie.'
            : face.status === 'pending_review' ? undefined
            : face.required ? 'Required for accounts made with Google. Your selfie is never shown.' : 'A quick selfie that matches your photos. It is never shown.'}
          action={!face || face.status === 'pending_review' ? undefined
            : face.status === 'verified' ? { label: 'Remove', quiet: true, onPress: () => Alert.alert('Remove your selfie check?', 'Your face key is deleted and your profile loses the blue badge. ' + (face.required ? 'Accounts made with Google need it to stay visible.' : 'You can do it again any time.'), [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Remove', style: 'destructive', onPress: () => void realPerson.remove().catch(() => Alert.alert('Could not remove it', 'Try again.')) },
            ]) }
            : face.status === 'needs_fix' ? { label: 'Fix', onPress: () => navigation.navigate('EditProfile') }
            : { label: 'Start', onPress: realPerson.start }} />
      </View>

      {/* DPDP Act section 14: who may use your data rights if you can't (features/safety/NomineeScreen). */}
      <SettingsCard title="Your data rights" icon="people-circle-outline">
        <MethodRow icon="person-add-outline" label="Nominee" value="Someone who can act for you"
          detail="If you die or can't, they can ask us for your data or to delete your account."
          action={{ label: 'Set', onPress: () => navigation.navigate('Nominee') }} />
      </SettingsCard>

      <Text style={styles.footnote}>Only you can see these. Your email is never shown on your profile.</Text>
    </ScrollView>
    <PasswordPromptModal visible={addingPassword} title="Add a password"
      message={`Sign in with ${account.email ?? 'your email'} and this password. Google keeps working too.`}
      confirmLabel="Add" minLength={8} busy={passwordBusy} error={passwordError}
      onSubmit={addPassword} onCancel={() => setAddingPassword(false)} />
  </SettingsPage>;
};

/** One step of the blue badge: its icon, status, and action. */
function BadgeStep({ icon, title, status, detail, action, last = false }: {
  icon: React.ComponentProps<typeof Ionicons>['name']; title: string;
  status: { tone: 'done' | 'warn' | 'todo'; text: string }; detail?: string;
  action?: { label: string; onPress: () => void; quiet?: boolean }; last?: boolean;
}) {
  const color = status.tone === 'done' ? reminderColors.success : status.tone === 'warn' ? reminderColors.amber : palette.muted;
  return <View style={[styles.step, !last && styles.stepLine]}>
    <Ionicons name={icon} size={20} color={palette.icon} style={styles.stepIcon} />
    <View style={styles.rowBody}>
      <Text style={[styles.value, styles.stepTitle]}>{title}</Text>
      <View style={[styles.noteLine, styles.stepStatus]}>
        <Ionicons name={status.tone === 'done' ? 'checkmark-circle' : status.tone === 'warn' ? 'time' : 'ellipse-outline'} size={13} color={color} />
        <Text style={[styles.note, { color }]}>{status.text}</Text>
      </View>
      {detail ? <Text style={[styles.detail, styles.stepDetail]}>{detail}</Text> : null}
    </View>
    {action ? <Pressable onPress={action.onPress} accessibilityRole="button" accessibilityLabel={`${action.label} ${title.toLowerCase()}`}
      style={({ pressed }) => [styles.action, action.quiet && styles.actionQuiet, pressed && settingsLayout.pressed]}>
      <Text style={[styles.actionText, action.quiet && styles.actionQuietText]}>{action.label}</Text>
    </Pressable> : null}
  </View>;
}

function MethodRow({ icon, label, value, note, detail, badge, muted, action }: {
  icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: string; note?: string | null; detail?: string;
  badge?: string; muted?: boolean; action?: { label: string; onPress: () => void };
}) {
  return <View style={styles.row}>
    <Ionicons name={icon} size={20} color={muted ? palette.muted : palette.icon} style={styles.rowIcon} />
    <View style={styles.rowBody}>
      <View style={styles.labelLine}>
        <Text style={styles.label}>{label}</Text>
        {badge && <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View>}
      </View>
      <Text style={[styles.value, muted && styles.valueMuted]} numberOfLines={1} selectable={!muted}>{value}</Text>
      {note && <View style={styles.noteLine}>
        {note.startsWith('Verified') || note === 'Connected' ? <Ionicons name="checkmark-circle" size={13} color="#BDE4CA" /> : null}
        <Text style={styles.note}>{note}</Text>
      </View>}
      {detail && <Text style={styles.detail}>{detail}</Text>}
    </View>
    {action && <Pressable onPress={action.onPress} accessibilityRole="button" accessibilityLabel={`${action.label} ${label.toLowerCase()}`}
      style={({ pressed }) => [styles.action, pressed && settingsLayout.pressed]}>
      <Text style={styles.actionText}>{action.label}</Text>
    </Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  badgeCard: { backgroundColor: palette.card, borderRadius: 16, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 },
  badgeHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 6 },
  badgeHeadCopy: { flex: 1, minWidth: 0 },
  badgeTitle: { color: palette.text, fontFamily: 'DMSans_700Bold', fontSize: 15, lineHeight: 21 },
  badgeSummary: { color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 17, marginTop: 2 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  stepIcon: { width: 22, textAlign: 'center' },
  stepTitle: { fontSize: 14, lineHeight: 20, marginTop: 0 },
  stepStatus: { marginTop: 2 },
  stepDetail: { lineHeight: 15, marginTop: 3 },
  stepLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.separator },
  actionQuiet: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#4A4448' },
  actionQuietText: { color: palette.secondary },
  signedUp: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderRadius: 16, backgroundColor: palette.card },
  signedUpText: { flex: 1, color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19 },
  strong: { color: palette.text, fontFamily: 'DMSans_700Bold' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 13 },
  rowIcon: { marginTop: 2 },
  rowBody: { flex: 1, minWidth: 0 },
  labelLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { color: palette.secondary, fontFamily: 'DMSans_500Medium', fontSize: 12 },
  badge: { backgroundColor: '#3B2B34', borderRadius: 9, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { color: palette.accent, fontFamily: 'DMSans_700Bold', fontSize: 10 },
  value: { color: palette.text, fontFamily: 'DMSans_700Bold', fontSize: 15, marginTop: 3 },
  valueMuted: { color: palette.muted, fontFamily: 'DMSans_500Medium' },
  noteLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  note: { color: '#BDE4CA', fontFamily: 'DMSans_500Medium', fontSize: 11 },
  detail: { color: palette.muted, fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 16, marginTop: 4 },
  action: { minHeight: 36, minWidth: 72, paddingHorizontal: 14, borderRadius: 18, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  actionText: { color: palette.accentText, fontFamily: 'DMSans_700Bold', fontSize: 12 },
  footnote: { color: palette.muted, fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 16, paddingHorizontal: 4 },
});
