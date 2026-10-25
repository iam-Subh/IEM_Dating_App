import {EditSaveFooter} from '../../../components/EditSaveFooter';
import {useWindowDimensions} from 'react-native';
import {OrientationArtwork} from '../../../features/auth/onboarding/OnboardingFormArtwork';
import {FormTitle, FormChoice, FormVisibility, FormSheet, formStyles, f} from '../../../components/ProfileEditForms';
import {ORIENTATION_OPTIONS as orientationOptions} from '../../../core/profile/profileOptions';
import {EditTapChoice as TouchableOpacity} from '../../../components/ProfileEditDesign';
import React, {useState} from 'react';
import {View, Text, ScrollView, Alert} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import {EditScreenHeader} from '../../../components/EditScreenHeader';
import {api} from '../../../services/api';
import {useDispatch} from 'react-redux';
import {updateUser} from '../../../store/authSlice';



export const EditOrientationScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const { currentOrientation, currentShowOrientation } = route.params || {};

  const [selected, setSelected] = useState<string[]>(currentOrientation || []);
  const [showOrientation, setShowOrientation] = useState(currentShowOrientation ?? true);
  const [saving, setSaving] = useState(false);


const toggle = (id: string) => {
    if (selected.includes(id)) {
      setSelected(selected.filter(i => i !== id));
    } else if (selected.length < 3) {
      setSelected([...selected, id]);
    } else {
      Alert.alert('Limit', 'You can select up to 3 orientations.');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await api.put('/profile', { orientation: selected, showOrientation });
      if (!response.data?.success) throw new Error(response.data?.message || 'Could not save your changes.');
      if (response.data?.success) dispatch(updateUser(response.data.data));
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to update');
    } finally { setSaving(false); }
  };

  const [definitionsOpen, setDefinitionsOpen] = useState(false);
  const {width: formWidth, fontScale: formFontScale} = useWindowDimensions();
  return <View style={formStyles.page}>
    <EditScreenHeader 
        title="Orientation" 
        onCancel={() => navigation.goBack()} 
        onSave={handleSave} 
        saving={saving} 
        hasUnsavedChanges={
          selected.length !== (currentOrientation || []).length || 
          selected.some(i => !(currentOrientation || []).includes(i)) ||
          showOrientation !== (currentShowOrientation ?? true)
        }
      />
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={formStyles.content} pointerEvents={saving ? 'none' : 'auto'}>
      
      <FormTitle art={<OrientationArtwork/>}>{'Your\norientation'}</FormTitle>
      <View style={f.hintRow}><Text style={f.note}>Choose up to 3.</Text><Text style={f.count}>{selected.length} selected</Text></View>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>{orientationOptions.map(opt => <View key={opt.id} style={{width: formWidth < 340 || formFontScale > 1.25 ? '100%' : '48.5%'}}><FormChoice compact square label={opt.label} checked={selected.includes(opt.id)} disabled={saving} onPress={() => toggle(opt.id)}/></View>)}</View>
      <TouchableOpacity disabled={saving} onPress={() => setDefinitionsOpen(true)} style={f.help}><MaterialCommunityIcons name="information-outline" size={17} color="#F3C1CA"/><Text style={f.link}>What do these labels mean?</Text><MaterialCommunityIcons name="chevron-right" size={16} color="#F3C1CA"/></TouchableOpacity>
      <FormVisibility label="Show orientation on my profile" detail={showOrientation ? 'Visible on your profile.' : 'Private unless you choose to share.'} checked={showOrientation} disabled={saving} onPress={() => setShowOrientation(!showOrientation)}/>
      <FormSheet visible={definitionsOpen} title="Orientation labels" onClose={() => setDefinitionsOpen(false)}>{orientationOptions.map(opt => <View key={opt.id} style={{paddingVertical: 16}}><Text style={f.choiceLabel}>{opt.label}</Text><Text style={f.detail}>{opt.description || 'Exploring attraction to more than one gender.'}</Text></View>)}</FormSheet>
    </ScrollView>
  <EditSaveFooter
      onSave={handleSave}
      saving={saving}
      hasUnsavedChanges={
          selected.length !== (currentOrientation || []).length || 
          selected.some(i => !(currentOrientation || []).includes(i)) ||
          showOrientation !== (currentShowOrientation ?? true)
        }
    />
  </View>;
};
