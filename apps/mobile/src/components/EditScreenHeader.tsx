import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cancelDiscardRequest, createDiscardRequest } from './discardChangesRequests';
import { editColors } from './ProfileEditDesign';

interface EditScreenHeaderProps {
  title: string;
  onCancel: () => void;
  onSave: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
  hasUnsavedChanges?: boolean;
  showSave?: boolean;
}

export const EditScreenHeader = ({
  title,
  onCancel,
  onSave,
  saving = false,
  saveDisabled = false,
  hasUnsavedChanges,
  showSave = false,
}: EditScreenHeaderProps) => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const pendingRequest = useRef<string | null>(null);
  usePreventRemove(!!hasUnsavedChanges && !saving, ({ data }) => {
    if (pendingRequest.current) return;
    const requestId = createDiscardRequest((discard) => {
      pendingRequest.current = null;
      if (discard) navigation.dispatch(data.action);
    });
    pendingRequest.current = requestId;
    navigation.navigate('DiscardChanges', { requestId });
  });
  useEffect(() => () => {
    if (pendingRequest.current) cancelDiscardRequest(pendingRequest.current);
  }, []);

  const handleCancel = () => {
    if (saving) return;
    onCancel();
  };
  const disabled = saving || saveDisabled || hasUnsavedChanges === false;

  return (
    <View style={[styles.header, { paddingTop: insets.top + 8, paddingBottom: showSave ? 10 : 0 }]}>
      <StatusBar barStyle="light-content" backgroundColor={editColors.canvas}/>
      <TouchableOpacity disabled={saving} onPress={handleCancel} style={[styles.headerBtn, styles.cancelButton]} activeOpacity={0.7} hitSlop={3} accessibilityRole="button" accessibilityLabel="Cancel changes">
        <Ionicons name="arrow-back" size={22} color={editColors.text}/>
      </TouchableOpacity>
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      {showSave ? <TouchableOpacity
        onPress={onSave}
        disabled={disabled}
        style={[styles.headerBtn, styles.saveButton, disabled && { opacity: 0.4 }]}
        activeOpacity={0.7}
        hitSlop={3}
        accessibilityRole="button" accessibilityLabel="Save changes" accessibilityState={{ disabled, busy: saving }}
      >
        {saving ? (
          <ActivityIndicator size="small" color="#331C23" />
        ) : (
          <Text style={styles.saveText}>Save</Text>
        )}
      </TouchableOpacity> : <View style={{width: 44}}/>}
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    backgroundColor: editColors.canvas,
  },
  headerBtn: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderRadius: 22,
  },
  cancelButton: { width: 44, paddingHorizontal: 0, backgroundColor: editColors.surface },
  saveButton: { minWidth: 76, backgroundColor: editColors.accent },
  cancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    lineHeight: 23,
    fontFamily: 'DMSans_500Medium',
    color: editColors.text,
    textAlign: 'center',
  },
  saveText: {
    fontSize: 14,
    fontFamily: 'DMSans_700Bold',
    color: editColors.onAccent,
  },
});
