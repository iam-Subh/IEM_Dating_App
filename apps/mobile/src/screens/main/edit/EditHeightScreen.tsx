import {EditSaveFooter} from '../../../components/EditSaveFooter';
import {createEditStyles} from '../../../components/ProfileEditDesign';
import {FormTitle} from '../../../components/ProfileEditForms';
import React, {useState, useRef, useCallback, memo} from 'react';
import {Alert, View, Text, type FlatList, type ListRenderItemInfo} from 'react-native';
import Animated, {runOnJS, useAnimatedReaction, useAnimatedScrollHandler, useSharedValue} from 'react-native-reanimated';
import {LinearGradient} from 'expo-linear-gradient';
import {useNavigation, useRoute} from '@react-navigation/native';
import {EditScreenHeader} from '../../../components/EditScreenHeader';
import {api} from '../../../services/api';
import {useDispatch} from 'react-redux';
import {updateUser} from '../../../store/authSlice';
import {HEIGHT_ROW_SIZE, MAX_HEIGHT, MIN_HEIGHT, heightSelectionIndex} from './heightPickerSelection';

  const ITEM_HEIGHT = HEIGHT_ROW_SIZE;
const VISIBLE_ITEMS = 5;
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;
const SELECTION_HEIGHT = 48;
const SELECTION_INSET = (ITEM_HEIGHT - SELECTION_HEIGHT) / 2;

// Helper to convert CM to FT'IN"
const cmToFtIn = (cm: number) => {
  const realInches = cm / 2.54;
  const feet = Math.floor(realInches / 12);
  let inches = Math.round(realInches % 12);
  
  if (inches === 12) {
    return `${feet + 1}'0"`;
  }
  return `${feet}'${inches}"`;
};

// Generate height range: 91cm (3'0") to 244cm (8'0")
const HEIGHTS = Array.from({ length: MAX_HEIGHT - MIN_HEIGHT + 1 }, (_, i) => MIN_HEIGHT + i);
// Empty rows keep the first and last heights centered. Each list offset now
// matches heightSelectionIndex without an extra header or padding offset.
const WHEEL_ROWS: (number | null)[] = [null, null, ...HEIGHTS, null, null];
const heightRowLayout = (_: unknown, index: number) => ({ length: ITEM_HEIGHT, offset: index * ITEM_HEIGHT, index });
const heightRowKey = (_: number | null, index: number) => String(index);
const HeightRow = memo(({ height, highlighted = false }: { height: number | null; highlighted?: boolean }) => (
  <View style={styles.item}>
    {height !== null && <>
    <Text style={[styles.cmText, highlighted && styles.selectedCm]}>{height} cm</Text>
    <Text style={[styles.ftText, highlighted && styles.selectedFt]}>({cmToFtIn(height)})</Text>
    </>}
  </View>
));
const renderHeightRow = ({ item }: ListRenderItemInfo<number | null>) => <HeightRow height={item} />;

export const EditHeightScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const { currentHeight } = route.params || {};

  const initialValue = Math.max(91, Math.min(244, Math.round(Number(currentHeight) || 165)));
  const initialIndex = HEIGHTS.indexOf(initialValue);

  const [selectedHeight, setSelectedHeight] = useState(initialValue);
  const selectedHeightRef = useRef(initialValue);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const scrollY = useSharedValue(initialIndex * ITEM_HEIGHT);
  const scrollRef = useRef<FlatList<number | null>>(null);

  const updateSelection = useCallback((newValue: number) => {
    if (newValue !== selectedHeightRef.current) {
      selectedHeightRef.current = newValue;
      setSelectedHeight(newValue);
    }
  }, []);
  useAnimatedReaction(
    () => heightSelectionIndex(scrollY.value),
    (index, previous) => { if (index !== previous) runOnJS(updateSelection)(MIN_HEIGHT + index); },
    [updateSelection],
  );
  const handleScroll = useAnimatedScrollHandler({
    onScroll: (event) => { scrollY.value = event.contentOffset.y; },
  });

  const handleSave = async () => {
    if (savingRef.current) return;
    // Read the displayed selection, including a tap on Save during momentum.
    const index = heightSelectionIndex(scrollY.value);
    const height = HEIGHTS[index];
    updateSelection(height);
    scrollRef.current?.scrollToOffset({ offset: index * ITEM_HEIGHT, animated: false });
    savingRef.current = true;
    setSaving(true);
    try {
      const response = await api.put('/profile', { height });
      if (!response.data?.success || response.data.data?.height !== height) {
        throw new Error(response.data?.message && !response.data?.success
          ? response.data.message : 'The server did not confirm your height. Please try again.');
      }
      dispatch(updateUser(response.data.data));
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Could not save height', err.response?.data?.message || err.message || 'Please try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <EditScreenHeader
        title="Height"
        onCancel={() => navigation.goBack()}
        onSave={handleSave}
        saving={saving}
        hasUnsavedChanges={selectedHeight !== currentHeight}
      />

      <View style={styles.content} pointerEvents={saving ? 'none' : 'auto'}>
        <FormTitle center subtitle="Swipe to choose your height.">{'How tall\nare you?'}</FormTitle>

        <View style={styles.pickerContainer}>
          <Animated.FlatList
            ref={scrollRef}
            data={WHEEL_ROWS}
            renderItem={renderHeightRow}
            keyExtractor={heightRowKey}
            getItemLayout={heightRowLayout}
            initialScrollIndex={initialIndex}
            initialNumToRender={9}
            maxToRenderPerBatch={8}
            windowSize={5}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews={false}
            contentOffset={{ x: 0, y: initialIndex * ITEM_HEIGHT }}
            scrollEnabled={!saving}
            snapToInterval={ITEM_HEIGHT}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            decelerationRate="normal"
            bounces={false}
            overScrollMode="never"
          />
          <View style={styles.highlightClip} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <HeightRow height={selectedHeight} highlighted />
          </View>
          <LinearGradient colors={['#171614', 'rgba(23,22,20,0)']} style={styles.topFade} pointerEvents="none" />
          <LinearGradient colors={['rgba(23,22,20,0)', '#171614']} style={styles.bottomFade} pointerEvents="none" />
          <View style={styles.indicator} pointerEvents="none" />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerValue}>{selectedHeight} cm • {cmToFtIn(selectedHeight)}</Text>
        </View>
      </View>
    <EditSaveFooter
      onSave={handleSave}
      saving={saving}
      hasUnsavedChanges={selectedHeight !== currentHeight}
    />
  </View>
  );
};

const styles = createEditStyles({
  container: { flex: 1, backgroundColor: '#100F0D' },
  content: { flex: 1, paddingHorizontal: 25, paddingTop: 40 },
  title: { fontSize: 32, fontWeight: '800', color: '#FFF', marginBottom: 12 },
  subtitle: { fontSize: 16, color: 'rgba(255,255,255,0.5)', marginBottom: 50 },

  pickerContainer: {
    height: WHEEL_HEIGHT,
    width: '100%',
    backgroundColor: '#171614',
    borderRadius: 24,
    overflow: 'hidden',
    position: 'relative',
    marginTop: 28,
  },
  indicator: {
    position: 'absolute',
    top: ITEM_HEIGHT * 2 + SELECTION_INSET,
    left: 20,
    right: 20,
    height: SELECTION_HEIGHT,
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: '#FFB8C7',
    zIndex: 1,
  },
  highlightClip: { position: 'absolute', top: ITEM_HEIGHT * 2, left: 0, right: 0, height: ITEM_HEIGHT, overflow: 'hidden', backgroundColor: '#171614' },
  topFade: { position: 'absolute', top: 0, left: 0, right: 0, height: ITEM_HEIGHT * 2 + SELECTION_INSET },
  bottomFade: { position: 'absolute', bottom: 0, left: 0, right: 0, height: ITEM_HEIGHT * 2 + SELECTION_INSET },
  item: {
    height: ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  cmText: {
    fontSize: 22,
    fontWeight: '800', // Sticking to a single high weight prevents layout recalculation lag
    color: '#DDD0D5',
    marginRight: 10,
  },
  ftText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#BDB7C0',
  },
  selectedCm: { color: '#FFB8C7', fontSize: 26 },
  selectedFt: { color: '#FFFFFF', fontSize: 20 },
  footer: {
    marginTop: 18,
    alignItems: 'center',
    paddingVertical: 12,
  },
  footerValue: {
    fontSize: 24,
    fontWeight: '900',
    color: '#FFF',
  }
});
