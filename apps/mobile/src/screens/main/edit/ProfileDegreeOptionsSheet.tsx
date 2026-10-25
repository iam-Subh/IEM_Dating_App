import React, {useEffect, useRef, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {CommonActions, useNavigation, useRoute} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import {EditTapChoice, editColors as c} from '../../../components/ProfileEditDesign';
import {ConnectionSheetHeader} from '../../../features/auth/onboarding/ConnectionDesign';
import {DEGREE_OPTIONS} from '../../../core/profile/profileOptions';

export function DegreeOptionList({degrees, selected, currentDegree, onSelect}: {
  degrees: readonly string[]; selected: string; currentDegree?: string; onSelect: (value: string) => void;
}) {
  return <>{degrees.map(value => {
    const checked = selected === value;
    return <EditTapChoice key={value} accessibilityRole="radio" accessibilityLabel={value} accessibilityState={{checked}}
      onPress={() => onSelect(value)} style={[s.option, checked && s.optionSelected]}>
      <Text style={s.optionText}>{value}{value === currentDegree && !DEGREE_OPTIONS.some(entry => entry === value) ? '  (current)' : ''}</Text>
      <View style={[s.radio, checked && s.radioSelected]}>{checked && <Ionicons name="checkmark" size={15} color={c.onAccent}/>}</View>
    </EditTapChoice>;
  })}</>;
}

export function ProfileDegreeOptionsSheet() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<string>(route.params?.selected || '');
  const selecting = useRef(false);
  const dismissFrame = useRef<number | null>(null);
  useEffect(() => () => {
    if (dismissFrame.current !== null) cancelAnimationFrame(dismissFrame.current);
  }, []);
  const choose = (value: string) => {
    if (selecting.current || !route.params?.returnKey) return;
    selecting.current = true;
    setSelected(value);
    navigation.dispatch({
      ...CommonActions.setParams({studyDegreeSelection: {value}}),
      source: route.params.returnKey,
    });
    dismissFrame.current = requestAnimationFrame(() => navigation.goBack());
  };
  return <View style={s.page}>
    <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      contentContainerStyle={[s.content, {paddingBottom: Math.max(insets.bottom, 18) + 18}]}>
      <ConnectionSheetHeader dark title="Degree type" onClose={() => navigation.goBack()} style={s.header}/>
      <DegreeOptionList degrees={route.params?.degrees || DEGREE_OPTIONS} selected={selected}
        currentDegree={route.params?.currentDegree} onSelect={choose}/>
    </ScrollView>
  </View>;
}

const s = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#242321'},
  content: {paddingHorizontal: 24, paddingTop: 18, gap: 8},
  header: {marginBottom: 6},
  option: {minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, backgroundColor: '#1D1C1A'},
  optionSelected: {backgroundColor: c.selected},
  optionText: {flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 15, lineHeight: 22, color: c.text},
  radio: {width: 23, height: 23, borderRadius: 12, borderWidth: 1.5, borderColor: c.hint, alignItems: 'center', justifyContent: 'center'},
  radioSelected: {backgroundColor: c.accent, borderColor: c.accent},
});
