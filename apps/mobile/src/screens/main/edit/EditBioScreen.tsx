import {EditSaveFooter} from '../../../components/EditSaveFooter';
import {Ionicons} from '@expo/vector-icons';
import {ConversationArt} from '../../../features/auth/onboarding/OnboardingFormArtwork';
import {FormTitle, formStyles, f} from '../../../components/ProfileEditForms';
import {EditTapChoice as TouchableOpacity} from '../../../components/ProfileEditDesign';
import React, {useState} from 'react';
import {View, Text, TextInput, Alert, KeyboardAvoidingView, Platform, ScrollView} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {EditScreenHeader} from '../../../components/EditScreenHeader';
import {api} from '../../../services/api';
import {useDispatch} from 'react-redux';
import {updateUser} from '../../../store/authSlice';

export const EditBioScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const { currentBio } = route.params || {};

  const [bio, setBio] = useState(currentBio || '');
  const [saving, setSaving] = useState(false);


const handleSave = async () => {
    setSaving(true);
    try {
      const response = await api.put('/profile', { preferences: { bio: bio.trim() } });
      if (!response.data?.success) throw new Error(response.data?.message || 'Could not save your changes.');
      if (response.data?.success) dispatch(updateUser(response.data.data));
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to update');
    } finally { setSaving(false); }
  };


  return <View style={formStyles.page}>
    <EditScreenHeader 
        title="About Me" 
        onCancel={() => navigation.goBack()} 
        onSave={handleSave} 
        saving={saving} 
        hasUnsavedChanges={bio !== (currentBio || '')}
      />
    <KeyboardAvoidingView style={formStyles.body} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={formStyles.content} pointerEvents={saving ? 'none' : 'auto'}>
      
      <FormTitle art={<ConversationArt/>}>{'A little more\nabout you.'}</FormTitle>
      <View style={{height: 222, marginTop: 24, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 10, borderRadius: 24, backgroundColor: '#242321', overflow: 'hidden'}}>
        <TextInput accessibilityLabel="About me" editable={!saving} multiline scrollEnabled maxLength={500} value={bio} onChangeText={setBio} placeholder="What would someone enjoy knowing about you?" placeholderTextColor="#9D958F" selectionColor="#F3C1CA" textAlignVertical="top" autoCapitalize="sentences" style={{height: 144, padding: 0, fontFamily: 'DMSans_400Regular', fontSize: 17, lineHeight: 26, color: '#FAF7F2'}}/>
        <View style={[f.row, {justifyContent: 'space-between', marginTop: 32}]}><Text style={[f.note, {fontSize: 10}]}>Visible on your profile</Text><Text style={[f.note, {fontSize: 10}]}>{bio.length}/500</Text></View>
      </View>
      <Text style={[f.choiceLabel, {fontSize: 13, marginTop: 22, marginBottom: 10}]}>Need a starting point?</Text>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>{['My perfect Sunday…', 'Ask me about…', 'Together, we could…'].map((starter,index) => <TouchableOpacity key={starter} disabled={saving || !!bio.trim()} onPress={() => setBio(starter + ' ')} style={{minHeight: 42, borderRadius: 24, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#3B2933', opacity: bio.trim() ? 0.45 : 1}}><Ionicons name={(['sunny-outline', 'chatbubble-outline', 'heart-outline'] as const)[index]} size={15} color="#F3C1CA"/><Text style={f.link}>{starter}</Text></TouchableOpacity>)}</View>
    </ScrollView>
    </KeyboardAvoidingView>
  <EditSaveFooter
      onSave={handleSave}
      saving={saving}
      hasUnsavedChanges={bio !== (currentBio || '')}
    />
  </View>;
};
