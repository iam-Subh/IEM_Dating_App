import React, {useEffect, useRef, useState, type Dispatch, type SetStateAction} from 'react';
import {CommonActions, useNavigation, useRoute} from '@react-navigation/native';
import {ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ClubSelectionGrid} from '../../../components/ClubSelectionGrid';
import {ConnectionSheetHeader} from '../../../features/auth/onboarding/ConnectionDesign';

export function ProfileClubSelectionSheet() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const [selectedClubs, setSelectedClubs] = useState<string[]>(route.params?.selectedClubs ?? []);
  const currentSelection = useRef(selectedClubs);
  const scrolling = useRef(false);
  const scrollEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beginScroll = () => {
    if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
    scrolling.current = true;
  };
  const endScroll = () => {
    if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
    scrollEndTimer.current = setTimeout(() => {scrolling.current = false;}, 160);
  };
  useEffect(() => () => {
    if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
  }, []);

  const changeSelection: Dispatch<SetStateAction<string[]>> = update => {
    const next = typeof update === 'function' ? update(currentSelection.current) : update;
    currentSelection.current = next;
    setSelectedClubs(next);
    if (route.params?.returnKey) {
      navigation.dispatch({
        ...CommonActions.setParams({clubSelection: next}),
        source: route.params.returnKey,
      });
    }
  };

  return <View style={styles.page}>
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
      onScrollBeginDrag={beginScroll} onScrollEndDrag={endScroll}
      onMomentumScrollBegin={beginScroll} onMomentumScrollEnd={endScroll}
      contentContainerStyle={[styles.content, {paddingBottom: Math.max(insets.bottom, 18) + 24}]}>
      <ConnectionSheetHeader dark compact title="Your college clubs" onClose={() => navigation.goBack()} style={styles.header}/>
      <ClubSelectionGrid selected={selectedClubs} onChange={changeSelection} shouldIgnorePress={() => scrolling.current} lightCards compactHeading/>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#242321'},
  content: {width: '100%', maxWidth: 500, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 18},
  header: {marginBottom: 8},
});
