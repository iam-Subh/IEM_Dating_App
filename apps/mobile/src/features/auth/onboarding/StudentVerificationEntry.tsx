import React, {useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {AuthAction, AuthEntryFrame, AuthField, auth} from './AuthEntryFrame';
import {EmailCodeEntry} from './EmailCodeEntry';
import {TapChoice} from './ConnectionDesign';
import {VerifiedBadge} from '../../discovery/components/VerifiedBadge';

type College = {code: string; name: string; emailDomain?: string | null};
export function StudentVerificationEntry({institutions, institutionCode, onCollege, email, onEmail, code, onCode,
  hasChallenge, needsPassword, password, onPassword, loading, busy, resending, error, loadError, onRetry, onBack,
  onSend, onVerify, onResend, timer, onLater}: {
  institutions: College[]; institutionCode: string; onCollege: (value: string) => void;
  email: string; onEmail: (value: string) => void; code: string; onCode: (value: string) => void;
  hasChallenge: boolean; needsPassword: boolean; password: string; onPassword: (value: string) => void;
  loading: boolean; busy: boolean; resending: boolean; error: string; loadError: string; timer: number;
  onRetry: () => void; onBack: () => void; onSend: () => void; onVerify: () => void; onResend: () => void; onLater?: () => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  // The college's domain sits after the field, so only the first part is typed.
  // Typing an "@" switches back to the whole address.
  const domain = institutions.find(college => college.code === institutionCode)?.emailDomain ?? null;
  const suffix = domain ? `@${domain}` : '';
  const split = !!domain && (!email.includes('@') || email.toLowerCase().endsWith(suffix.toLowerCase()));
  const local = split ? email.slice(0, email.toLowerCase().endsWith(suffix.toLowerCase()) ? -suffix.length : undefined) : email;
  const typeEmail = (value: string) => onEmail(domain && value && !value.includes('@') ? `${value.trim()}${suffix}` : value);
  const later = onLater ? <Pressable accessibilityRole="button" disabled={busy} onPress={onLater} style={s.later}>
    {({pressed}) => <><Text style={[auth.link, pressed && s.pressed]}>Verify later</Text><Text style={s.laterNote}>Verify from your profile when you are ready.</Text></>}
  </Pressable> : null;
  if (hasChallenge) return <EmailCodeEntry email={email} code={code} onChangeCode={onCode} onBack={onBack}
    onVerify={onVerify} onResend={onResend} timer={timer} verifying={busy && !resending} resending={resending} error={error}
    success={false} actionLabel="Verify college" verifyDisabled={needsPassword && password.length < 8}
    footer={later} additionalFields={needsPassword ? <>
      <AuthField label="Password" placeholder="Create a password" value={password} onChangeText={onPassword}
        editable={!busy} secureTextEntry={!showPassword} autoComplete="new-password"
        onToggle={() => setShowPassword(!showPassword)} visible={showPassword}/>
      <Text style={[auth.passwordRule, password.length >= 8 && auth.passwordRuleMet]}>Use at least 8 characters. Sign in with your college email next time.</Text>
    </> : undefined}/>;
  return <AuthEntryFrame title={'Verify your\ncollege email'} subtitle="Confirm your college and get the blue tick."
    colors={['#F1EDE4', '#F1EDE4', '#F1EDE4']} onBack={onBack} footer={later}
    titleStyle={s.title} headingStyle={s.heading}>
    {loading && <View style={s.loading}><ActivityIndicator color="#712C48"/><Text style={s.note}>Loading colleges…</Text></View>}
    {!!loadError && <><Text accessibilityRole="alert" style={auth.error}>{loadError}</Text><Pressable accessibilityRole="button" onPress={onRetry} style={s.retry}><Text style={auth.link}>Retry</Text></Pressable></>}
    {!loading && !loadError && <>
      <Text style={s.label}>Your college</Text>
      <View style={s.colleges}>{institutions.map(college => {
        const selected = college.code === institutionCode;
        return <TapChoice key={college.code} accessibilityRole="radio" accessibilityLabel={college.name}
          accessibilityState={{checked: selected, disabled: busy}} disabled={busy} onPress={() => onCollege(college.code)}
          style={({pressed}) => [s.college, selected && s.selected, pressed && s.pressed]}>
          <Text style={s.collegeName}>{college.name}</Text><View style={[s.radio, selected && s.radioSelected]}>{selected && <Ionicons name="checkmark" size={16} color="#FFF"/>}</View>
        </TapChoice>;
      })}</View>
      <AuthField label={split ? 'College email' : 'Full college email'} icon="mail-outline"
        placeholder={split ? 'firstname.lastname2024' : 'firstname.lastname2024@iem.edu.in'} suffix={split ? suffix : undefined}
        value={local} onChangeText={typeEmail} editable={!busy} autoCapitalize="none" autoCorrect={false}
        keyboardType="email-address" autoComplete="email"/>
      <View style={s.badgeCard}><View style={s.badge}><VerifiedBadge size={25}/></View><View style={s.copy}>
        <Text style={s.badgeTitle}>Your college, verified</Text><Text style={s.note}>Step 1 of the blue badge · Unlimited chat · 5 Roses each week</Text>
      </View></View>
    </>}
    {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={auth.error}>{error}</Text>}
    <AuthAction label="Send code" onPress={onSend} busy={busy} disabled={loading || !!loadError || !institutionCode || !email.trim()}/>
  </AuthEntryFrame>;
}

const s = StyleSheet.create({
  title: {fontSize: 40, lineHeight: 49, paddingBottom: 6, includeFontPadding: true}, heading: {marginBottom: 26},
  loading: {flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18},
  label: {fontFamily: 'DMSans_500Medium', fontSize: 13, lineHeight: 20, color: '#715365', marginBottom: 10},
  colleges: {gap: 8, marginBottom: 22},
  college: {minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 20, backgroundColor: '#FFFFFFCC', borderWidth: 1.5, borderColor: '#FFFFFF', paddingHorizontal: 16, paddingVertical: 12},
  selected: {borderColor: '#712C48', backgroundColor: '#EEDDE3'},
  collegeName: {flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 14, lineHeight: 21, color: '#352335'},
  radio: {width: 23, height: 23, borderRadius: 12, borderWidth: 1.5, borderColor: '#C9BEC3', alignItems: 'center', justifyContent: 'center'},
  radioSelected: {backgroundColor: '#712C48', borderColor: '#712C48'},
  badgeCard: {flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, backgroundColor: '#E5E8EC', marginBottom: 14},
  badge: {width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#F7FAFF'},
  copy: {flex: 1}, badgeTitle: {fontFamily: 'DMSans_500Medium', fontSize: 14, lineHeight: 21, color: '#352335'},
  note: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, color: '#715365', marginTop: 2},
  later: {alignItems: 'center', justifyContent: 'center', minHeight: 56, marginTop: 16, gap: 4},
  laterNote: {fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 17, color: '#715365', textAlign: 'center'},
  retry: {minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', marginBottom: 12}, pressed: {opacity: 0.6},
});
