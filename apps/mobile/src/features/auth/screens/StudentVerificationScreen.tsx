import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useDispatch } from 'react-redux';
import { api } from '../../../services/api';
import { setNextRequiredStep, updateUser } from '../../../store/authSlice';

type Institution = { id: string; code: string; name: string; campuses: string[] };

export const StudentVerificationScreen = () => {
  const dispatch = useDispatch();
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [institutionCode, setInstitutionCode] = useState('');
  const [email, setEmail] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/verification/institutions')
      .then((response) => {
        const list = response.data.data as Institution[];
        setInstitutions(list);
        if (list.length === 1) setInstitutionCode(list[0].code);
      })
      .catch((error) => Alert.alert('Cannot load colleges', error.response?.data?.message || 'Try again.'));
  }, []);

  const sendCode = async () => {
    if (!institutionCode || !email.trim()) return;
    setBusy(true);
    try {
      const response = await api.post('/verification/student/send', { institutionCode, email: email.trim().toLowerCase() });
      setChallengeId(response.data.data.challengeId);
      setCode('');
    } catch (error: any) {
      Alert.alert('Cannot send code', error.response?.data?.message || 'Try again.');
    } finally { setBusy(false); }
  };

  const verify = async () => {
    if (!challengeId || code.length !== 6) return;
    setBusy(true);
    try {
      const response = await api.post('/verification/student/verify', {
        institutionCode,
        email: email.trim().toLowerCase(),
        challengeId,
        code,
      });
      dispatch(updateUser({ college: response.data.data.membership.institution.name }));
      dispatch(setNextRequiredStep(response.data.data.onboarding.nextRequiredStep));
    } catch (error: any) {
      Alert.alert('Verification failed', error.response?.data?.message || 'Check the code and try again.');
      setCode('');
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Verify your college</Text>
        <Text style={styles.body}>Use an active college email. Your profile stays hidden until verification is complete.</Text>
        <Text style={styles.label}>College</Text>
        {institutions.map((institution) => (
          <TouchableOpacity key={institution.id} style={[styles.option, institutionCode === institution.code && styles.optionSelected]} onPress={() => { setInstitutionCode(institution.code); setChallengeId(''); }}>
            <Text style={styles.optionText}>{institution.name}</Text>
          </TouchableOpacity>
        ))}
        <Text style={styles.label}>College email</Text>
        <TextInput style={styles.input} value={email} onChangeText={(value) => { setEmail(value); setChallengeId(''); }} autoCapitalize="none" keyboardType="email-address" placeholder="name@college.edu" placeholderTextColor="#777" editable={!busy} />
        {!challengeId ? (
          <TouchableOpacity style={[styles.button, (!institutionCode || !email.trim() || busy) && styles.disabled]} disabled={!institutionCode || !email.trim() || busy} onPress={sendCode}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send code</Text>}
          </TouchableOpacity>
        ) : (
          <>
            <Text style={styles.label}>Six digit code</Text>
            <TextInput style={styles.input} value={code} onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} placeholder="000000" placeholderTextColor="#777" editable={!busy} />
            <TouchableOpacity style={[styles.button, (code.length !== 6 || busy) && styles.disabled]} disabled={code.length !== 6 || busy} onPress={verify}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify membership</Text>}
            </TouchableOpacity>
            <TouchableOpacity disabled={busy} onPress={sendCode}><Text style={styles.link}>Send a new code</Text></TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 28, paddingTop: 64 },
  title: { color: '#fff', fontSize: 32, fontWeight: '700', marginBottom: 12 },
  body: { color: '#bbb', fontSize: 16, lineHeight: 23, marginBottom: 28 },
  label: { color: '#eee', fontSize: 14, fontWeight: '600', marginTop: 18, marginBottom: 8 },
  option: { borderWidth: 1, borderColor: '#444', borderRadius: 14, padding: 16, marginBottom: 10 },
  optionSelected: { borderColor: '#E84A3B', backgroundColor: '#24110f' },
  optionText: { color: '#fff', fontSize: 16 },
  input: { color: '#fff', borderWidth: 1, borderColor: '#555', borderRadius: 14, padding: 16, fontSize: 16 },
  button: { backgroundColor: '#E84A3B', borderRadius: 28, minHeight: 56, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  disabled: { opacity: 0.45 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  link: { color: '#fff', textAlign: 'center', marginTop: 20, textDecorationLine: 'underline' },
});
