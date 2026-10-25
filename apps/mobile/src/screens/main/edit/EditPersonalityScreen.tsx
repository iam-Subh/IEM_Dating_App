import {EditSaveFooter} from '../../../components/EditSaveFooter';
import {FormTitle, TopicCards, formStyles} from '../../../components/ProfileEditForms';
import {PERSONALITY_SECTIONS as TRAIT_SECTIONS} from '../../../core/profile/profileOptions';

import React, {useLayoutEffect, useState} from 'react';
import {View, ScrollView, Alert} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';


import {EditScreenHeader} from '../../../components/EditScreenHeader';
import {api} from '../../../services/api';
import {useDispatch} from 'react-redux';
import {updateUser} from '../../../store/authSlice';



export const EditPersonalityScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const { currentPersonality } = route.params || {};

  const [selections, setSelections] = useState<Record<string, string>>(currentPersonality || {});
  const [saving, setSaving] = useState(false);
  const returnedAnswer = route.params?.profileTopicAnswer;
  useLayoutEffect(() => {
    if (returnedAnswer?.kind === 'personality') {
      setSelections(previous => ({...previous, [returnedAnswer.id]: returnedAnswer.value}));
    }
  }, [returnedAnswer]);


const handleSelect = (sectionId: string, optionId: string) => {
    setSelections(prev => ({ ...prev, [sectionId]: optionId }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await api.put('/profile', { preferences: { personality: selections } });
      if (!response.data?.success) throw new Error(response.data?.message || 'Could not save your changes.');
      if (response.data?.success) dispatch(updateUser(response.data.data));
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to update');
    } finally { setSaving(false); }
  };


  return <View style={formStyles.page}>
    <EditScreenHeader 
        title="Personality" 
        onCancel={() => navigation.goBack()} 
        onSave={handleSave} 
        saving={saving} 
        hasUnsavedChanges={Object.keys(selections).some(k => selections[k] !== (currentPersonality || {})[k]) || Object.keys(currentPersonality || {}).some(k => selections[k] !== (currentPersonality || {})[k])}
      />
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={formStyles.content} pointerEvents={saving ? 'none' : 'auto'}>
      
      <FormTitle>{'The way you\nconnect.'}</FormTitle>
      <TopicCards kind="personality" topics={['communication', 'love_reception', 'personality', 'star_sign'].map(id => TRAIT_SECTIONS.find(topic => topic.id === id)!)} answers={selections} disabled={saving} onSelect={handleSelect}/>
    </ScrollView>
  <EditSaveFooter
      onSave={handleSave}
      saving={saving}
      hasUnsavedChanges={Object.keys(selections).some(k => selections[k] !== (currentPersonality || {})[k]) || Object.keys(currentPersonality || {}).some(k => selections[k] !== (currentPersonality || {})[k])}
    />
  </View>;
};
