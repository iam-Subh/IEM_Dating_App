import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Animated,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { EditScreenHeader } from '../../../components/EditScreenHeader';
import { api } from '../../../services/api';
import { useDispatch } from 'react-redux';
import { updateUser } from '../../../store/authSlice';

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

  const parsed = parseBirthday(currentBirthday);
  const [day, setDay] = useState(parsed.day);
  const [month, setMonth] = useState(parsed.month);
  const [year, setYear] = useState(parsed.year);
  const [saving, setSaving] = useState(false);

  const dayRefs = useRef<Array<TextInput | null>>([]);
  const monthRefs = useRef<Array<TextInput | null>>([]);
  const yearRefs = useRef<Array<TextInput | null>>([]);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, friction: 8, useNativeDriver: true }),
    ]).start();
  }, []);

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

  const handleKeyPress = (e: any, index: number, type: 'day' | 'month' | 'year') => {
    const key = e.nativeEvent.key;

    if (/^\d$/.test(key)) {
      updateDigit(key, index, type);
      return;
    }

    if (key === 'Backspace') {
      if (type === 'day' && index > 0 && !day[index]) dayRefs.current[index - 1]?.focus();
      else if (type === 'month') {
        if (index > 0 && !month[index]) monthRefs.current[index - 1]?.focus();
        else if (index === 0 && !month[index]) dayRefs.current[1]?.focus();
      } else if (type === 'year') {
        if (index > 0 && !year[index]) yearRefs.current[index - 1]?.focus();
        else if (index === 0 && !year[index]) monthRefs.current[1]?.focus();
      }
    }
  };

  const updateDigit = (val: string, index: number, type: 'day' | 'month' | 'year') => {
    const digits = val.replace(/[^0-9]/g, '');
    if (!digits && val !== '') return;

    const currentDigit = type === 'day' ? day[index] : type === 'month' ? month[index] : year[index];
    let digit = digits;

    // A filled input can briefly contain the old and new digits. Keep the new one.
    if (digits.length > 1) {
      digit = currentDigit && digits.startsWith(currentDigit)
        ? digits.slice(-1)
        : digits.charAt(0);
    }
    if (type === 'day') {
      if (index === 0 && parseInt(digit) > 3) return;
      const n = [...day]; n[index] = digit; setDay(n);
      if (digit && !currentDigit && index < 1) dayRefs.current[index + 1]?.focus();
      else if (digit && !currentDigit && index === 1) monthRefs.current[0]?.focus();
    } else if (type === 'month') {
      if (index === 0 && parseInt(digit) > 1) return;
      const n = [...month]; n[index] = digit; setMonth(n);
      if (digit && !currentDigit && index < 1) monthRefs.current[index + 1]?.focus();
      else if (digit && !currentDigit && index === 1) yearRefs.current[0]?.focus();
    } else {
      if (index === 0 && parseInt(digit) > 2) return;
      const n = [...year]; n[index] = digit; setYear(n);
      if (digit && !currentDigit && index < 3) yearRefs.current[index + 1]?.focus();
    }
  };

  const d = day.join(''), m = month.join(''), y = year.join('');
  const isValid = d.length === 2 && m.length === 2 && y.length === 4 && isValidRealDate(d, m, y);

  const handleSave = async () => {
    if (!isValid) return;
    const age = calculateAge(d, m, y);
    if (age < 18) { Alert.alert('Error', 'You must be 18 or older.'); return; }
    setSaving(true);
    try {
      const birthday = `${y}-${m}-${d}T00:00:00.000Z`;
      const response = await api.put('/profile', { birthday, age });
      if (response.data?.success) dispatch(updateUser(response.data.data));
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to update');
    } finally { setSaving(false); }
  };

  return (
    <View style={styles.container}>
      <EditScreenHeader 
        title="Birthday" 
        onCancel={() => navigation.goBack()} 
        onSave={handleSave} 
        saving={saving} 
        saveDisabled={!isValid}
        hasUnsavedChanges={
          JSON.stringify(day) !== JSON.stringify(parsed.day) ||
          JSON.stringify(month) !== JSON.stringify(parsed.month) ||
          JSON.stringify(year) !== JSON.stringify(parsed.year)
        }
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <Text style={styles.title}>Your b-day?</Text>
          <View style={styles.dateInputContainer}>
            {day.map((d, i) => (
              <TextInput key={`d${i}`} ref={r => { dayRefs.current[i] = r; }} style={styles.digitInput} keyboardType="number-pad" maxLength={1} value={d} onChangeText={v => updateDigit(v, i, 'day')} onKeyPress={e => handleKeyPress(e, i, 'day')} placeholder="D" placeholderTextColor="rgba(255,255,255,0.2)" selectionColor="#FFF" />
            ))}
            <Text style={styles.separator}>/</Text>
            {month.map((m, i) => (
              <TextInput key={`m${i}`} ref={r => { monthRefs.current[i] = r; }} style={styles.digitInput} keyboardType="number-pad" maxLength={1} value={m} onChangeText={v => updateDigit(v, i, 'month')} onKeyPress={e => handleKeyPress(e, i, 'month')} placeholder="M" placeholderTextColor="rgba(255,255,255,0.2)" selectionColor="#FFF" />
            ))}
            <Text style={styles.separator}>/</Text>
            {year.map((y, i) => (
              <TextInput key={`y${i}`} ref={r => { yearRefs.current[i] = r; }} style={styles.digitInput} keyboardType="number-pad" maxLength={1} value={y} onChangeText={v => updateDigit(v, i, 'year')} onKeyPress={e => handleKeyPress(e, i, 'year')} placeholder="Y" placeholderTextColor="rgba(255,255,255,0.2)" selectionColor="#FFF" />
            ))}
          </View>
          <Text style={styles.note}>Your profile shows your age, not your date of birth.</Text>
          <Text style={styles.requirementText}>* You must be at least 18 years old</Text>
          {isValid && (
            <Text style={styles.ageDisplay}>
              Age: {calculateAge(d, m, y)}
            </Text>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F1115' },
  content: { flex: 1, padding: 20 },
  title: { fontSize: 30, fontWeight: '800', color: '#FFF', marginBottom: 40 },
  dateInputContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 30 },
  digitInput: { fontSize: 26, color: '#FFF', fontWeight: '600', width: 34, height: 50, textAlign: 'center', borderBottomWidth: 2, borderBottomColor: 'rgba(255,255,255,0.5)', padding: 0, includeFontPadding: false, textAlignVertical: 'center' },
  separator: { fontSize: 24, color: 'rgba(255,255,255,0.3)', marginHorizontal: 4 },
  note: { fontSize: 14, color: 'rgba(255,255,255,0.4)', fontWeight: '500', textAlign: 'center' },
  requirementText: { fontSize: 13, color: '#F94E27', fontWeight: '600', marginTop: 10, textAlign: 'center' },
  ageDisplay: {
    fontSize: 20,
    color: "#FFF",
    fontWeight: "700",
    marginTop: 12,
    textAlign: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 15,
    alignSelf: "center",
  },
});
