import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, ScrollView, Alert, TextInput, Dimensions, KeyboardAvoidingView, Platform } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { EditScreenHeader } from '../../../components/EditScreenHeader';
import { api } from '../../../services/api';
import { useDispatch } from 'react-redux';
import { updateUser } from '../../../store/authSlice';

const { width } = Dimensions.get('window');
const CLUBS = ['Robotics', 'Tech/Coding', 'Music/Band', 'Dance', 'Drama', 'Sports', 'Photography', 'Debate'];

export const EditSocialScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const { currentClubs, currentAttendanceMood, currentHangoutSpot } = route.params || {};

  const [selectedClubs, setSelectedClubs] = useState<string[]>(currentClubs || []);
  const [hangoutSpot, setHangoutSpot] = useState(currentHangoutSpot || '');
  const [saving, setSaving] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, friction: 8, useNativeDriver: true }),
    ]).start();
  }, []);

  const toggleClub = (club: string) => {
    if (selectedClubs.includes(club)) setSelectedClubs(selectedClubs.filter(c => c !== club));
    else if (selectedClubs.length < 5) setSelectedClubs([...selectedClubs, club]);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const data: any = { clubs: selectedClubs };
      if (hangoutSpot) data.hangoutSpots = [hangoutSpot];
      const response = await api.put('/profile', data);
      if (response.data?.success) dispatch(updateUser(response.data.data));
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to update');
    } finally { setSaving(false); }
  };

  return (
    <View style={styles.container}>
      <EditScreenHeader 
        title="Social & Vibes" 
        onCancel={() => navigation.goBack()} 
        onSave={handleSave} 
        saving={saving} 
        hasUnsavedChanges={
          selectedClubs.length !== (currentClubs || []).length ||
          selectedClubs.some(c => !(currentClubs || []).includes(c)) ||
          hangoutSpot !== (currentHangoutSpot || '')
        }
      />
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
      >
        <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <ScrollView 
            showsVerticalScrollIndicator={false} 
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.title}>Social & Vibes</Text>
            <Text style={styles.subtitle}>Relatable IEM things to start the conversation.</Text>

            <Text style={styles.sectionLabel}>IEM Clubs (Max 5)</Text>
            <View style={styles.chipsContainer}>
              {CLUBS.map(club => (
                <TouchableOpacity key={club} style={[styles.chip, selectedClubs.includes(club) && styles.chipSelected]} onPress={() => toggleClub(club)} activeOpacity={0.7}>
                  <Text style={[styles.chipText, selectedClubs.includes(club) && styles.chipTextSelected]}>{club}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.sectionLabel, { marginTop: 15 }]}>Favorite Spot For Dating</Text>
            <View style={styles.inputContainer}>
              <TextInput 
                style={styles.input} 
                placeholder="e.g. RDB chai stall or CCD"
                placeholderTextColor="rgba(255,255,255,0.3)" 
                value={hangoutSpot} 
                onChangeText={setHangoutSpot} 
                multiline
                numberOfLines={2}
                maxLength={100}
                textAlignVertical="top"
              />
            </View>
            <View style={{ height: 100 }} />
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F1115' },
  content: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 30, fontWeight: '800', color: '#FFF', marginBottom: 12 },
  subtitle: { fontSize: 15, color: 'rgba(255,255,255,0.6)', lineHeight: 22, marginBottom: 24 },
  sectionLabel: { fontSize: 14, fontWeight: '700', color: '#F94E27', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 15 },
  chipsContainer: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.2)', margin: 5, backgroundColor: 'rgba(255,255,255,0.03)' },
  chipSelected: { borderColor: '#F94E27', backgroundColor: 'rgba(249, 78, 39, 0.15)' },
  chipText: { color: 'rgba(255,255,255,0.7)', fontSize: 15, fontWeight: '600' },
  chipTextSelected: { color: '#FFF' },
  inputContainer: { 
    backgroundColor: 'rgba(255,255,255,0.05)', 
    borderRadius: 12, 
    borderWidth: 1.5, 
    borderColor: 'rgba(255,255,255,0.1)', 
    paddingHorizontal: 15,
    paddingVertical: 2,
  },
  input: { 
    minHeight: 72,
    maxHeight: 96,
    color: '#FFF', 
    fontSize: 15,
    lineHeight: 21,
    paddingVertical: 13,
    includeFontPadding: false,
    textAlignVertical: 'top',
  },
});
