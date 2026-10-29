import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HowItWorksContent } from './HowItWorks';
import { SwipeLesson } from './SwipeLesson';

/** Settings, Safety and help: "How IEM Connect works", any time. */
export function HowItWorksScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  return <HowItWorksContent onClose={() => navigation.goBack()} topInset={insets.top} bottomInset={insets.bottom} />;
}

/** Settings, Safety and help: the swipe lesson again, for anyone who skipped it. */
export function SwipeLessonScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  return <SwipeLesson onDone={() => navigation.goBack()} topInset={insets.top} bottomInset={insets.bottom} />;
}
