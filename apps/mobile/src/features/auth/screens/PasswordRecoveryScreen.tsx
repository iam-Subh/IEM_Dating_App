import React, { useState } from 'react';
import { ActivityIndicator, Alert, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api } from '../../../services/api';

export const PasswordRecoveryScreen = () => {
  const navigation = useNavigation<any>();
  const [email, setEmail] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const response = await api.post('/auth/recovery/start', { email: email.trim().toLowerCase() });
      setChallengeId(response.data.data.challengeId);
    } catch (error: any) {
      Alert.alert('Cannot start recovery', error.response?.data?.message || 'Try again.');
    } finally { setBusy(false); }
  };

  const complete = async () => {
    setBusy(true);
    try {
      await api.post('/auth/recovery/complete', {
        email: email.trim().toLowerCase(), challengeId, code, newPassword: password,
      });
      Alert.alert('Password changed', 'Sign in with your new password.', [
        { text: 'Continue', onPress: () => navigation.navigate('Login', { initialForm: 'email' }) },
      ]);
    } catch (error: any) {
      Alert.alert('Recovery failed', error.response?.data?.message || 'Check the code and try again.');
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.content}>
        <Text style={styles.title}>Recover password</Text>
        <Text style={styles.body}>Enter the email address for your account.</Text>
        <TextInput style={styles.input} value={email} onChangeText={(value) => { setEmail(value); setChallengeId(''); }} placeholder="name2024@iem.edu.in" placeholderTextColor="#777" keyboardType="email-address" autoCapitalize="none" editable={!busy} />
        {challengeId ? (
          <>
            <TextInput style={styles.input} value={code} onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))} placeholder="Six digit code" placeholderTextColor="#777" keyboardType="number-pad" editable={!busy} />
            <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="New password" placeholderTextColor="#777" secureTextEntry editable={!busy} />
            <TouchableOpacity style={[styles.button, (code.length !== 6 || password.length < 8 || busy) && styles.disabled]} disabled={code.length !== 6 || password.length < 8 || busy} onPress={complete}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Change password</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={[styles.button, (!email.trim() || busy) && styles.disabled]} disabled={!email.trim() || busy} onPress={start}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send recovery code</Text>}
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#090909' },
  content: { flex: 1, justifyContent: 'center', padding: 28 },
  title: { color: '#fff', fontSize: 32, fontWeight: '700', marginBottom: 12 },
  body: { color: '#bbb', fontSize: 16, marginBottom: 24 },
  input: { color: '#fff', borderWidth: 1, borderColor: '#555', borderRadius: 14, padding: 16, fontSize: 16, marginBottom: 14 },
  button: { backgroundColor: '#E84A3B', borderRadius: 28, minHeight: 56, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  disabled: { opacity: 0.45 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
