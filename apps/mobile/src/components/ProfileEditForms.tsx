import React, {useState} from 'react';
import {Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import Svg, {Path} from 'react-native-svg';
import {EditTapChoice, editColors as c} from './ProfileEditDesign';
import {ConnectionArt, LifestyleArt, lifestyleDesign, personalityDesign, SocialArt} from '../features/auth/onboarding/OnboardingFormArtwork';

// Layouts and illustrations follow the corresponding onboarding forms.
// Editors retain their own state, validation, navigation and save handlers.
export function FormTitle({children, subtitle, center = false, art, size = 38}: {children: React.ReactNode; subtitle?: string; center?: boolean; art?: React.ReactNode; size?: number}) {
  const {height, fontScale} = useWindowDimensions();
  const titleSize = height < 760 && fontScale <= 1.2 ? size - (size === 44 ? 6 : 4) : size;
  return <View>
    <View style={f.hero}><Text accessibilityRole="header" style={[f.title, {fontSize: titleSize, lineHeight: titleSize + 8}, center && f.center, art ? {flex: 1} : {width: '100%'}]}>{children}</Text>{art && <View pointerEvents="none" style={f.heroArt}>{art}</View>}</View>
    {subtitle && <Text style={[f.subtitle, center && f.center]}>{subtitle}</Text>}
  </View>;
}

export function SelectionMark({checked, square = false}: {checked: boolean; square?: boolean}) {
  return <View pointerEvents="none" style={[f.radio, square && {borderRadius: 6}, checked && f.radioChecked]}>
    {checked && <Svg width={15} height={15} viewBox="0 0 24 24" accessible={false}><Path d="M5 12.5L10 17L19 7" fill="none" stroke={c.onAccent} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/></Svg>}
  </View>;
}

export function FormChoice({label, detail, checked, onPress, disabled, square = false, compact = false, surfaceColor}: {label: string; detail?: string; checked: boolean; onPress: () => void; disabled?: boolean; square?: boolean; compact?: boolean; surfaceColor?: string}) {
  return <EditTapChoice accessibilityRole={square ? 'checkbox' : 'radio'} accessibilityLabel={label} accessibilityState={{checked, disabled}} disabled={disabled} onPress={onPress} style={[f.choice, surfaceColor && {backgroundColor: surfaceColor}, compact && f.compactChoice, checked && f.selected]}>
    <View style={f.flex}><Text style={[f.choiceLabel, compact && {fontSize: 14, lineHeight: 21}]}>{label}</Text>{detail && <Text style={f.detail}>{detail}</Text>}</View><SelectionMark checked={checked} square={square}/>
  </EditTapChoice>;
}

export function FormVisibility({label, detail, checked, onPress, disabled}: {label: string; detail?: string; checked: boolean; onPress: () => void; disabled?: boolean}) {
  return <EditTapChoice accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{checked}} disabled={disabled} onPress={onPress} style={f.visibility}>
    <View style={f.flex}><Text style={f.visibilityLabel}>{label}</Text>{detail && <Text style={f.detail}>{detail}</Text>}</View><SelectionMark square checked={checked}/>
  </EditTapChoice>;
}

export function FormSheet({visible, title, subtitle, onClose, children, compactHeader = false, backgroundColor = c.canvas, showsVerticalScrollIndicator = true}: {visible: boolean; title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; compactHeader?: boolean; backgroundColor?: string; showsVerticalScrollIndicator?: boolean}) {
  const insets = useSafeAreaInsets();
  const close = () => {Keyboard.dismiss(); onClose();};
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
    <View style={f.modal}>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss options" onPress={close} style={StyleSheet.absoluteFill}/>
      <View accessibilityViewIsModal style={[f.sheet, {backgroundColor, marginTop: insets.top + 16, paddingBottom: Math.max(insets.bottom, 18)}]}>
        <View style={[f.sheetHeader, compactHeader && {marginBottom: 0}]}><Text accessibilityRole="header" style={[f.sheetTitle, compactHeader && {paddingBottom: 0}]}>{title}</Text><EditTapChoice accessibilityLabel="Close options" onPress={close} style={[f.close, compactHeader && {width: 36, height: 36, borderRadius: 18}]}><Ionicons name="close" size={24} color={c.text}/></EditTapChoice></View>
        {subtitle && <Text style={f.sheetSubtitle}>{subtitle}</Text>}
        <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled contentContainerStyle={f.sheetContent} showsVerticalScrollIndicator={showsVerticalScrollIndicator}>{children}</ScrollView>
      </View>
    </View>
  </Modal>;
}

export type FormOption = {id: string; label: string; detail?: string; group?: string};
export function StudyField({label, value, options, onSelect, disabled, searchable = false, showsVerticalScrollIndicator = true}: {label: string; value?: string; options: FormOption[]; onSelect: (id: string) => void; disabled?: boolean; searchable?: boolean; showsVerticalScrollIndicator?: boolean}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = options.filter(item => item.label.toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <EditTapChoice accessibilityLabel={`${label}, ${value || 'Choose'}`} disabled={disabled} onPress={() => {setQuery(''); setOpen(true);}} style={f.field}>
      <View style={f.flex}><Text style={f.fieldLabel}>{label}</Text><Text style={[f.fieldValue, !value && {color: c.hint}]}>{options.find(option => option.id === value)?.label || value || 'Choose'}</Text></View><Ionicons name="chevron-down" size={18} color={c.accent}/>
    </EditTapChoice>
    <FormSheet visible={open} title={label} showsVerticalScrollIndicator={showsVerticalScrollIndicator} onClose={() => setOpen(false)}>
      {searchable && <TextInput accessibilityLabel={`Search ${label.toLowerCase()}`} value={query} onChangeText={setQuery} placeholder="Search courses" placeholderTextColor={c.hint} style={f.search}/>}
      {filtered.map((item, index) => <React.Fragment key={item.id}>
        {item.group && item.group !== filtered[index - 1]?.group && <Text style={f.groupLabel}>{item.group}</Text>}
        <FormChoice label={item.label} detail={item.detail} checked={value === item.id} disabled={disabled} onPress={() => {onSelect(item.id); setOpen(false);}}/>
      </React.Fragment>)}
      {!filtered.length && <Text style={f.note}>No matching courses.</Text>}
    </FormSheet>
  </>;
}

type Topic = {id: string; title: string; options: readonly {id: string; label: string}[]};
export function TopicCards({kind, topics, answers, onSelect, disabled}: {kind: 'lifestyle' | 'personality'; topics: readonly Topic[]; answers: Record<string, string>; onSelect: (id: string, value: string) => void; disabled?: boolean}) {
  const [open, setOpen] = useState<string | null>(null);
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const {width, height, fontScale} = useWindowDimensions();
  const grid = kind === 'lifestyle';
  const single = width < 340 || fontScale > 1.25;
  const design = grid ? lifestyleDesign : personalityDesign;
  const colors: Record<string, string> = {drink: '#38252E', smoke: '#382E25', exercise: '#2D2839', pets: '#283127', communication: '#2D2839', love_reception: '#38252E', personality: '#382E25', star_sign: '#283127'};
  const active = topics.find(topic => topic.id === open);
  const openTopic = (id: string) => {
    if (Platform.OS === 'web') setOpen(id);
    else navigation.navigate('ProfileTopicOptions', {kind, id, selected: answers[id] || '', returnKey: route.key});
  };
  return <>
    <View style={f.hintRow}><Text style={f.note}>Tap a card to choose.</Text><Text style={f.count}>{topics.filter(topic => answers[topic.id]).length}/{topics.length} answered</Text></View>
    <View style={[f.topicList, grid && f.topicGrid]}>{topics.map(topic => {
      const answer = topic.options.find(option => option.id === answers[topic.id])?.label;
      const look = design[topic.id];
      return <EditTapChoice key={topic.id} disabled={disabled} accessibilityLabel={`${look.label}, ${answer || 'Add answer'}`} onPress={() => openTopic(topic.id)} style={[f.topic, {backgroundColor: colors[topic.id]}, grid ? {width: single ? '100%' : '48%', minHeight: height < 740 ? 162 : 182} : f.topicRow]}>
        {grid ? <>
          <View style={f.row}><Text style={[f.topicTitle, f.flex]}>{look.label}</Text><TopicMark checked={!!answer}/></View>
          <View pointerEvents="none" style={f.lifestyleArt}><LifestyleArt id={topic.id}/></View>
          <View style={f.row}><Text style={[f.answer, f.flex, !answer && {color: c.muted}]}>{answer || 'Add answer'}</Text>{answer && <Ionicons name="pencil-outline" size={12} color={c.accent}/>}</View>
        </> : <>
          <View pointerEvents="none" style={f.personalityArt}><ConnectionArt id={topic.id}/></View>
          <View style={f.flex}><Text style={f.topicTitle}>{look.label}</Text><Text style={[f.answer, {marginTop: 5}, !answer && {color: c.muted}]}>{answer || 'Add answer'}</Text></View><TopicMark checked={!!answer}/>
        </>}
      </EditTapChoice>;
    })}</View>
    {Platform.OS === 'web' && <FormSheet visible={!!active} title={active?.title ?? ''} backgroundColor="#242321" onClose={() => setOpen(null)}>
      {active && <TopicOptionList topic={active} selected={answers[active.id] || ''} onSelect={value => {onSelect(active.id, value); setOpen(null);}}/>}
    </FormSheet>}
  </>;
}

export function TopicOptionList({topic, selected, onSelect}: {topic: Topic; selected: string; onSelect: (value: string) => void}) {
  return <>
    {topic.options.map(option => <FormChoice key={option.id} label={option.label} checked={selected === option.id} surfaceColor="#3C3937" onPress={() => onSelect(option.id)}/>)}
    <EditTapChoice accessibilityLabel="Clear answer" disabled={!selected} onPress={() => onSelect('')}
      style={[f.help, {alignSelf: 'center', justifyContent: 'center', opacity: selected ? 1 : 0.4}]}>
      <Ionicons name="close-circle-outline" size={17} color={c.accent}/><Text style={f.link}>Clear answer</Text>
    </EditTapChoice>
  </>;
}

function TopicMark({checked}: {checked: boolean}) {return checked ? <SelectionMark checked/> : <View style={f.add}><Ionicons name="add" size={18} color={c.accent}/></View>;}

export function AttendanceCards({options, value, onSelect, disabled}: {options: readonly {id: string; label: string}[]; value: string | null; onSelect: (id: string) => void; disabled?: boolean}) {
  const {width, fontScale} = useWindowDimensions();
  return <View style={f.intentionGrid}>{options.map((option, index) => <EditTapChoice key={option.id} disabled={disabled} accessibilityRole="radio" accessibilityLabel={option.label} accessibilityState={{checked: value === option.id}} onPress={() => onSelect(option.id)} style={[f.attendance, {backgroundColor: ['#2D2839', '#283127', '#38252E', '#382E25'][index]}, (width < 340 || fontScale > 1.25) && {width: '100%'}]}>
    <View style={f.attendanceCheck}><SelectionMark checked={value === option.id}/></View><View pointerEvents="none" style={f.attendanceArt}><SocialArt kind={index}/></View><Text style={f.intentionTitle}>{option.label}</Text>
  </EditTapChoice>)}</View>;
}

export const formStyles = StyleSheet.create({
  page: {flex: 1, backgroundColor: c.canvas},
  body: {flex: 1},
  content: {width: '100%', maxWidth: 500, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 18, paddingBottom: 32},
});
export const f = StyleSheet.create({
  flex: {flex: 1, minWidth: 0}, row: {flexDirection: 'row', alignItems: 'center', gap: 8},
  hero: {flexDirection: 'row', alignItems: 'center', gap: 4},
  title: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 38, lineHeight: 44, color: c.text, paddingBottom: 6},
  center: {textAlign: 'center'}, heroArt: {width: 100, height: 100},
  subtitle: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 20, color: c.muted, marginTop: 6},
  choice: {minHeight: 58, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 8},
  compactChoice: {minHeight: 50, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, gap: 8, marginBottom: 0},
  selected: {backgroundColor: c.selected},
  choiceLabel: {fontFamily: 'DMSans_500Medium', fontSize: 16, lineHeight: 23, color: c.text},
  detail: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 19, color: c.muted, marginTop: 3},
  radio: {width: 23, height: 23, flexShrink: 0, borderRadius: 12, borderWidth: 1.5, borderColor: '#847A7C', alignItems: 'center', justifyContent: 'center'},
  radioChecked: {borderColor: c.accent, backgroundColor: c.accent},
  visibility: {minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, marginTop: 18, borderRadius: 18, backgroundColor: c.surface},
  visibilityLabel: {fontFamily: 'DMSans_500Medium', fontSize: 13, lineHeight: 20, color: c.text},
  field: {minHeight: 78, borderRadius: 20, backgroundColor: c.surface, paddingHorizontal: 18, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12},
  fieldLabel: {fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 16, color: c.muted},
  fieldValue: {fontFamily: 'DMSans_500Medium', fontSize: 16, lineHeight: 23, color: c.text, marginTop: 4},
  hintRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 22, marginBottom: 12},
  note: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, color: c.muted},
  count: {fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 18, color: c.accent},
  topicList: {gap: 10}, topicGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between'},
  topic: {borderRadius: 23, padding: 15, overflow: 'hidden', justifyContent: 'space-between'},
  topicRow: {flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 96, paddingHorizontal: 13, paddingVertical: 12},
  topicTitle: {fontFamily: 'DMSans_700Bold', fontSize: 15, lineHeight: 22, color: c.text},
  answer: {fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 18, color: c.accent},
  lifestyleArt: {width: 88, height: 82, alignSelf: 'flex-end'}, personalityArt: {width: 72, height: 64},
  add: {width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF12'},
  intentionGrid: {marginTop: 18, flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between'},
  intentionTitle: {fontFamily: 'DMSans_700Bold', fontSize: 14, lineHeight: 19, color: c.text, marginTop: 6},
  attendance: {width: '48%', minHeight: 132, borderRadius: 22, padding: 12, justifyContent: 'flex-end'},
  attendanceArt: {width: 78, height: 70}, attendanceCheck: {position: 'absolute', top: 10, right: 12},
  modal: {flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000099'},
  sheet: {maxHeight: '90%', backgroundColor: c.canvas, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 20},
  sheetHeader: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 24, marginBottom: 8},
  sheetTitle: {flex: 1, fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 30, lineHeight: 38, color: c.text, paddingBottom: 4},
  close: {width: 44, height: 44, borderRadius: 22, backgroundColor: c.selected, alignItems: 'center', justifyContent: 'center'},
  sheetSubtitle: {fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 22, color: c.muted, paddingHorizontal: 24, marginBottom: 18},
  sheetContent: {paddingHorizontal: 24, paddingBottom: 16},
  search: {minHeight: 52, borderRadius: 26, paddingHorizontal: 18, fontFamily: 'DMSans_400Regular', fontSize: 15, color: c.text, backgroundColor: c.surface, marginBottom: 16},
  groupLabel: {fontFamily: 'DMSans_700Bold', fontSize: 12, lineHeight: 18, color: c.muted, marginTop: 14, marginBottom: 10},
  help: {alignSelf: 'flex-start', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8},
  link: {fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 19, color: c.accent},
});
