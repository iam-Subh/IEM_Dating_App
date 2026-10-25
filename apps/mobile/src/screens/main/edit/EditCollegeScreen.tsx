import {EditSaveFooter} from '../../../components/EditSaveFooter';
import {FormTitle, FormChoice, formStyles, f} from '../../../components/ProfileEditForms';
import {ScrollView} from 'react-native';

import React, {useState, useEffect} from 'react';
import {View, Text, Alert, ActivityIndicator} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {useDispatch, useSelector} from 'react-redux';
import {EditScreenHeader} from '../../../components/EditScreenHeader';
import {api} from '../../../services/api';
import {updateUser} from '../../../store/authSlice';
import type {RootState} from '../../../store';
import {VerifiedBadge} from '../../../features/discovery/components/VerifiedBadge';
import {ReminderRow} from '../../../features/verification/ReminderParts';
import {ReminderArt} from '../../../features/verification/ReminderArt';
import {refreshVerificationStatus, useVerificationStatus} from '../../../features/verification/useVerificationStatus';

/**
 * Edit profile > College (features/auth/GOOGLE_SIGNUP_PLAN.md 1.3, reminder 24).
 *
 * A verified college comes from the college email and is shown with the
 * tick, not edited here. An unverified account chooses its college from the
 * list - shown on its card without the tick - with Verify beside it.
 */
type Institution = { id: string; name: string };

export const EditCollegeScreen = () => {
  const navigation = useNavigation<any>();
  const dispatch = useDispatch();
  const status = useVerificationStatus();
  const user = useSelector((state: RootState) => state.auth.user);
  const [institutions, setInstitutions] = useState<Institution[] | null>(null);
  const [selected, setSelected] = useState<string | null>(user?.claimedInstitutionId ?? null);
  const [saving, setSaving] = useState(false);
  const verified = !!status?.verified;

  useEffect(() => {
    api.get('/verification/institutions')
      .then((response) => {
        const list = response.data.data as Institution[];
        setInstitutions(list);
        // Older accounts kept only the college's name.
        if (!selected) setSelected(list.find((entry) => entry.name === user?.college)?.id ?? null);
      })
      .catch(() => setInstitutions([]));
  }, []);

  const current = user?.claimedInstitutionId ?? institutions?.find((entry) => entry.name === user?.college)?.id ?? null;

  const handleSave = async () => {
    if (!selected || verified) return;
    setSaving(true);
    try {
      const response = await api.put('/profile', { institutionId: selected });
      if (!response.data?.success) throw new Error(response.data?.message || 'Could not save your changes.');
      if (response.data?.success) dispatch(updateUser({ ...response.data.data, claimedInstitutionId: selected }));
      void refreshVerificationStatus();
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  return <View style={formStyles.page}>
    <EditScreenHeader
        title="College"
        onCancel={() => navigation.goBack()}
        onSave={handleSave}
        saving={saving}
        saveDisabled={verified || !selected}
        hasUnsavedChanges={!verified && selected !== null && selected !== current}
      />
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={formStyles.content} pointerEvents={saving ? 'none' : 'auto'}>
      
      <FormTitle center subtitle={verified ? 'Confirmed by your college email.' : undefined}>{'Where do you\nstudy?'}</FormTitle>
      <View style={{marginTop: 24}}>
      {verified ? <View style={f.choice}><Text style={[f.choiceLabel, f.flex]}>{user?.college}</Text><VerifiedBadge size={20}/></View> : !institutions ? <ActivityIndicator color="#F3C1CA"/> : institutions.map(college => <FormChoice key={college.id} label={college.name} checked={selected === college.id} disabled={saving} onPress={() => setSelected(college.id)}/>)}
      </View>
      {!verified && <View style={{marginTop: 18}}><ReminderRow flush tone={status?.expired ? 'warn' : 'neutral'}
        leading={<ReminderArt name={status?.expired ? 'renew' : 'badge'} size={42}/>}
        title={status?.expired ? 'Renew your college verification' : 'Verify your college email'}
        subtitle={status?.expired ? 'Your verification has ended.' : 'Step 1 of your blue badge.'}
        value={status?.expired ? 'Re-verify' : 'Verify'} onPress={() => navigation.navigate('VerifyCollege')}/></View>}
    </ScrollView>
  <EditSaveFooter
      onSave={handleSave}
      saving={saving}
      saveDisabled={verified || !selected}
      hasUnsavedChanges={!verified && selected !== null && selected !== current}
    />
  </View>;
};
