import {IntentionForm} from '../../../features/auth/onboarding/IntentionForm';
import {editColors} from '../../../components/ProfileEditDesign';

import React, {useState} from 'react';
import {View, Alert} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {EditScreenHeader} from '../../../components/EditScreenHeader';
import {api} from '../../../services/api';
import {useDispatch} from 'react-redux';
import {updateUser} from '../../../store/authSlice';




export const EditSeekingScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const { currentSeeking } = route.params || {};

  const [selected, setSelected] = useState<string | null>(currentSeeking || null);
  const [saving, setSaving] = useState(false);


const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const response = await api.put('/profile', { seeking: selected });
      if (!response.data?.success) throw new Error(response.data?.message || 'Could not save your changes.');
      if (response.data?.success) {
        dispatch(updateUser(response.data.data));
      }
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };


  return <View style={{flex: 1, backgroundColor: editColors.canvas}}>
    <EditScreenHeader 
        title="Looking For" 
        onCancel={() => navigation.goBack()} 
        onSave={handleSave} 
        saving={saving} 
        saveDisabled={!selected}
        hasUnsavedChanges={selected !== (currentSeeking || null)}
        showSave={false}
      />
    <IntentionForm dark value={selected} onSelect={setSelected} busy={saving} disabled={!selected || selected === (currentSeeking || null)} onSubmit={handleSave}/>
  </View>;
};
