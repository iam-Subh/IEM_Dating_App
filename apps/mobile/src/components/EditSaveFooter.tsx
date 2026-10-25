import React from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {EditTapChoice, editColors as c} from './ProfileEditDesign';

export type EditSaveFooterProps = {
  onSave: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
  hasUnsavedChanges?: boolean;
  error?: string;
  accessibilityLabel?: string;
};

/** Keep the action outside scrolling content in every profile editor. */
export function EditSaveFooter({onSave, saving = false, saveDisabled = false, hasUnsavedChanges, error = '', accessibilityLabel = 'Save changes'}: EditSaveFooterProps) {
  const insets = useSafeAreaInsets();
  const disabled = saving || saveDisabled || hasUnsavedChanges === false;
  return <View style={[s.footer, {paddingBottom: Math.max(insets.bottom, 16) + 16}]}>
    {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
    <EditTapChoice accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{disabled, busy: saving}} disabled={disabled} onPress={onSave} style={[s.save, disabled && s.disabled]}>
      {saving ? <ActivityIndicator color={c.onAccent}/> : <Text style={s.label}>Save</Text>}
    </EditTapChoice>
  </View>;
}

const s = StyleSheet.create({
  footer: {flexShrink: 0, paddingHorizontal: 24, paddingTop: 12, backgroundColor: c.canvas},
  save: {alignSelf: 'center', minWidth: 132, minHeight: 50, paddingHorizontal: 28, borderRadius: 25, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center'},
  disabled: {opacity: 0.45},
  label: {fontFamily: 'DMSans_500Medium', fontSize: 17, color: c.onAccent},
  error: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19, color: '#FFAFBA', textAlign: 'center', marginBottom: 10},
});
