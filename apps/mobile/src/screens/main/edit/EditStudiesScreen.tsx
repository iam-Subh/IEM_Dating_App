import React, {useLayoutEffect, useRef, useState} from 'react';
import {Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useNavigation, useRoute} from '@react-navigation/native';
import {useDispatch, useSelector} from 'react-redux';
import {EditScreenHeader} from '../../../components/EditScreenHeader';
import {EditSaveFooter} from '../../../components/EditSaveFooter';
import {EditTapChoice, editColors as c} from '../../../components/ProfileEditDesign';
import {FormTitle, formStyles} from '../../../components/ProfileEditForms';
import {DEGREE_OPTIONS} from '../../../core/profile/profileOptions';
import {api} from '../../../services/api';
import {updateUser} from '../../../store/authSlice';
import type {RootState} from '../../../store';
import {formatStudyYear, parseStudies, type StudiesErrors, type StudiesInput} from './studiesModel';
import {DegreeOptionList} from './ProfileDegreeOptionsSheet';

/**
 * Edit profile > Studies, laid out like onboarding's "What do you study?"
 * (AcademicIntroduction): the degree chosen from the same list, then "Your
 * timeline" - graduation year and year of study side by side - with the same
 * checks. In Edit profile's own colours, like the pages around it.
 */
export function EditStudiesScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const {width} = useWindowDimensions();
  const user = useSelector((state: RootState) => state.auth.user);
  const params = route.params || {};
  const saved = (field: string, fallback: unknown) => Object.prototype.hasOwnProperty.call(params, field) ? params[field] : fallback;
  const initial = useRef<StudiesInput>({
    degree: String(saved('currentDegree', user?.degree) ?? '').trim(),
    yearOfStudy: String(saved('currentYearOfStudy', user?.yearOfStudy) ?? ''),
    graduationYear: String(saved('currentGraduationYear', saved('currentBatch', user?.graduationYear)) ?? ''),
  }).current;
  const [input, setInput] = useState(initial);
  const [errors, setErrors] = useState<StudiesErrors>({});
  const [focused, setFocused] = useState<'graduation' | 'current' | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const savingRef = useRef(false);
  const changed = (Object.keys(initial) as (keyof StudiesInput)[]).some(key => input[key].trim() !== initial[key]);
  // A degree saved before the list existed stays choosable, at the top.
  const degrees: string[] = initial.degree && !DEGREE_OPTIONS.some(value => value === initial.degree)
    ? [initial.degree, ...DEGREE_OPTIONS] : [...DEGREE_OPTIONS];

  const change = (field: keyof StudiesInput, value: string) => {
    setInput(previous => ({...previous, [field]: value}));
    setErrors(previous => ({...previous, [field]: undefined}));
    setSaveError('');
  };
  const validateField = (field: keyof StudiesInput) => {
    setErrors(previous => ({...previous, [field]: parseStudies(input).errors[field]}));
  };
  const chooseDegree = (value: string) => {
    change('degree', value);
    setPicking(false);
  };
  const degreeSelection = route.params?.studyDegreeSelection;
  useLayoutEffect(() => {
    if (degreeSelection) chooseDegree(degreeSelection.value);
  }, [degreeSelection]);
  const openDegrees = () => {
    Keyboard.dismiss();
    if (Platform.OS === 'web') setPicking(true);
    else navigation.navigate('ProfileDegreeOptions', {
      selected: input.degree, degrees, currentDegree: initial.degree, returnKey: route.key,
    });
  };
  const save = async () => {
    if (savingRef.current || !changed) return;
    Keyboard.dismiss();
    const parsed = parseStudies(input);
    setErrors(parsed.errors);
    if (Object.keys(parsed.errors).length) return;
    savingRef.current = true;
    setSaving(true); setSaveError('');
    try {
      const response = await api.put('/profile', parsed.values);
      if (!response.data?.success) throw new Error(response.data?.message || 'Could not save your studies.');
      dispatch(updateUser(response.data.data));
      navigation.goBack();
    } catch (cause: any) {
      setSaveError(cause.response?.data?.message || cause.message || 'Please try again.');
    } finally {savingRef.current = false; setSaving(false);}
  };
  const studyYear = input.yearOfStudy && !parseStudies(input).errors.yearOfStudy ? formatStudyYear(Number(input.yearOfStudy)) : '';

  return <View style={formStyles.page}>
    <EditScreenHeader title="Studies" onCancel={() => navigation.goBack()} onSave={save} saving={saving} hasUnsavedChanges={changed}/>
    <KeyboardAvoidingView style={formStyles.body} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false} contentContainerStyle={formStyles.content}>
        <FormTitle center subtitle="Add your degree and when you graduate.">{'What do you\nstudy?'}</FormTitle>

        <View style={s.fields}>
          <EditTapChoice accessibilityLabel={`Degree type: ${input.degree || 'Choose your degree'}`} disabled={saving}
            onPress={openDegrees} style={[s.field, s.choice, errors.degree && s.invalid]}>
            <View style={s.fieldCopy}>
              <Text style={s.label}>Degree type</Text>
              <Text style={[s.value, !input.degree && s.placeholder]}>{input.degree || 'Choose your degree'}</Text>
            </View>
            <Ionicons name="chevron-down" size={18} color={c.accent}/>
          </EditTapChoice>
          {!!errors.degree && <Text accessibilityRole="alert" style={s.error}>{errors.degree}</Text>}
        </View>

        <View style={s.timeline}>
          <Text style={s.sectionLabel}>YOUR TIMELINE</Text>
          <View style={[s.years, width < 360 && s.yearsStack]}>
            <View style={s.yearColumn}>
              <View style={[s.field, focused === 'graduation' && s.focused, errors.graduationYear && s.invalid]}>
                <Text style={s.label}>Graduation year</Text>
                <TextInput accessibilityLabel="Graduation year" editable={!saving} value={input.graduationYear} keyboardType="number-pad" maxLength={4}
                  placeholder="YYYY" placeholderTextColor={c.hint} selectionColor={c.accent}
                  onFocus={() => setFocused('graduation')} onBlur={() => {setFocused(null); validateField('graduationYear');}}
                  onChangeText={value => change('graduationYear', value.replace(/\D/g, ''))} style={s.yearInput}/>
              </View>
              {!!errors.graduationYear && <Text accessibilityRole="alert" style={s.error}>{errors.graduationYear}</Text>}
            </View>
            <View style={s.yearColumn}>
              <View style={[s.field, focused === 'current' && s.focused, errors.yearOfStudy && s.invalid]}>
                <Text style={s.label}>Year of study</Text>
                <TextInput accessibilityLabel="Year of study" editable={!saving} value={input.yearOfStudy} keyboardType="number-pad" maxLength={2}
                  placeholder="e.g. 2" placeholderTextColor={c.hint} selectionColor={c.accent}
                  onFocus={() => setFocused('current')} onBlur={() => {setFocused(null); validateField('yearOfStudy');}}
                  onChangeText={value => change('yearOfStudy', value.replace(/\D/g, ''))} style={s.yearInput}/>
              </View>
              {errors.yearOfStudy
                ? <Text accessibilityRole="alert" style={s.error}>{errors.yearOfStudy}</Text>
                : !!studyYear && <Text style={s.hint}>{studyYear}</Text>}
            </View>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
    <EditSaveFooter onSave={save} saving={saving} hasUnsavedChanges={changed} error={saveError}/>

    {Platform.OS === 'web' && <Modal visible={picking} transparent animationType="slide" onRequestClose={() => setPicking(false)} statusBarTranslucent>
      <Pressable accessibilityLabel="Close degree options" style={s.backdrop} onPress={() => setPicking(false)}/>
      <View style={s.sheet}>
        <View style={s.grabber}/>
        <View style={s.sheetHeader}>
          <Text accessibilityRole="header" style={s.sheetTitle}>Degree type</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close degree options" onPress={() => setPicking(false)} style={({pressed}) => [s.close, pressed && {opacity: 0.6}]}>
            <Ionicons name="close" size={22} color={c.text}/>
          </Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={s.sheetList}>
          <DegreeOptionList degrees={degrees} selected={input.degree} currentDegree={initial.degree} onSelect={chooseDegree}/>
        </ScrollView>
      </View>
    </Modal>}
  </View>;
}

const s = StyleSheet.create({
  fields: {marginTop: 24, gap: 8},
  field: {minHeight: 78, backgroundColor: c.surface, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 12, borderWidth: 1.5, borderColor: c.surface},
  choice: {flexDirection: 'row', alignItems: 'center', gap: 12},
  fieldCopy: {flex: 1},
  label: {fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 16, color: c.muted},
  value: {fontFamily: 'DMSans_500Medium', fontSize: 16, lineHeight: 23, color: c.text, marginTop: 4},
  placeholder: {color: c.hint},
  timeline: {marginTop: 24},
  sectionLabel: {fontFamily: 'DMSans_700Bold', fontSize: 10, letterSpacing: 1.2, color: c.muted, marginBottom: 12},
  years: {flexDirection: 'row', gap: 12},
  yearsStack: {flexDirection: 'column'},
  yearColumn: {flex: 1},
  yearInput: {fontFamily: 'DMSans_500Medium', fontSize: 18, lineHeight: 25, color: c.text, padding: 0, marginTop: 4, minHeight: 28},
  focused: {borderColor: c.accent},
  invalid: {borderColor: '#FFAFBA'},
  hint: {fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 17, color: c.muted, marginTop: 5, marginHorizontal: 4},
  error: {fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 17, color: '#FFAFBA', marginTop: 5, marginHorizontal: 4},
  backdrop: {flex: 1, backgroundColor: 'rgba(0,0,0,0.55)'},
  sheet: {maxHeight: '75%', backgroundColor: c.canvas, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 10, paddingBottom: 28},
  grabber: {alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.elevated, marginBottom: 14},
  sheetHeader: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14},
  sheetTitle: {flex: 1, fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 30, lineHeight: 38, paddingBottom: 4, color: c.text},
  close: {width: 44, height: 44, borderRadius: 22, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center'},
  sheetList: {gap: 8, paddingBottom: 8},
});
