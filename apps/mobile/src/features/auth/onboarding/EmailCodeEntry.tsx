import React, {useEffect, useId, useRef, useState} from 'react';
import {View, Text, TextInput, Pressable, StyleSheet} from 'react-native';
import Svg, {Circle, Defs, Ellipse, LinearGradient, Path, Rect, Stop} from 'react-native-svg';
import {AuthEntryFrame, AuthAction, auth} from './AuthEntryFrame';
import {Ionicons} from '@expo/vector-icons';

/** Pink envelope from the earlier "Check your inbox" design. */
function InboxGraphic() {
  const id = `inbox-${useId().replace(/:/g, '')}`;
  return <View accessible={false} pointerEvents="none" style={styles.graphic}>
    <Svg width={144} height={116} viewBox="0 0 144 116" accessible={false}>
      <Defs>
        <LinearGradient id={`${id}-back`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#D9A3BB"/><Stop offset="1" stopColor="#B77796"/>
        </LinearGradient>
        <LinearGradient id={`${id}-front`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#DFB2C6"/><Stop offset="1" stopColor="#BD809E"/>
        </LinearGradient>
      </Defs>
      <Circle cx={68} cy={57} r={47} fill="#EEDFE5"/>
      <Ellipse cx={67} cy={106} rx={56} ry={4} fill="#DCD4CD" opacity={0.5}/>
      <Path d="M13 54 61 20Q68 15 76 20L124 54V96Q124 102 117 102H20Q13 102 13 96Z" fill={`url(#${id}-back)`}/>
      <Rect x={29} y={24} width={78} height={67} rx={9} fill="#FFFDFB" stroke="#DAB9CA" strokeWidth={0.8}/>
      <Rect x={41} y={37} width={40} height={3} rx={1.5} fill="#C99DB2"/>
      <Rect x={41} y={44} width={27} height={3} rx={1.5} fill="#C99DB2"/>
      {[45, 61, 77, 93].map(cx => <Circle key={cx} cx={cx} cy={60} r={2.8} fill="#712C48"/>)}
      <Path d="M13 54 69 84 13 99Z" fill="#CE97B1"/>
      <Path d="M124 54 69 84 124 99Z" fill="#B87998"/>
      <Path d="M13 97 60 72Q68 67 77 72L124 97Q124 103 117 103H20Q13 103 13 97Z" fill={`url(#${id}-front)`}/>
      <Circle cx={119} cy={87} r={16} fill="#712C48" stroke="#F1EDE4" strokeWidth={3}/>
      <Path d="m112 86 5 5 9-10" fill="none" stroke="#FFFDFB" strokeWidth={2.7} strokeLinecap="round" strokeLinejoin="round"/>
      <Circle cx={8} cy={35} r={3} fill="#C194AB"/>
      <Path d="M134 29v8m-4-4h8" fill="none" stroke="#C77FA1" strokeWidth={1.6} strokeLinecap="round"/>
    </Svg>
  </View>;
}

type Props = {
  email: string;
  code: string;
  onChangeCode: (value: string) => void;
  onBack: () => void;
  onVerify: () => void;
  onResend: () => void;
  timer: number;
  verifying: boolean;
  resending: boolean;
  error: string;
  success: boolean;
  additionalFields?: React.ReactNode;
  footer?: React.ReactNode;
  actionLabel?: string;
  verifyDisabled?: boolean;
};

export function EmailCodeEntry(props: Props) {
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const busy = props.verifying || props.resending;
  const seconds = `${Math.floor(props.timer / 60)}:${String(props.timer % 60).padStart(2, '0')}`;
  // The sixth digit sends the code, as typing or pasting it in a banking app does.
  const typedLength = useRef(props.code.length);
  useEffect(() => {
    const before = typedLength.current;
    typedLength.current = props.code.length;
    if (before < 6 && props.code.length === 6 && !props.verifyDisabled && !busy && !props.success) props.onVerify();
  }, [props.code]); // eslint-disable-line react-hooks/exhaustive-deps

  return <AuthEntryFrame
    title={props.success ? 'Email verified' : 'Check your inbox'}
    subtitle={props.success ? 'Your account is ready.' : 'We sent a verification code to'}
    onBack={props.onBack}
    titleStyle={styles.title}
    headingStyle={styles.heading}
    subtitleStyle={styles.subtitle}
    headingGraphic={!props.success ? <InboxGraphic/> : undefined}
    colors={['#F1EDE4', '#F1EDE4', '#F1EDE4']}
    footer={props.footer ?? null}>
    {props.success ? <Text style={styles.hint}>Opening profile setup…</Text> : <>
      <View style={styles.recipient}>
        <Ionicons name="mail-outline" size={19} color="#712C48" accessible={false}/>
        <Text selectable style={styles.email}>{props.email}</Text>
      </View>
      <Pressable onPress={props.onBack} disabled={busy} accessibilityRole="button"
        accessibilityState={{disabled: busy}}
        style={styles.change}>
        {({pressed}) => <Text style={[auth.link, pressed && {opacity: 0.5}]}>Change email</Text>}
      </Pressable>

      <Text style={styles.label}>Enter the 6-digit code</Text>
      <View style={styles.codeRow}>
        <View pointerEvents="none" accessible={false} style={styles.cells}>
          {Array.from({length: 6}, (_, index) => {
            const active = focused && index === Math.min(props.code.length, 5);
            return <View key={index} style={[styles.cell, !!props.code[index] && styles.filled, active && styles.active, !!props.error && styles.invalid]}>
              <Text style={styles.digit}>{props.code[index] || ''}</Text>
              {!props.code[index] && <View style={[styles.mark, active && styles.activeMark]} />}
            </View>;
          })}
        </View>
        <TextInput ref={input} value={props.code}
          onChangeText={value => props.onChangeCode(value.replace(/\D/g, '').slice(0, 6))}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          editable={!busy} keyboardType="number-pad" maxLength={6} autoFocus
          selection={{start: props.code.length, end: props.code.length}}
          autoComplete="one-time-code" textContentType="oneTimeCode"
          accessibilityLabel="6-digit verification code" caretHidden
          selectionColor="transparent" style={styles.nativeInput} />
      </View>
      {props.additionalFields}
      {!!props.error && <Text accessibilityLiveRegion="polite" style={[auth.error, styles.error]}>{props.error}</Text>}
      <AuthAction label={props.actionLabel ?? 'Verify email'} onPress={props.onVerify}
        disabled={props.code.length !== 6 || props.resending || props.verifyDisabled} busy={props.verifying} />
      <View style={styles.resendRow}>
        <Text style={styles.hint}>No code yet?</Text>
        <Pressable accessibilityRole="button" disabled={props.timer > 0 || busy}
          onPress={props.onResend} style={styles.resend}>
          <Text style={[auth.link, (props.timer > 0 || busy) && styles.wait]}>
            {props.resending ? 'Sending…' : props.timer > 0 ? `Resend in ${seconds}` : 'Resend code'}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.spam}>Check your spam folder if the email is missing.</Text>
    </>}
  </AuthEntryFrame>;
}

const styles = StyleSheet.create({
  graphic: {height: 116, marginTop: -10, marginBottom: 10, marginLeft: -8, alignItems: 'flex-start'},
  title: {fontSize: 40, lineHeight: 51, paddingBottom: 0},
  subtitle: {marginTop: 2},
  heading: {marginBottom: 6},
  recipient: {flexDirection: 'row', alignItems: 'center', gap: 8},
  email: {flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 15, lineHeight: 22, color: '#352335'},
  change: {alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', marginBottom: 12, marginLeft: -10, paddingHorizontal: 10, borderRadius: 12},
  label: {fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#715365', marginBottom: 12},
  codeRow: {height: 62, marginBottom: 22},
  cells: {flex: 1, flexDirection: 'row', gap: 8},
  cell: {flex: 1, borderRadius: 15, borderWidth: 1, borderColor: '#D8CFC7', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center'},
  filled: {borderColor: '#C3A2AF'},
  active: {borderWidth: 2, borderColor: '#712C48', backgroundColor: '#FFF8FA'},
  invalid: {borderColor: '#AE2646'},
  digit: {fontFamily: 'DMSans_500Medium', fontSize: 25, color: '#352335'},
  mark: {position: 'absolute', width: 12, height: 2, borderRadius: 1, backgroundColor: '#D8CFC7'},
  activeMark: {backgroundColor: '#712C48'},
  nativeInput: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0, color: 'transparent', backgroundColor: 'transparent', fontSize: 25},
  error: {marginTop: -10},
  resendRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14},
  hint: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 20, color: '#715365'},
  resend: {minHeight: 44, justifyContent: 'center'},
  wait: {color: '#8A7A80'},
  spam: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, color: '#8A7A80', textAlign: 'center', marginTop: 2},
});
