import {EditSaveFooter} from '../../../components/EditSaveFooter';
import {FormTitle, FormChoice, formStyles, f} from '../../../components/ProfileEditForms';
import {EditTapChoice as TouchableOpacity} from '../../../components/ProfileEditDesign';
import React, {useState, useEffect} from 'react';
import {View, Text, ScrollView, Alert, ActivityIndicator} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';

import {EditScreenHeader} from '../../../components/EditScreenHeader';
import {api} from '../../../services/api';
import {useDispatch} from 'react-redux';
import {updateUser} from '../../../store/authSlice';
import {useMyCampuses} from '../../../features/location/useMyCampuses';



export const EditCampusScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const { currentCampus } = route.params || {};

  // Your own institution's campuses only (LOCATION_SPEC.md 8.1).
  const { campuses, current, loading, error, reload } = useMyCampuses();
  const [selectedCampus, setSelectedCampus] = useState<string | null>(currentCampus || null);
  useEffect(() => {
    if (!selectedCampus && current) setSelectedCampus(current);
  }, [current]);
  const [saving, setSaving] = useState(false);


const handleSave = async () => {
    if (!selectedCampus) return;
    setSaving(true);
    try {
      const response = await api.put('/profile', { campus: selectedCampus });
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
        title="Campus" 
        onCancel={() => navigation.goBack()} 
        onSave={handleSave} 
        saving={saving} 
        saveDisabled={!selectedCampus}
        hasUnsavedChanges={selectedCampus !== null && selectedCampus !== (currentCampus || null)}
      />
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={formStyles.content} pointerEvents={saving ? 'none' : 'auto'}>
      
      <FormTitle center>{'Which campus\nare you at?'}</FormTitle>
      <View style={{marginTop: 24}}>
      {loading && <ActivityIndicator color="#F3C1CA"/>}
      {!!error && <TouchableOpacity disabled={saving} onPress={reload} style={f.help}><Text style={f.link}>{error} Tap to retry.</Text></TouchableOpacity>}
      {campuses.map(campus => <FormChoice key={campus.id} label={campus.name} checked={selectedCampus === campus.name} disabled={saving} onPress={() => setSelectedCampus(campus.name)}/>)}
      {!loading && campuses.length === 1 && <Text style={f.note}>Your college has one campus.</Text>}
      </View>
    </ScrollView>
  <EditSaveFooter
      onSave={handleSave}
      saving={saving}
      saveDisabled={!selectedCampus}
      hasUnsavedChanges={selectedCampus !== null && selectedCampus !== (currentCampus || null)}
    />
  </View>;
};
