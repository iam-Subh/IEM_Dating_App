import React from 'react';
import {ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Svg, {Path} from 'react-native-svg';
import {DATING_INTENTIONS} from '../../../core/profile/profileOptions';
import {TapChoice} from './ConnectionDesign';
import {EditSaveFooter} from '../../../components/EditSaveFooter';
import {intentionCopy as copy, IntentionArt} from './OnboardingFormArtwork';

const palettes = {
  light: {canvas: '#F2F3EE', text: '#352335', muted: '#715365', surface: '#FFFFFF', line: '#E7E3DF', selected: '#F0DEE4', accent: '#712C48', onAccent: '#FFF7FA', radio: '#CEBFC6', error: '#AE2646'},
  dark: {canvas: '#100F0D', text: '#FAF7F2', muted: '#BDB5AF', surface: '#242321', line: '#242321', selected: '#3B2933', accent: '#F3C1CA', onAccent: '#331C23', radio: '#847A7C', error: '#FFAFBA'},
};

/** The same content layout serves onboarding and the profile intention editor. */
export function IntentionForm({value, onSelect, onSubmit, busy, disabled, error = '', dark = false}: {
  value: string | null; onSelect: (value: string) => void; onSubmit: () => void;
  busy: boolean; disabled: boolean; error?: string; dark?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const {height, width, fontScale} = useWindowDimensions();
  const compact = height < 760;
  const singleColumn = width < 340 || fontScale > 1.3;
  const c = dark ? palettes.dark : palettes.light;
  const ChoiceControl = dark ? TapChoice : Pressable;
  return <View style={s.body}>
    <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={[s.content, compact && {paddingTop: 12}]}>
      <Text accessibilityRole="header" style={[s.title, {color: c.text}, compact && {fontSize: 36, lineHeight: 42}]}>What brings{'\n'}you here?</Text>
      {!dark && <Text style={[s.subtitle, {color: c.muted}]}>Choose what feels right for you.</Text>}
      <View accessibilityRole="radiogroup" style={s.grid}>
        {DATING_INTENTIONS.map(option => {
          const item = copy[option.id], selected = value === option.id;
          return <ChoiceControl key={option.id} accessibilityRole="radio" accessibilityLabel={`${item.title}. ${item.detail}`} accessibilityState={{checked: selected, disabled: busy}} aria-checked={selected} disabled={busy} unstable_pressDelay={0} onPress={() => onSelect(option.id)} style={({pressed}) => [s.card, {backgroundColor: selected || pressed ? c.selected : c.surface, borderColor: selected ? c.accent : c.line}, compact && s.compactCard, singleColumn && {width: '100%'}]}>
            <View style={s.cardTop}><IntentionArt kind={item.art}/><View style={[s.radio, {borderColor: selected ? c.accent : c.radio, backgroundColor: selected ? c.accent : 'transparent'}]}>{selected && <Svg width={16} height={16} viewBox="0 0 24 24" accessible={false}><Path d="M5 12.5L9 16.5Q10.5 18 12 16L19 7" fill="none" stroke={dark ? c.onAccent : '#FFFFFF'} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/></Svg>}</View></View>
            <Text style={[s.cardTitle, {color: c.text}]}>{item.title}</Text>
            <Text style={[s.detail, {color: c.muted}]}>{item.detail}</Text>
          </ChoiceControl>;
        })}
      </View>
    </ScrollView>
    {dark ? <EditSaveFooter onSave={onSubmit} saving={busy} saveDisabled={disabled} error={error}/> : <View style={[s.footer, {backgroundColor: c.canvas, paddingBottom: Math.max(insets.bottom, 16) + 12}]}>
      {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[s.error, {color: c.error}]}>{error}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel={dark ? 'Save changes' : 'Continue'} accessibilityState={{disabled: disabled || busy, busy}} disabled={disabled || busy} onPress={onSubmit} style={({pressed}) => [s.next, {backgroundColor: c.accent}, (disabled || busy) && {opacity: 0.45}, pressed && s.pressed]}>
        {dark && busy ? <ActivityIndicator color={c.onAccent}/> : <Text style={[s.nextText, {color: c.onAccent}]}>{dark ? 'Save' : 'Continue'}</Text>}
      </Pressable>
    </View>}
  </View>;
}

const s = StyleSheet.create({
  body: {flex: 1},
  content: {paddingHorizontal: 24, paddingTop: 18, paddingBottom: 12, maxWidth: 500, width: '100%', alignSelf: 'center'},
  title: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 40, lineHeight: 47, paddingBottom: 6, textAlign: 'center'},
  subtitle: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 2},
  grid: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginTop: 18},
  card: {width: '48.4%', minHeight: 136, padding: 11, borderRadius: 20, borderWidth: 1.5},
  compactCard: {minHeight: 132, padding: 11},
  cardTop: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6},
  radio: {width: 20, height: 20, borderRadius: 10, borderWidth: 1.3, alignItems: 'center', justifyContent: 'center'},
  cardTitle: {fontFamily: 'DMSans_700Bold', fontSize: 14, lineHeight: 19},
  detail: {fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 16, marginTop: 4},
  footer: {paddingTop: 10, paddingHorizontal: 24},
  next: {alignSelf: 'center', minWidth: 132, minHeight: 50, paddingHorizontal: 28, borderRadius: 25, alignItems: 'center', justifyContent: 'center'},
  nextText: {fontFamily: 'DMSans_500Medium', fontSize: 17},
  error: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center', marginBottom: 10},
  pressed: {opacity: 0.6},
});
