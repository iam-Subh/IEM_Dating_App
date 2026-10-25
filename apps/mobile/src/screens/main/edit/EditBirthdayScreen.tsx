import {EditSaveFooter} from '../../../components/EditSaveFooter';
import {DateWheel, MONTHS, ROW} from '../../../features/auth/onboarding/BirthdayDateWheel';
import {LinearGradient} from 'expo-linear-gradient';
import {FormTitle, formStyles, f} from '../../../components/ProfileEditForms';
import {ScrollView} from 'react-native';

import React, {useState, useMemo, useRef} from 'react';
import {View, Text, Alert} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {EditScreenHeader} from '../../../components/EditScreenHeader';
import {api} from '../../../services/api';
import {useDispatch} from 'react-redux';
import {updateUser} from '../../../store/authSlice';

export const EditBirthdayScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const { currentBirthday } = route.params || {};

  // Parse existing birthday
  const parseBirthday = (b: string | null) => {
    if (!b) return { day: ['', ''], month: ['', ''], year: ['', '', '', ''] };
    const d = new Date(b);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = String(d.getFullYear());
    return {
      day: [dd[0], dd[1]],
      month: [mm[0], mm[1]],
      year: [yyyy[0], yyyy[1], yyyy[2], yyyy[3]],
    };
  };

  const parsed = useMemo(() => parseBirthday(currentBirthday), [currentBirthday]);
  const [day, setDay] = useState(parsed.day);
  const [month, setMonth] = useState(parsed.month);
  const [year, setYear] = useState(parsed.year);
  const [saving, setSaving] = useState(false);
  const sourceBirthday = useRef(currentBirthday);
  // A preloaded screen can receive a newer saved date when navigation opens it.
  if (sourceBirthday.current !== currentBirthday) {
    sourceBirthday.current = currentBirthday;
    setDay(parsed.day); setMonth(parsed.month); setYear(parsed.year);
  }



const isValidRealDate = (d: string, m: string, y: string) => {
    const dayVal = parseInt(d), monthVal = parseInt(m), yearVal = parseInt(y);
    if (isNaN(dayVal) || isNaN(monthVal) || isNaN(yearVal)) return false;
    if (monthVal < 1 || monthVal > 12) return false;
    const currentYear = new Date().getFullYear();
    if (yearVal < 1920 || yearVal > currentYear) return false;
    const lastDay = new Date(yearVal, monthVal, 0).getDate();
    return dayVal >= 1 && dayVal <= lastDay;
  };

  const calculateAge = (d: string, m: string, y: string) => {
    const bd = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    const today = new Date();
    let age = today.getFullYear() - bd.getFullYear();
    const md = today.getMonth() - bd.getMonth();
    if (md < 0 || (md === 0 && today.getDate() < bd.getDate())) age--;
    return age;
  };

    const d = day.join(''), m = month.join(''), y = year.join('');
  const isValid = d.length === 2 && m.length === 2 && y.length === 4 && isValidRealDate(d, m, y);

  /**
   * After onboarding the birthday can be changed once here; after that only
   * through support, with a photo of an ID (features/auth/GOOGLE_SIGNUP_PLAN.md 6.2).
   */
  const askSupport = async (birthday: string) => {
    const ImagePicker = await import('expo-image-picker');
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (picked.canceled || !picked.assets?.[0]) return;
    setSaving(true);
    try {
      const [ImageManipulator, {File: FileSystemFile, UploadType: FileSystemUploadType}] = await Promise.all([
        import('expo-image-manipulator'), import('expo-file-system'),
      ]);
      const photo = await ImageManipulator.manipulateAsync(picked.assets[0].uri, [{ resize: { width: 1600 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG });
      const ticket = (await api.post('/profile/birthday-requests/upload-url')).data.data;
      const upload = await new FileSystemFile(photo.uri).upload(ticket.uploadUrl, {
        httpMethod: 'PUT', uploadType: FileSystemUploadType.BINARY_CONTENT, mimeType: ticket.contentType,
        headers: { 'Content-Type': ticket.contentType },
      });
      if (upload.status < 200 || upload.status >= 300) throw new Error('The ID photo did not upload. Try again.');
      await api.post('/profile/birthday-requests', { newBirthday: birthday, idObjectKey: ticket.idObjectKey });
      Alert.alert('Sent to support', "We'll check your ID and update your birthday. The photo is deleted once we've decided.");
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Could not send', err.response?.data?.message || err.message || 'Try again.');
    } finally { setSaving(false); }
  };

  const save = async (birthday: string, age: number) => {
    setSaving(true);
    try {
      const response = await api.put('/profile', { birthday, age });
      if (!response.data?.success) throw new Error(response.data?.message || 'Could not save your changes.');
      if (response.data?.success) dispatch(updateUser(response.data.data));
      navigation.goBack();
    } catch (err: any) {
      if (err.response?.data?.code === 'BIRTHDAY_LOCKED') {
        Alert.alert('Birthday already changed', 'You can change your birthday only once in the app. Support can change it again with a photo of your ID.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Send ID to support', onPress: () => void askSupport(birthday) },
        ]);
      } else {
        Alert.alert('Error', err.response?.data?.message || 'Failed to update');
      }
    } finally { setSaving(false); }
  };

  const handleSave = async () => {
    if (!isValid) return;
    const age = calculateAge(d, m, y);
    if (age < 18) { Alert.alert('Error', 'You must be 18 or older.'); return; }
    const birthday = `${y}-${m}-${d}T00:00:00.000Z`;
    Alert.alert('Change your birthday?', "You can change your birthday only once. Make sure it's right.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Change', onPress: () => void save(birthday, age) },
    ]);
  };


  const [moving, setMoving] = useState<Record<string, boolean>>({});
  const days = useMemo(() => [{value: '', label: 'DD'}, ...Array.from({length: 31}, (_, i) => ({value: String(i + 1).padStart(2, '0'), label: String(i + 1)}))], []);
  const months = useMemo(() => [{value: '', label: 'MM'}, ...MONTHS.map((label, i) => ({value: String(i + 1).padStart(2, '0'), label}))], []);
  const years = useMemo(() => [{value: '', label: 'YYYY'}, ...Array.from({length: new Date().getFullYear() - 1919}, (_, i) => ({value: String(new Date().getFullYear() - i), label: String(new Date().getFullYear() - i)}))], []);
  const wheels = [{key: 'day', label: 'Day', value: d, options: days, set: setDay, digits: 2}, {key: 'month', label: 'Month', value: m, options: months, set: setMonth, digits: 2}, {key: 'year', label: 'Year', value: y, options: years, set: setYear, digits: 4}];

  return <View style={formStyles.page}>
    <EditScreenHeader 
        title="Birthday" 
        onCancel={() => navigation.goBack()} 
        onSave={handleSave} 
        saving={saving} 
        saveDisabled={!isValid || Object.values(moving).some(Boolean)}
        hasUnsavedChanges={
          JSON.stringify(day) !== JSON.stringify(parsed.day) ||
          JSON.stringify(month) !== JSON.stringify(parsed.month) ||
          JSON.stringify(year) !== JSON.stringify(parsed.year)
        }
      />
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={formStyles.content} pointerEvents={saving ? 'none' : 'auto'}>
      
      <FormTitle center size={44} subtitle="Only your age appears on your profile.">{'When’s your\nbirthday?'}</FormTitle>
      <View style={{marginTop: 32}}><View pointerEvents="none" style={{position: 'absolute', top: 34 + ROW * 2, left: 0, right: 0, height: ROW, backgroundColor: '#3B2933', borderRadius: 16}}/><View style={{flexDirection: 'row'}}>{wheels.map(wheel => <DateWheel key={wheel.key} dark virtualized={false} label={wheel.label} options={wheel.options} value={wheel.value} disabled={saving} onChange={value => wheel.set(value ? value.padStart(wheel.digits, '0').split('') : Array(wheel.digits).fill(''))} onMoving={value => setMoving(previous => ({...previous, [wheel.key]: value}))}/>)}</View><LinearGradient pointerEvents="none" colors={['#100F0D', '#100F0D00']} style={{position: 'absolute', left: 0, right: 0, top: 34, height: ROW}}/><LinearGradient pointerEvents="none" colors={['#100F0D00', '#100F0D']} style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: ROW}}/></View>
      <Text accessibilityLiveRegion="polite" style={{fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 30, lineHeight: 38, color: '#F3C1CA', textAlign: 'center', marginTop: 18}}>{isValid ? 'You’re ' + calculateAge(d,m,y) : 'Choose your date'}</Text>
      <Text style={[f.note, {textAlign: 'center', marginTop: 12}]}>You must be 18 or older.</Text>
    </ScrollView>
  <EditSaveFooter
      onSave={handleSave}
      saving={saving}
      saveDisabled={!isValid || Object.values(moving).some(Boolean)}
      hasUnsavedChanges={
          JSON.stringify(day) !== JSON.stringify(parsed.day) ||
          JSON.stringify(month) !== JSON.stringify(parsed.month) ||
          JSON.stringify(year) !== JSON.stringify(parsed.year)
        }
    />
  </View>;
};
