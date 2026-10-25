import React, {useEffect, useRef, useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {CommonActions, useNavigation, useRoute} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {LIFESTYLE_SECTIONS, PERSONALITY_SECTIONS} from '../../../core/profile/profileOptions';
import {TopicOptionList} from '../../../components/ProfileEditForms';
import {ConnectionSheetHeader} from '../../../features/auth/onboarding/ConnectionDesign';

export function ProfileTopicOptionsSheet() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const kind = route.params?.kind;
  const topics = kind === 'lifestyle' ? LIFESTYLE_SECTIONS
    : kind === 'personality' ? PERSONALITY_SECTIONS.filter(topic => topic.id !== 'education') : [];
  const topic = topics.find(item => item.id === route.params?.id);
  const [selected, setSelected] = useState<string>(route.params?.selected || '');
  const selecting = useRef(false);
  const dismissFrame = useRef<number | null>(null);
  useEffect(() => () => {
    if (dismissFrame.current !== null) cancelAnimationFrame(dismissFrame.current);
  }, []);

  const select = (value: string) => {
    if (!topic || selecting.current || !route.params?.returnKey) return;
    selecting.current = true;
    setSelected(value);
    navigation.dispatch({
      ...CommonActions.setParams({profileTopicAnswer: {kind, id: topic.id, value}}),
      source: route.params.returnKey,
    });
    dismissFrame.current = requestAnimationFrame(() => navigation.goBack());
  };

  const content = <>
    <ConnectionSheetHeader dark title={topic?.title || 'Options'} onClose={() => navigation.goBack()} style={styles.header}/>
    {topic && <TopicOptionList topic={topic} selected={selected} onSelect={select}/>}
  </>;
  const bottom = {paddingBottom: Math.max(insets.bottom, 18) + 18};
  return topic && topic.options.length > 6
    ? <ScrollView nestedScrollEnabled style={styles.scroll} contentContainerStyle={[styles.content, bottom]} showsVerticalScrollIndicator>{content}</ScrollView>
    : <View style={[styles.content, bottom]}>{content}</View>;
}

const styles = StyleSheet.create({
  scroll: {flex: 1, backgroundColor: '#242321'},
  content: {backgroundColor: '#242321', paddingHorizontal: 24, paddingTop: 18},
  header: {marginBottom: 16},
});
