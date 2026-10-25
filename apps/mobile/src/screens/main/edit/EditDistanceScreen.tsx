import {EditSaveFooter} from '../../../components/EditSaveFooter';
import {createEditStyles} from '../../../components/ProfileEditDesign';
import {FormTitle} from '../../../components/ProfileEditForms';
import React, {useState} from 'react';
import {View, Text, Alert} from 'react-native';
import Slider from '@react-native-community/slider';
import {RADIUS_PRESETS_KM, toRadiusPreset} from '@iem-dating/shared/location';
import {formatDistance, useDistanceUnit} from '../../../features/location/distanceUnits';
import {useNavigation, useRoute} from '@react-navigation/native';
import {EditScreenHeader} from '../../../components/EditScreenHeader';
import {api} from '../../../services/api';
import {useDispatch} from 'react-redux';
import {updateUser} from '../../../store/authSlice';

export const EditDistanceScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const { currentDistance } = route.params || {};

  // Six presets, never a free number (LOCATION_SPEC.md 6.5); kilometres throughout.
  const initialDistance = toRadiusPreset(currentDistance ? parseInt(currentDistance) : 100);
  const [distance, setDistance] = useState(initialDistance);
  const unit = useDistanceUnit();
  const [saving, setSaving] = useState(false);


const handleSave = async () => {
    setSaving(true);
    try {
      const response = await api.put('/profile', { distancePreference: distance });
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

  return (
    <View style={styles.container}>
      <EditScreenHeader 
        title="Distance" 
        onCancel={() => navigation.goBack()} 
        onSave={handleSave} 
        saving={saving} 
        hasUnsavedChanges={distance !== initialDistance}
      />
      <View style={styles.content} pointerEvents={saving ? 'none' : 'auto'}>
        <FormTitle>{'People\nnear you.'}</FormTitle>

        <View style={styles.sliderContainer}>
          <View style={styles.sliderHeader}>
            <Text style={styles.sliderLabel}>Distance preference</Text>
            <Text style={styles.distanceValue}>{formatDistance(distance, unit)}</Text>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={RADIUS_PRESETS_KM.length - 1}
            step={1}
            value={RADIUS_PRESETS_KM.indexOf(distance)}
            onValueChange={(index) => setDistance(RADIUS_PRESETS_KM[Math.round(index)])}
            minimumTrackTintColor="#F3C1CA"
            maximumTrackTintColor="rgba(255,255,255,0.1)"
            thumbTintColor="#F3C1CA"
          />
        </View>
      </View>
    <EditSaveFooter
      onSave={handleSave}
      saving={saving}
      hasUnsavedChanges={distance !== initialDistance}
    />
  </View>
  );
};

const styles = createEditStyles({
  container: { flex: 1, backgroundColor: '#100F0D' },
  content: { flex: 1, padding: 20 },
  title: { fontSize: 30, fontWeight: '800', color: '#FFF', marginBottom: 12 },
  subtitle: { fontSize: 15, color: 'rgba(255,255,255,0.6)', lineHeight: 22, marginBottom: 40 },
  sliderContainer: { marginTop: 24, marginBottom: 30, padding: 18, borderRadius: 20, backgroundColor: '#242321' },
  sliderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  sliderLabel: { fontSize: 18, color: '#FFF', fontWeight: '600' },
  distanceValue: { fontSize: 16, color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
  slider: { width: '100%', height: 40 },
});
