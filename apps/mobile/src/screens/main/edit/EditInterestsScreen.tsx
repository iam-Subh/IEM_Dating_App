import React, {useMemo, useRef, useState} from 'react';
import {useNavigation, useRoute} from '@react-navigation/native';
import {useDispatch, useSelector} from 'react-redux';
import {normalizeInterests} from '@iem-dating/shared/interest-catalog';
import {InterestForm, type InterestFormController} from '../../../features/auth/onboarding/InterestIntroduction';
import {api} from '../../../services/api';
import {updateUser} from '../../../store/authSlice';
import type {RootState} from '../../../store';

export function EditInterestsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const user = useSelector((state: RootState) => state.auth.user);
  const initial = useMemo(() => ({
    preferences: {interests: normalizeInterests(route.params?.currentInterests ?? user?.preferences?.interests)},
  }), [route.params?.currentInterests, user?.preferences?.interests]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  const save = async (fields: Record<string, any>) => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setError('');
    try {
      const response = await api.put('/profile', {preferences: {interests: fields.preferences.interests}});
      if (!response.data?.success) throw new Error(response.data?.message || 'Could not save your interests.');
      dispatch(updateUser(response.data.data)); navigation.goBack();
    } catch (cause: any) {
      setError(cause.response?.data?.message || cause.message || 'Please try again.');
    } finally {savingRef.current = false; setSaving(false);}
  };
  const controller: InterestFormController = {
    data: initial, navigation, route, editing: true, busy: saving, error, action: 'Save',
    back: () => navigation.goBack(), draft: () => {}, saveOptional: save,
  };
  return <InterestForm dark includeClubs={false} controller={controller}/>;
}
