import {EditSaveFooter} from '../../../components/EditSaveFooter';
import {ResidencyGraphic} from '../../../features/auth/onboarding/OnboardingFormArtwork';
import {FormTitle, SelectionMark, formStyles, f} from '../../../components/ProfileEditForms';
import {ScrollView} from 'react-native';
import {EditTapChoice as TouchableOpacity} from '../../../components/ProfileEditDesign';
import React, {useState} from 'react';
import {View, Text, Alert} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {EditScreenHeader} from '../../../components/EditScreenHeader';
import {api} from '../../../services/api';
import {useDispatch} from 'react-redux';
import {updateUser} from '../../../store/authSlice';




export const EditResidencyScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const { currentResidency } = route.params || {};

  // isHosteller: true (Hosteller), false (Day Scholar), null (Unspecified)
  const [selected, setSelected] = useState<boolean | null>(
    currentResidency !== undefined ? currentResidency : null
  );
  const [saving, setSaving] = useState(false);


const handleSave = async () => {
    if (selected === null) return;
    setSaving(true);
    try {
      const response = await api.put('/profile', { isHosteller: selected });
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
        title="Residency" 
        onCancel={() => navigation.goBack()} 
        onSave={handleSave} 
        saving={saving} 
        saveDisabled={selected === null}
        hasUnsavedChanges={selected !== null && selected !== (currentResidency !== undefined ? currentResidency : null)}
      />
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={formStyles.content} pointerEvents={saving ? 'none' : 'auto'}>
      
      <FormTitle center>{'Where do you\nstay?'}</FormTitle>
      <View style={{flexDirection: 'row', gap: 10, marginTop: 24}}>{[{label: 'Hosteller', value: true}, {label: 'Day scholar', value: false}].map(item => <TouchableOpacity key={item.label} accessibilityRole="radio" accessibilityLabel={item.label} accessibilityState={{checked: selected === item.value}} disabled={saving} onPress={() => setSelected(item.value)} style={{flex: 1, minHeight: 98, borderRadius: 22, paddingHorizontal: 14, paddingVertical: 12, justifyContent: 'flex-end', backgroundColor: selected === item.value ? '#3B2933' : '#242321', overflow: 'hidden'}}>
        <View pointerEvents="none" style={{position: 'absolute', left: 4, top: 0, opacity: 0.85}}><ResidencyGraphic hosteller={item.value}/></View><View style={{position: 'absolute', top: 14, right: 14}}><SelectionMark checked={selected === item.value}/></View><Text style={[f.choiceLabel, {fontSize: 13, lineHeight: 19}]}>{item.label}</Text>
      </TouchableOpacity>)}</View>
    </ScrollView>
  <EditSaveFooter
      onSave={handleSave}
      saving={saving}
      saveDisabled={selected === null}
      hasUnsavedChanges={selected !== null && selected !== (currentResidency !== undefined ? currentResidency : null)}
    />
  </View>;
};
