import {EditSaveFooter} from '../../../components/EditSaveFooter';
import {FormSheet, formStyles} from '../../../components/ProfileEditForms';
import {GENDER_DETAILS as subGenderData} from '../../../core/profile/profileOptions';
import {GenderForm, GenderLabelOptions} from '../../../features/auth/onboarding/GenderForm';
import React, {useLayoutEffect, useState} from 'react';
import {View, Alert, Platform} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {EditScreenHeader} from '../../../components/EditScreenHeader';
import {api} from '../../../services/api';
import {useDispatch} from 'react-redux';
import {updateUser} from '../../../store/authSlice';







export const EditGenderScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const { currentGender, currentShowGender } = route.params || {};

  // Determine the primary gender category from the current value
  const getPrimaryGender = (val: string | null) => {
    if (!val) return null;
    if (val === 'Man' || val === 'Woman' || val === 'Beyond binary') return val;
    // Check sub-options
    for (const [key, subs] of Object.entries(subGenderData)) {
      if (subs.some((s) => s.label === val)) return key;
    }
    return null;
  };

  const [gender, setGender] = useState<string | null>(getPrimaryGender(currentGender) || null);
  const [specificGender, setSpecificGender] = useState<string | null>(
    currentGender && currentGender !== 'Man' && currentGender !== 'Woman' && currentGender !== 'Beyond binary'
      ? currentGender
      : null
  );
  const [showGender, setShowGender] = useState(currentShowGender ?? true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const labelSelection = route.params?.genderLabelSelection;
  useLayoutEffect(() => {
    if (labelSelection?.gender === gender) setSpecificGender(labelSelection.detail || null);
  }, [labelSelection]);
  const openLabels = () => {
    if (Platform.OS === 'web') setExpanded(true);
    else navigation.navigate('ProfileGenderLabels', {gender, detail: specificGender || '', returnKey: route.key});
  };

const handleSave = async () => {
    if (!gender || saving) return;
    setSaving(true);
    try {
      const finalGender = specificGender || gender;
      const response = await api.put('/profile', { gender: finalGender, showGender });
      if (!response.data?.success) throw new Error(response.data?.message || 'Could not save your changes.');
      if (response.data?.success) {
        dispatch(updateUser(response.data.data));
      }
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to update gender');
    } finally {
      setSaving(false);
    }
  };


  return <View style={formStyles.page}>
    <EditScreenHeader 
        title="Gender" 
        onCancel={() => navigation.goBack()} 
        onSave={handleSave} 
        saving={saving} 
        saveDisabled={!gender}
        hasUnsavedChanges={(specificGender || gender) !== (currentGender || null) || showGender !== (currentShowGender ?? true)}
      />
    <GenderForm dark gender={gender || ''} detail={specificGender || ''} showGender={showGender} busy={saving}
      onSelectGender={value => {if (gender !== value) {setGender(value); setSpecificGender(null);}}}
      onOpenLabels={openLabels} onToggleVisibility={() => setShowGender(!showGender)}/>
    {Platform.OS === 'web' && <FormSheet visible={expanded} title="More about your gender" backgroundColor="#242321" onClose={() => setExpanded(false)}>
      <View style={{gap: 10}}><GenderLabelOptions dark gender={gender || ''} detail={specificGender || ''}
        onSelect={label => {setSpecificGender(label || null); setExpanded(false);}}/></View>
    </FormSheet>}
  <EditSaveFooter
      onSave={handleSave}
      saving={saving}
      saveDisabled={!gender}
      hasUnsavedChanges={(specificGender || gender) !== (currentGender || null) || showGender !== (currentShowGender ?? true)}
    />
  </View>;
};
