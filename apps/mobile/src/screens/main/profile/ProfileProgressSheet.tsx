import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { store } from '../../../store';
import type { ProfileTask } from './ProfileAchievementCard';
import { profileEditorParams } from './profileEditNavigation';

export function ProfileProgressSheet() {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { tasks } = route.params as { tasks: ProfileTask[] };
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const done = tasks.filter(task => task.ok).length;
  const openTask = (task: ProfileTask) => navigation.replace(task.route, profileEditorParams(task.route, store.getState().auth.user, task.section));
  return <View style={[s.sheet, { paddingBottom: Math.max(12, insets.bottom) }]}>
    {Platform.OS === 'android' && <View style={s.handle} />}
    <View style={s.heading}><View style={s.copy}><Text accessibilityRole="header" style={s.title}>Your profile progress</Text><Text style={s.subtitle}>{done} of {tasks.length} steps complete</Text></View><TouchableOpacity accessibilityRole="button" accessibilityLabel="Close progress" onPress={() => navigation.goBack()} style={s.close}><Ionicons name="close" size={20} color="#F7F3EE" /></TouchableOpacity></View>
    <ScrollView style={{ height: Math.min(tasks.length * 58, height * 0.56) }} contentContainerStyle={s.tasks} showsVerticalScrollIndicator={false}>
      {tasks.map(task => <TouchableOpacity key={task.title} accessibilityRole="button" accessibilityLabel={`${task.title}, ${task.ok ? 'complete' : 'remaining'}. Edit.`} activeOpacity={0.8} onPress={() => openTask(task)} style={s.task}>
        <View style={[s.status, task.ok && s.statusDone]}><Ionicons name={task.ok ? 'checkmark' : 'ellipse-outline'} size={17} color={task.ok ? '#EBDCC4' : '#B8ADA6'} /></View>
        <View style={s.copy}><Text style={s.taskTitle}>{task.title}</Text><Text style={[s.taskDetail, task.ok && s.taskDone]}>{task.ok ? 'Complete' : task.label}</Text></View>
        <Ionicons name="chevron-forward" size={17} color="#B8ADA6" />
      </TouchableOpacity>)}
    </ScrollView>
  </View>;
}

const s = StyleSheet.create({
  sheet: { paddingHorizontal: 16, paddingTop: 10, backgroundColor: '#222222' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#706B66', alignSelf: 'center', marginBottom: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  copy: { flex: 1, minWidth: 0 },
  title: { fontFamily: 'DMSans_700Bold', fontSize: 19, color: '#F7F3EE' },
  subtitle: { marginTop: 4, fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#C9C2BA' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  tasks: { paddingBottom: 4 },
  task: { minHeight: 58, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 10 },
  status: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#33302E', alignItems: 'center', justifyContent: 'center' },
  statusDone: { backgroundColor: '#3C362D' },
  taskTitle: { fontFamily: 'DMSans_500Medium', fontSize: 14, lineHeight: 19, color: '#F7F3EE' },
  taskDetail: { marginTop: 2, fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 16, color: '#DDBDCA' },
  taskDone: { color: '#C7BDA9' },
});
