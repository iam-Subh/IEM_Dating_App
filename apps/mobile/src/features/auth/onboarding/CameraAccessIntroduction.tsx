import React, {useState} from 'react';
import {ActivityIndicator, Image, StatusBar, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import Svg, {Defs, G, LinearGradient, Path, Rect, Stop} from 'react-native-svg';
import {TapChoice, connectionColors as c, connectionStyles as shared} from './ConnectionDesign';

type Access = {granted: boolean; canAskAgain: boolean} | null;
type Props = {
  camera: Access; microphone: Access;
  onAllow: () => Promise<string | void>; onBack: () => void; onLibrary: () => void;
};

function MicrophoneArt() {
  return <Svg width={78} height={108} viewBox="0 0 78 108" accessible={false}>
    <Defs><LinearGradient id="access-mic" x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor="#769E95"/><Stop offset="0.45" stopColor="#C5DBD3"/><Stop offset="1" stopColor="#789F95"/></LinearGradient></Defs>
    <G transform="rotate(8 39 54)">
      <Rect x="24" y="8" width="30" height="57" rx="15" fill="url(#access-mic)" stroke="#689184" strokeWidth="1.5"/>
      <Path d="M32 22H46M32 30H46M32 38H46" stroke="#64877D" strokeWidth="2" strokeLinecap="round"/>
      <Path d="M17 47V53C17 83 61 83 61 53V47M39 78V94M25 95H53" fill="none" stroke="#52766B" strokeWidth="5" strokeLinecap="round"/>
      <Path d="M28 52V55C28 61 32 64 38 64" fill="none" stroke="#E4F0E9" strokeWidth="2" strokeLinecap="round"/>
    </G>
  </Svg>;
}

function PermissionRow({name, note, access, icon}: {name: string; note: string; access: Access; icon: 'camera-outline' | 'mic-outline'}) {
  const blocked = !access?.granted && access?.canAskAgain === false;
  return <View style={[s.permission, blocked && {borderColor: '#D9A2AF'}]}>
    <View style={[s.permissionIcon, name === 'Microphone' && {backgroundColor: '#E3EDE5'}]}><Ionicons name={icon} size={23} color={name === 'Microphone' ? '#52766B' : c.primary}/></View>
    <View style={{flex: 1}}><Text style={s.permissionTitle}>{name}</Text><Text style={s.permissionNote}>{note}</Text></View>
    {!access ? <ActivityIndicator size="small" color={c.primary}/> : access.granted ? <View accessibilityLabel={`${name} allowed`} style={s.allowed}><Svg width={17} height={17} viewBox="0 0 24 24"><Path d="M5 12L10 17L19 7" stroke="#FFF" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none"/></Svg></View> : <Text style={[s.status, blocked && {color: '#AE2646'}]}>{blocked ? 'Blocked' : 'Needed'}</Text>}
  </View>;
}

export function CameraAccessIntroduction(p: Props) {
  const insets = useSafeAreaInsets();
  const {height} = useWindowDimensions();
  const compact = height < 740;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const loading = !p.camera || !p.microphone;
  const blocked = (!p.camera?.granted && p.camera?.canAskAgain === false) || (!p.microphone?.granted && p.microphone?.canAskAgain === false);
  const allow = async () => {
    if (busy || loading) return;
    setBusy(true); setError('');
    try {const message = await p.onAllow(); if (message) setError(message);}
    catch {setError('Could not open permissions. Try again or choose a video from your library.');}
    finally {setBusy(false);}
  };
  return <View style={shared.page}>
    <StatusBar barStyle="dark-content" backgroundColor={c.canvas}/>
    <View style={[s.nav, {paddingTop: insets.top + 8}]}>
      <TapChoice disabled={busy} accessibilityRole="button" accessibilityLabel="Back to your profile video" onPress={p.onBack} style={({pressed}) => [shared.back, pressed && shared.pressed]}><Ionicons name="arrow-back" size={22} color={c.text}/></TapChoice>
      <Text style={s.navLabel}>PROFILE VIDEO</Text><View style={{width: 44}}/>
    </View>
    <View style={[s.content, compact && {paddingTop: 8}]}>
      <View pointerEvents="none" style={[s.art, compact && {height: 100}]}>
        <Image source={require('../../../../assets/illustrations/profile-camera-3d.png')} resizeMode="contain" style={s.camera}/>
        <View style={s.microphone}><MicrophoneArt/></View>
        <Svg width={42} height={58} viewBox="0 0 42 58" style={s.sound} accessible={false}><Path d="M7 22V36M18 14V44M29 20V38" stroke="#CCA0B2" strokeWidth="4" strokeLinecap="round"/></Svg>
      </View>
      <Text accessibilityRole="header" style={[shared.title, s.title, compact && {fontSize: 34, lineHeight: 37}]}>{'Camera and\nmicrophone.'}</Text>
      <Text style={shared.subtitle}>Allow access to record your video introduction.</Text>
      <View style={[s.permissions, compact && {marginTop: 18}]}>
        <PermissionRow name="Camera" note="Record your face on video." access={p.camera} icon="camera-outline"/>
        <PermissionRow name="Microphone" note="Add your voice to the video." access={p.microphone} icon="mic-outline"/>
      </View>
      <View style={s.notice}><Ionicons name="information-circle-outline" size={17} color={c.muted}/><Text style={s.noticeText}>{blocked ? 'Enable the blocked permission in app settings.' : 'Nothing records until you tap the record button.'}</Text></View>
    </View>
    <View style={[s.footer, {paddingBottom: Math.max(insets.bottom, 16) + 12}]}>
      {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={shared.error}>{error}</Text>}
      <TapChoice disabled={busy || loading} accessibilityRole="button" accessibilityLabel={blocked ? 'Open app settings' : 'Allow camera and microphone'} accessibilityState={{disabled: busy || loading, busy}} onPress={() => void allow()} style={({pressed}) => [s.primary, (busy || loading) && {opacity: 0.5}, pressed && shared.pressed]}>
        {busy || loading ? <ActivityIndicator color="#FFF"/> : <><Text style={shared.nextText}>{blocked ? 'Open settings' : 'Allow access'}</Text><Ionicons name={blocked ? 'open-outline' : 'arrow-forward'} size={20} color="#FFF"/></>}
      </TapChoice>
      <TapChoice disabled={busy} accessibilityRole="button" accessibilityLabel="Choose a video from your library instead" onPress={p.onLibrary} style={({pressed}) => [s.library, pressed && shared.pressed]}><Ionicons name="images-outline" size={18} color={c.primary}/><Text style={s.libraryText}>Choose from library instead</Text></TapChoice>
    </View>
  </View>;
}

const s = StyleSheet.create({
  nav: {paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  navLabel: {fontFamily: 'DMSans_700Bold', fontSize: 10, letterSpacing: 1.4, color: c.muted},
  content: {flex: 1, paddingHorizontal: 24, paddingTop: 18, width: '100%', maxWidth: 500, alignSelf: 'center'},
  art: {height: 142, flexDirection: 'row', alignItems: 'center', marginBottom: 16},
  camera: {width: 146, height: '100%'},
  microphone: {marginLeft: -8, marginTop: 10},
  sound: {marginLeft: 2, marginTop: 4},
  title: {fontSize: 38, lineHeight: 41, paddingBottom: 8},
  permissions: {gap: 10, marginTop: 26},
  permission: {flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14, minHeight: 80, borderRadius: 22, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E5DEDE'},
  permissionIcon: {width: 44, height: 44, borderRadius: 16, backgroundColor: c.wash, justifyContent: 'center', alignItems: 'center'},
  permissionTitle: {fontFamily: 'DMSans_700Bold', fontSize: 14, lineHeight: 20, color: c.text},
  permissionNote: {fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 17, color: c.muted, marginTop: 3},
  status: {fontFamily: 'DMSans_500Medium', fontSize: 10, color: c.muted},
  allowed: {width: 26, height: 26, borderRadius: 13, backgroundColor: '#52766B', justifyContent: 'center', alignItems: 'center'},
  notice: {flexDirection: 'row', gap: 7, alignItems: 'center', marginTop: 16, paddingHorizontal: 3},
  noticeText: {flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 18, color: c.muted},
  footer: {paddingTop: 12, paddingHorizontal: 24, backgroundColor: c.canvas},
  primary: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 50, borderRadius: 25, backgroundColor: c.primary},
  library: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, marginTop: 8},
  libraryText: {fontFamily: 'DMSans_500Medium', fontSize: 12, color: c.primary},
});
