import React, { useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { selectPhotoOption, type ProfilePhotoOption } from './profilePhotoOptionsRequests';

export function ProfilePhotoOptionsSheet() {
  const navigation = useNavigation();
  const route = useRoute();
  const { requestId, index, issue } = route.params as { requestId: string; index: number; issue?: string };
  const insets = useSafeAreaInsets();
  const choosing = useRef(false);
  const choose = (action: ProfilePhotoOption) => {
    if (choosing.current) return;
    choosing.current = true;
    selectPhotoOption(requestId, action);
    navigation.goBack();
  };
  return <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 12 }]}>
    {Platform.OS === 'android' && <View style={styles.handle} />}
    <Text accessibilityRole="header" style={styles.title}>{index === 0 ? 'Main photo' : `Photo ${index + 1}`}</Text>
    {issue && <Text style={styles.note}>{issue === 'unsure' ? 'Our team is reviewing this photo.'
      : issue === 'no_face' ? 'Your face could not be found in this photo.' : 'This photo could not be matched to your selfie.'}</Text>}
    {index === 0 && <Option icon="crop-outline" label="Adjust avatar" onPress={() => choose('crop')} />}
    <Option icon="swap-horizontal-outline" label="Replace photo" onPress={() => choose('replace')} />
    <Option icon="trash-outline" label="Remove photo" danger onPress={() => choose('remove')} />
  </View>;
}

function Option({ icon, label, danger, onPress }: {
  icon: React.ComponentProps<typeof Ionicons>['name']; label: string; danger?: boolean; onPress: () => void;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
    <Ionicons name={icon} size={21} color={danger ? '#FF9AA2' : '#E0D6DE'} />
    <Text style={[styles.optionText, danger && styles.danger]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 20, paddingTop: 10, backgroundColor: '#2D2B29' },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', backgroundColor: '#77716C', marginBottom: 16 },
  title: { color: '#F4EFEB', fontFamily: 'DMSans_700Bold', fontSize: 18, marginBottom: 10 },
  note: { color: '#C8C0B7', fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19, marginBottom: 10 },
  option: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 10, borderRadius: 12 },
  optionText: { color: '#F4EFEB', fontFamily: 'DMSans_500Medium', fontSize: 14 },
  danger: { color: '#FF9AA2' },
  pressed: { backgroundColor: '#3A3632' },
});
