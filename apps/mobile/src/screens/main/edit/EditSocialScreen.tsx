import {EditSaveFooter} from '../../../components/EditSaveFooter';
import {EditTapChoice} from '../../../components/ProfileEditDesign';
import {Ionicons} from '@expo/vector-icons';
import {SocialArt} from '../../../features/auth/onboarding/OnboardingFormArtwork';
import {FormTitle, FormSheet, formStyles, f} from '../../../components/ProfileEditForms';

import React, {useEffect, useRef, useState} from 'react';
import {View, Text, ScrollView, Alert, TextInput, Keyboard, KeyboardAvoidingView, Platform} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {EditScreenHeader} from '../../../components/EditScreenHeader';
import {ClubSelectionGrid} from '../../../components/ClubSelectionGrid';
import {api} from '../../../services/api';
import {useDispatch} from 'react-redux';
import {updateUser} from '../../../store/authSlice';

export const EditSocialScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const { currentClubs, currentAttendanceMood, currentHangoutSpot } = route.params || {};

  const [selectedClubs, setSelectedClubs] = useState<string[]>(currentClubs || []);
  const [hangoutSpot, setHangoutSpot] = useState(currentHangoutSpot || '');
  const [saving, setSaving] = useState(false);
  const placeInput = useRef<TextInput>(null);
  const blurPlaceInput = () => {
    placeInput.current?.blur();
    Keyboard.dismiss();
  };

  useEffect(() => {
    if (route.params?.clubSelection) setSelectedClubs(route.params.clubSelection);
  }, [route.params?.clubSelection]);


const handleSave = async () => {
    setSaving(true);
    try {
      const data: any = { clubs: selectedClubs };
      if (hangoutSpot) data.hangoutSpots = [hangoutSpot];
      const response = await api.put('/profile', data);
      if (!response.data?.success) throw new Error(response.data?.message || 'Could not save your changes.');
      if (response.data?.success) dispatch(updateUser(response.data.data));
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to update');
    } finally { setSaving(false); }
  };

  const [clubsOpen, setClubsOpen] = useState(false);
  const openClubs = () => {
    if (Platform.OS === 'web') setClubsOpen(true);
    else navigation.navigate('ProfileClubSelection', {selectedClubs, returnKey: route.key});
  };
  return <View style={formStyles.page} onTouchStart={blurPlaceInput}>
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
    <KeyboardAvoidingView style={formStyles.body} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView keyboardShouldPersistTaps="never" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false} contentContainerStyle={formStyles.content} pointerEvents={saving ? 'none' : 'auto'}>
      
      <FormTitle>{'Life beyond\nthe classroom.'}</FormTitle>
      <Text style={[f.choiceLabel, {marginTop: 22, marginBottom: 10}]}>Your college clubs</Text>
      <EditTapChoice disabled={saving} onPress={openClubs} style={f.field}><View style={f.flex}><Text style={f.choiceLabel}>{selectedClubs.length ? 'Edit clubs' : 'Add a club'}</Text><Text style={f.detail}>{selectedClubs.length ? selectedClubs.length + ' selected' : 'Choose up to 5.'}</Text></View><Ionicons name="add-circle-outline" size={28} color="#F3C1CA"/></EditTapChoice>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>{selectedClubs.map(club => <EditTapChoice key={club} disabled={saving} accessibilityLabel={'Remove ' + club} onPress={() => setSelectedClubs(selectedClubs.filter(value => value !== club))} style={{minHeight: 40, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: '#3B2933', flexDirection: 'row', alignItems: 'center', gap: 7}}><Text style={f.link}>{club}</Text><Ionicons name="close" size={14} color="#F3C1CA"/></EditTapChoice>)}</View>
      <Text style={[f.choiceLabel, {marginTop: selectedClubs.length ? 12 : 4, marginBottom: 10}]}>Find me at…</Text>
      <View onTouchStart={event => event.stopPropagation()} style={[f.field, {height: 104, overflow: 'hidden'}]}><View pointerEvents="none" style={{width: 58, height: 62}}><SocialArt kind={4}/></View><View style={[f.flex, {minWidth: 0}]}><TextInput ref={placeInput} accessibilityLabel="Place name" value={hangoutSpot} onChangeText={setHangoutSpot} editable={!saving} placeholder="A café, canteen, or favourite spot." placeholderTextColor="#9D958F" maxLength={100} multiline scrollEnabled textAlignVertical="top" style={[f.fieldValue, {height: 50, paddingVertical: 2}]}/></View></View>
      {Platform.OS === 'web' && <FormSheet visible={clubsOpen} title="Your college clubs" onClose={() => setClubsOpen(false)}><ClubSelectionGrid selected={selectedClubs} onChange={setSelectedClubs} disabled={saving} lightCards compactHeading/></FormSheet>}
    </ScrollView>
    </KeyboardAvoidingView>
    <EditSaveFooter onSave={handleSave} saving={saving}
      hasUnsavedChanges={
        selectedClubs.length !== (currentClubs || []).length ||
        selectedClubs.some(c => !(currentClubs || []).includes(c)) ||
        hangoutSpot !== (currentHangoutSpot || '')
      }/>
  </View>;
};
