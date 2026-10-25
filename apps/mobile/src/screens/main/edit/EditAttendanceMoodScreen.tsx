import {EditSaveFooter} from '../../../components/EditSaveFooter';
import {FormTitle, AttendanceCards, formStyles} from '../../../components/ProfileEditForms';
import {ScrollView} from 'react-native';

import React, {useState} from 'react';
import {View, Alert} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {EditScreenHeader} from '../../../components/EditScreenHeader';
import {api} from '../../../services/api';
import {useDispatch} from 'react-redux';
import {updateUser} from '../../../store/authSlice';


const moodOptions = [
  { id: '75% Maintainer', label: '75% Maintainer' },
  { id: 'Front Bencher', label: 'Front Bencher' },
  { id: 'Bunker', label: 'Bunker' },
  { id: 'Risk Taker', label: 'Risk Taker' },
];

export const EditAttendanceMoodScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const { currentMood } = route.params || {};

  const [selected, setSelected] = useState<string | null>(currentMood || null);
  const [saving, setSaving] = useState(false);


const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const response = await api.put('/profile', { attendanceMood: selected });
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


  return <View style={formStyles.page}>
    <EditScreenHeader 
        title="Attendance Style" 
        onCancel={() => navigation.goBack()} 
        onSave={handleSave} 
        saving={saving} 
        saveDisabled={!selected}
        hasUnsavedChanges={selected !== null && selected !== currentMood}
      />
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={formStyles.content} pointerEvents={saving ? 'none' : 'auto'}>
      
      <FormTitle>{'Your classroom\nstyle.'}</FormTitle>
      <AttendanceCards options={moodOptions} value={selected} disabled={saving} onSelect={setSelected}/>
    </ScrollView>
  <EditSaveFooter
      onSave={handleSave}
      saving={saving}
      saveDisabled={!selected}
      hasUnsavedChanges={selected !== null && selected !== currentMood}
    />
  </View>;
};
