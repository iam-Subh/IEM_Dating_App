import React from 'react';
import { useDispatch } from 'react-redux';
import { DiscoverySettings } from '../../discovery/components/DiscoverySettings';
import { confirmDiscoveryPreferences } from '../../../store/authSlice';

export function RequiredDiscoveryPreferencesScreen() {
  const dispatch = useDispatch();
  return (
    <DiscoverySettings
      visible
      required
      onClose={() => undefined}
      onSaved={(confirmedAt) => {
        dispatch(confirmDiscoveryPreferences(confirmedAt || new Date().toISOString()));
      }}
    />
  );
}
