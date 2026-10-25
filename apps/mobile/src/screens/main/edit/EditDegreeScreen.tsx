import {EditSaveFooter} from '../../../components/EditSaveFooter';
import {FormTitle, StudyField, formStyles, f} from '../../../components/ProfileEditForms';

import React, {useRef, useState} from 'react';
import {Alert, ScrollView, Text, TextInput, View} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {useDispatch} from 'react-redux';
import {EditScreenHeader} from '../../../components/EditScreenHeader';

import {DEGREE_OPTIONS} from '../../../core/profile/profileOptions';
import {api} from '../../../services/api';
import {updateUser} from '../../../store/authSlice';

export function EditDegreeScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const initial = typeof route.params?.currentDegree === 'string' ? route.params.currentDegree.trim() : '';
  const [degree, setDegree] = useState(initial);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const selected = degree.trim();

  const save = async () => {
    if (!selected || savingRef.current) return;
    if (selected === initial) { navigation.goBack(); return; }
    savingRef.current = true;
    setSaving(true);
    try {
      const response = await api.put('/profile', { degree: selected });
      if (!response.data?.success) throw new Error(response.data?.message || 'Could not save your degree.');
      dispatch(updateUser(response.data.data));
      navigation.goBack();
    } catch (error: any) {
      Alert.alert('Could not save degree', error.response?.data?.message || error.message || 'Please try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return <View style={formStyles.page}>
    <EditScreenHeader title="Degree" onCancel={() => navigation.goBack()} onSave={save}
      saving={saving} saveDisabled={!selected} hasUnsavedChanges={selected !== initial} />
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={formStyles.content} pointerEvents={saving ? 'none' : 'auto'}>
      
      <FormTitle center>{'What’s your\ndegree?'}</FormTitle>
      <View style={{marginTop: 24}}><StudyField label="Degree type" value={selected} options={DEGREE_OPTIONS.map(value => ({id: value, label: value}))} disabled={saving} onSelect={setDegree}/></View>
      <View style={f.field}><View style={f.flex}><Text style={f.fieldLabel}>Other degree</Text><TextInput accessibilityLabel="Degree name" value={degree} onChangeText={setDegree} editable={!saving} placeholder="For example, B.Tech or M.Tech" placeholderTextColor="#9D958F" maxLength={255} autoCorrect={false} style={[f.fieldValue, {minHeight: 36, padding: 0}]}/></View></View>
    </ScrollView>
  <EditSaveFooter
      onSave={save}
      saving={saving}
      saveDisabled={!selected}
      hasUnsavedChanges={selected !== initial}
    />
  </View>;
};
