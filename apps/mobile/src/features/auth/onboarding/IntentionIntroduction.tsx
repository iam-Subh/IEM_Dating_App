import React, {useEffect, useState} from 'react';
import {Pressable, StatusBar, StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {DATING_INTENTIONS} from '../../../core/profile/profileOptions';
import {useOnboarding} from './useOnboarding';

import {IntentionForm} from './IntentionForm';

export function IntentionIntroduction() {
  const o = useOnboarding();
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState(o.data.seeking ?? '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const valid = DATING_INTENTIONS.some(option => option.id === value);
  useEffect(() => {
    if (!value) return;
    const timer = setTimeout(() => o.draft({seeking: value}), 150);
    return () => clearTimeout(timer);
  }, [value]);
  const next = async () => {
    if (!valid || busy) return;
    setBusy(true); setError('');
    try {await o.save({seeking: value}); o.next('OrientationSelection');}
    catch {setError('Could not save your intention. Try again.');}
    finally {setBusy(false);}
  };
  return <View style={s.page}>
    <StatusBar barStyle="dark-content" backgroundColor="#F2F3EE"/>
    <View style={[s.nav, {paddingTop: insets.top + 8}]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" disabled={busy} onPress={o.back} style={({pressed}) => [s.back, pressed && s.pressed]}><Ionicons name="arrow-back" size={22} color="#352335"/></Pressable>
      <View accessibilityLabel="Stage 3 of 4: Your connections" style={s.progress}>{[0, 1, 2, 3].map(stage => <View key={stage} style={[s.line, stage < 3 && s.activeLine]}/>)}</View>
      <View style={{width: 44}}/>
    </View>
    <IntentionForm value={value} onSelect={value => {setValue(value); setError('');}} busy={busy} disabled={!valid} error={error} onSubmit={next}/>
  </View>;
}

const s = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#F2F3EE'},
  nav: {paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  back: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center'},
  progress: {flexDirection: 'row', gap: 4, width: 92},
  line: {flex: 1, height: 3, borderRadius: 2, backgroundColor: '#E2D8D1'},
  activeLine: {backgroundColor: '#712C48'},
  pressed: {opacity: 0.6},
});
