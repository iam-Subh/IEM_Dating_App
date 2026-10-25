import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../../core/theme/colors';

type Props = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Telegram's "Also delete for …" option; omitted when it does not apply. */
  checkboxLabel?: string;
  onConfirm: (checked: boolean) => void;
  onCancel: () => void;
};

export function ConfirmDialog({ visible, title, message, confirmLabel, cancelLabel = 'Cancel', destructive, checkboxLabel, onConfirm, onCancel }: Props) {
  const [checked, setChecked] = useState(false);

  // Every opening starts unticked: acting for both people must be a choice made
  // each time, never one carried over from the last dialog.
  useEffect(() => {
    if (visible) setChecked(false);
  }, [visible]);

  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="Cancel" />
        <View style={styles.dialog} accessibilityViewIsModal>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          {checkboxLabel ? (
            <Pressable
              style={styles.checkRow}
              onPress={() => setChecked((value) => !value)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
            >
              <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={22} color={colors.primary} />
              <Text style={styles.checkLabel}>{checkboxLabel}</Text>
            </Pressable>
          ) : null}
          <View style={styles.buttons}>
            <Pressable onPress={onCancel} style={styles.button} accessibilityRole="button">
              <Text style={styles.cancel}>{cancelLabel}</Text>
            </Pressable>
            <Pressable onPress={() => onConfirm(checked)} style={styles.button} accessibilityRole="button">
              <Text style={destructive ? styles.danger : styles.confirm}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: '#242424', borderRadius: 20, padding: 22, width: '100%', maxWidth: 380, alignSelf: 'center' },
  title: { color: '#FFFFFF', fontSize: 20, fontWeight: '600' },
  message: { color: '#CCCCCC', fontSize: 15, marginTop: 12, lineHeight: 21 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20 },
  checkLabel: { color: '#FFFFFF', fontSize: 14, flex: 1 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 20, gap: 8 },
  button: { padding: 12 },
  cancel: { color: '#FFFFFF', fontSize: 15 },
  confirm: { color: colors.primary, fontSize: 15, fontWeight: '600' },
  danger: { color: '#FF666C', fontSize: 15, fontWeight: '600' },
});
