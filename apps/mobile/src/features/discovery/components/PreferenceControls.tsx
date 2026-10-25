import React, { useEffect, useMemo, useRef, useState } from 'react';
import { kmToMi, miToKm, unitName, useDistanceUnit } from '../../location/distanceUnits';
import { FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector, GestureHandlerRootView, Pressable } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, Easing, interpolateColor, runOnJS, useAnimatedProps, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PREFERENCE_COLORS, PreferenceOption } from '../preferenceOptions';
import { PREFERENCE_AGE_MAX, PREFERENCE_AGE_MIN } from '@iem-dating/shared/age';

const ACCENT = PREFERENCE_COLORS.accent;
type OptionRow = { key: string; heading?: string; count?: number; options: PreferenceOption[] };

const AnimatedInput = Animated.createAnimatedComponent(TextInput);

export function PreferenceRangeSlider({ minimum, maximum, onChange, lowerLimit = 18, upperLimit = 60, unit = 'age' }: {
  minimum: number; maximum: number; onChange: (minimum: number, maximum: number) => void;
  lowerLimit?: number; upperLimit?: number; unit?: string;
}) {
  const width = useSharedValue(0);
  const low = useSharedValue(minimum);
  const high = useSharedValue(maximum);
  const dragging = useSharedValue(false);
  const start = useSharedValue(0);
  useEffect(() => {
    if (!dragging.value) { low.value = minimum; high.value = maximum; }
  }, [minimum, maximum, low, high, dragging]);
  const makeDrag = (lower: boolean) => Gesture.Pan().minDistance(0)
    .onStart(() => { dragging.value = true; start.value = lower ? low.value : high.value; })
    .onUpdate((event) => {
      if (!width.value) return;
      const next = start.value + event.translationX / width.value * (upperLimit - lowerLimit);
      if (lower) low.value = Math.max(lowerLimit, Math.min(high.value - 1, next));
      else high.value = Math.min(upperLimit, Math.max(low.value + 1, next));
    })
    .onEnd(() => {
      low.value = Math.round(low.value);
      high.value = Math.round(high.value);
      runOnJS(onChange)(low.value, high.value);
    })
    .onFinalize((_event, success) => {
      if (!success) { low.value = minimum; high.value = maximum; }
      dragging.value = false;
    });
  const lowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (low.value - lowerLimit) / (upperLimit - lowerLimit) * width.value }] }));
  const highStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (high.value - lowerLimit) / (upperLimit - lowerLimit) * width.value }] }));
  const trackStyle = useAnimatedStyle(() => ({ left: (low.value - lowerLimit) / (upperLimit - lowerLimit) * width.value, width: (high.value - low.value) / (upperLimit - lowerLimit) * width.value }));
  const labelProps = useAnimatedProps<any>(() => {
    const text = `${Math.round(low.value)}–${Math.round(high.value)}${unit === 'cm' ? ' cm' : ''}`;
    return { text, defaultValue: text };
  });
  return <View>
    <View style={styles.rangeHeader}>
      <Text style={styles.optionText}>{unit === 'cm' ? 'Height range' : 'Age range'}</Text>
      <AnimatedInput animatedProps={labelProps} editable={false} pointerEvents="none" underlineColorAndroid="transparent"
        defaultValue={`${minimum}–${maximum}${unit === 'cm' ? ' cm' : ''}`} style={styles.liveRangeValue} />
    </View>
    <View style={styles.rangeInset}>
      <View style={styles.range} onLayout={(event) => { width.value = event.nativeEvent.layout.width; }}>
        <View style={styles.track} /><Animated.View pointerEvents="none" style={[styles.selectedTrack, trackStyle]} />
        {([true, false] as const).map((lower) => <GestureDetector key={String(lower)} gesture={makeDrag(lower)}>
          <Animated.View accessible accessibilityRole="adjustable"
            accessibilityLabel={`${lower ? 'Minimum' : 'Maximum'} ${unit === 'cm' ? 'height in centimetres' : unit}`}
            accessibilityValue={{ min: lower ? lowerLimit : minimum + 1, max: lower ? maximum - 1 : upperLimit, now: lower ? minimum : maximum }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(event) => {
              const step = event.nativeEvent.actionName === 'increment' ? 1 : -1;
              if (lower) onChange(Math.max(lowerLimit, Math.min(maximum - 1, minimum + step)), maximum);
              else onChange(minimum, Math.min(upperLimit, Math.max(minimum + 1, maximum + step)));
            }} style={[styles.thumbTouch, lower ? lowStyle : highStyle]}>
            <View style={styles.thumb} />
          </Animated.View>
        </GestureDetector>)}
      </View>
      <View style={styles.rangeLabels}><Text style={styles.secondary}>{lowerLimit}{unit === 'cm' ? ' cm' : ''}</Text><Text style={styles.secondary}>{upperLimit}{unit === 'cm' ? ' cm' : ''}</Text></View>
    </View>
  </View>;
}
/** Ages run 18-35 (@iem-dating/shared/age): the latest usual PhD finish, plus five. */
export function AgeRangeSlider(props: { minimum: number; maximum: number; onChange: (minimum: number, maximum: number) => void }) {
  return <PreferenceRangeSlider {...props} lowerLimit={PREFERENCE_AGE_MIN} upperLimit={PREFERENCE_AGE_MAX} />;
}

export function PreferenceToggle({ value, onChange, label, hint, disabled = false }: { value: boolean; onChange: (value: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  const progress = useSharedValue(value ? 1 : 0);
  useEffect(() => { progress.value = withTiming(value ? 1 : 0, { duration: 140 }); }, [value, progress]);
  const track = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(progress.value, [0, 1], ['#535057', ACCENT]) }));
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: progress.value * 18 }] }));
  return <Pressable accessibilityRole="switch" accessibilityState={{ checked: value, disabled }} accessibilityLabel={label} accessibilityHint={hint}
    disabled={disabled} onPress={() => onChange(!value)} style={[styles.toggleTouch, disabled && { opacity: 0.4 }]}>
    <Animated.View style={[styles.toggleTrack, track]}><Animated.View style={[styles.toggleThumb, thumb]} /></Animated.View>
  </Pressable>;
}

/** In the chosen unit (Settings > Distance units); the value in and out is always km. */
export function PreferenceDistanceSlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const unit = useDistanceUnit();
  const toShown = (km: number) => (unit === 'mi' ? Math.max(1, Math.round(kmToMi(km))) : km);
  const max = unit === 'mi' ? Math.round(kmToMi(100)) : 100;
  const [display, setDisplay] = useState(toShown(value));
  useEffect(() => setDisplay(toShown(value)), [value, unit]);
  return <View>
    <View style={styles.rangeHeader}><Text style={styles.optionText}>Maximum distance</Text><Text style={styles.rangeValue}>{display} {unit}</Text></View>
    <Slider minimumValue={1} maximumValue={max} step={1} value={toShown(value)} onValueChange={setDisplay}
      onSlidingComplete={(shown) => onChange(unit === 'mi' ? Math.min(100, Math.max(1, Math.round(miToKm(shown)))) : shown)}
      minimumTrackTintColor={ACCENT} maximumTrackTintColor="#51464C" thumbTintColor={ACCENT} style={{ height: 38, marginHorizontal: -6, marginTop: 7 }} accessibilityLabel={`Maximum distance in ${unitName(unit)}`} />
    <View style={styles.rangeLabels}><Text style={styles.secondary}>1 {unit}</Text><Text style={styles.secondary}>{max} {unit}</Text></View>
  </View>;
}
export type { PreferenceOption } from '../preferenceOptions';

export function PreferenceChoiceSheet({ title, detail, options, selected, multiple = false, searchable = false,
  profileAnswer = [], profileAnswerLabel, required = false, onRequirementChange, requirementLockedReason, range, onChange, onClose }: {
  title: string; detail?: string; options: PreferenceOption[]; selected: string[];
  multiple?: boolean; searchable?: boolean; onChange: (values: string[]) => void; onClose: () => void;
  profileAnswer?: string[]; profileAnswerLabel?: string; required?: boolean;
  onRequirementChange?: (value: boolean) => void;
  /** Why "Must match" cannot be turned on here (no own answer, or the limit reached). */
  requirementLockedReason?: string;
  range?: { minimum: number; maximum: number; unit: string };
}) {
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);
  const { height: windowHeight } = useWindowDimensions();
  const height = useSharedValue(windowHeight);
  const offset = useSharedValue(windowHeight);
  const ready = useSharedValue(false);
  const shown = useRef(false);
  const measured = useRef(false);
  const opened = useRef(false);
  const dragStart = useSharedValue(0);
  const startOpening = () => {
    if (!shown.current || !measured.current || opened.current) return;
    opened.current = true;
    offset.value = height.value;
    ready.value = true;
    offset.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
    progress.value = withTiming(1, { duration: 180 });
  };
  const closing = useSharedValue(false);
  const [draft, setDraft] = useState(selected);
  const [query, setQuery] = useState('');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [mustMatch, setMustMatch] = useState(required);
  const [rangeValues, setRangeValues] = useState(() => [Number(selected[0] ?? range?.minimum ?? 18), Number(selected[1] ?? range?.maximum ?? 60)]);
  const optionRows = useMemo<OptionRow[]>(() => {
    const groups = new Map<string, PreferenceOption[]>();
    const search = query.trim().toLowerCase();
    for (const option of options) {
      if (!option.label.toLowerCase().includes(search) && !(option.section ?? '').toLowerCase().includes(search)) continue;
      const key = option.section ?? '';
      const group = groups.get(key) ?? [];
      group.push(option);
      groups.set(key, group);
    }
    const rows: OptionRow[] = [];
    for (const [section, items] of groups) {
      if (section) rows.push({ key: `heading:${section}`, heading: section, count: items.length, options: [] });
      const columns = multiple ? 2 : 1;
      for (let index = 0; index < items.length; index += columns) {
        rows.push({ key: `${section}:${items[index].value}`, options: items.slice(index, index + columns) });
      }
    }
    return rows;
  }, [options, query, multiple]);
  // Reserve the final grid height before virtualized rows mount.
  const gridHeight = Math.min(windowHeight * 0.8, (profileAnswer.length ? 350 : 278) + Math.ceil(options.length / 2) * 66);

  useEffect(() => {
    if (!searchable) return;
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => { shown.remove(); hidden.remove(); };
  }, [searchable]);
  const close = () => {
    if (closing.value) return;
    closing.value = true;
    progress.value = withTiming(0, { duration: 170 });
    offset.value = withTiming(height.value, { duration: 170 }, (finished) => { if (finished) runOnJS(onClose)(); });
  };
  const drag = Gesture.Pan().activeOffsetY([-8, 8])
    .onStart(() => { cancelAnimation(offset); dragStart.value = offset.value; })
    .onUpdate((event) => { if (!closing.value) offset.value = Math.max(0, dragStart.value + event.translationY); })
    .onEnd((event) => {
      if (closing.value) return;
      if (offset.value > height.value * 0.25 || event.velocityY > 500) runOnJS(close)();
      else offset.value = withTiming(0, { duration: 160 });
    })
    .onFinalize((_event, success) => { if (!success && !closing.value) offset.value = withTiming(0, { duration: 160 }); });
  const motion = useAnimatedStyle(() => ({ opacity: ready.value ? 1 : 0, transform: [{ translateY: offset.value }] }));
  const dim = useAnimatedStyle(() => ({ opacity: progress.value }));
  const select = (value: string) => {
    if (closing.value) return;
    if (multiple) setDraft((previous) => previous.includes(value) ? previous.filter((item) => item !== value) : [...previous, value]);
    else { onChange([value]); close(); }
  };
  const submit = () => {
    if (closing.value) return;
    const next = range
      ? rangeValues[0] === range.minimum && rangeValues[1] === range.maximum ? [] : rangeValues.map(String)
      : draft;
    onRequirementChange?.(next.length > 0 && mustMatch);
    onChange(next);
    close();
  };
  const nextValues = range
    ? rangeValues[0] === range.minimum && rangeValues[1] === range.maximum ? [] : rangeValues.map(String)
    : draft;
  const changed = JSON.stringify([...nextValues].sort()) !== JSON.stringify([...selected].sort()) || (nextValues.length > 0 && mustMatch) !== required;
  const reset = () => {
    setDraft([]);
    setMustMatch(false);
    if (range) setRangeValues([range.minimum, range.maximum]);
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={close} onShow={() => { shown.current = true; startOpening(); }}>
      <GestureHandlerRootView style={styles.modal}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim, dim]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close preference options" />
        {/* Android Modal already resizes for the keyboard. Keep its viewport below the status bar. */}
        <KeyboardAvoidingView pointerEvents="box-none" behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.keyboardArea, { marginTop: insets.top + 8 }]}>
        <Animated.View style={[styles.sheet, { paddingBottom: keyboardOpen ? 12 : Math.max(16, insets.bottom + 10), maxHeight: keyboardOpen ? '100%' : '80%' }, multiple && !range && !searchable && { height: gridHeight }, searchable && styles.searchableSheet, keyboardOpen && styles.keyboardSheet, motion]}
          onLayout={(event) => { height.value = event.nativeEvent.layout.height; measured.current = true; startOpening(); }} accessibilityViewIsModal>
          <GestureDetector gesture={drag}>
            <View collapsable={false}>
              <View style={styles.handleArea}><View style={styles.handle} /></View>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle} accessibilityRole="header">{title}</Text>
                {(multiple || range) && <Pressable onPress={reset} style={styles.clearButton} accessibilityRole="button" accessibilityLabel={`Clear ${title.toLowerCase()} selections`}>
                  <Text style={styles.clearText}>Clear</Text>
                </Pressable>}
                <Pressable onPress={close} style={styles.close} accessibilityRole="button" accessibilityLabel="Close preference options">
                  <Ionicons name="close" size={19} color="#FFFFFF" />
                </Pressable>
              </View>
              {detail && !keyboardOpen && <Text style={styles.sheetDetail}>{detail}</Text>}
            </View>
          </GestureDetector>
          {profileAnswer.length > 0 && !keyboardOpen && <View style={styles.profileAnswer}>
            <View style={styles.optionBody}>
              <Text style={styles.answerCaption}>YOUR PROFILE</Text>
              <Text style={styles.answerText} numberOfLines={2}>{profileAnswerLabel}</Text>
            </View>
            <Pressable onPress={() => {
              if (range) {
                const value = Number(profileAnswer[0]);
                setRangeValues([Math.max(range.minimum, value - 5), Math.min(range.maximum, value + 5)]);
              } else setDraft(profileAnswer);
            }} accessibilityRole="button" accessibilityLabel={range ? 'Use a height range within five centimetres of your height' : 'Use my profile answers'} style={styles.useMine}>
              <Text style={styles.useMineText}>{range ? 'Within 5 cm' : 'Use mine'}</Text>
            </Pressable>
          </View>}
          {searchable && <View style={styles.search}>
            <Ionicons name="search" size={17} color="#BEB6BA" />
            <TextInput value={query} onChangeText={setQuery} placeholder={`Search ${title.toLowerCase()}`} placeholderTextColor={PREFERENCE_COLORS.secondary}
              accessibilityLabel={`Search ${title.toLowerCase()}`} style={styles.searchInput} autoCorrect={false} returnKeyType="search"
              onFocus={() => setKeyboardOpen(true)} onSubmitEditing={() => Keyboard.dismiss()} />
            {query.length > 0 && <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search text" hitSlop={8}>
              <Ionicons name="close-circle" size={19} color={PREFERENCE_COLORS.secondary} />
            </Pressable>}
          </View>}
          {range ? <View style={styles.heightRange}>
            <PreferenceRangeSlider minimum={rangeValues[0]} maximum={rangeValues[1]} lowerLimit={range.minimum} upperLimit={range.maximum} unit={range.unit}
              onChange={(minimum, maximum) => setRangeValues([minimum, maximum])} />
          </View> : <FlatList data={optionRows} keyExtractor={(row) => row.key} showsVerticalScrollIndicator={false}
            style={[styles.optionList, (searchable || multiple) && styles.searchableList]} contentContainerStyle={styles.options} keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag" initialNumToRender={12} removeClippedSubviews={false}
            accessibilityRole={multiple ? undefined : 'radiogroup'}
            ListHeaderComponent={multiple ? <Pressable onPress={reset} style={[styles.openPill, !draft.length && styles.optionSelected]} accessibilityRole="checkbox" accessibilityState={{ checked: !draft.length }}>
              <Text style={[styles.optionText, styles.optionBody]}>Open to all</Text>
              <View style={[styles.check, !draft.length && styles.checkSelected]}>{!draft.length && <Ionicons name="checkmark" size={16} color={PREFERENCE_COLORS.accentText} />}</View>
            </Pressable> : null}
            ListEmptyComponent={<Text style={styles.empty}>No options found. Try another name.</Text>}
            renderItem={({ item: row }) => row.heading ? (
              <View style={styles.optionSectionHeader}>
                <Text style={styles.optionSectionTitle} accessibilityRole="header">{row.heading}</Text>
                <Text style={styles.optionSectionCount}>{row.count}</Text>
              </View>
            ) : (
              <View style={styles.pillRow}>
                {row.options.map((option) => {
                  const checked = draft.includes(option.value);
                  return <Pressable key={option.value} onPress={() => select(option.value)} accessibilityRole={multiple ? 'checkbox' : 'radio'}
                    accessibilityState={{ checked }} style={({ pressed }) => [styles.option, styles.optionCell, multiple && styles.optionPill, checked && styles.optionSelected, pressed && styles.pressed]}>
                    <View style={styles.optionBody}>
                      <Text style={[styles.optionText, checked && styles.selectedOptionText]}>{option.label}</Text>
                      {option.detail && <Text style={styles.optionDetail}>{option.detail}</Text>}
                    </View>
                    {!multiple && <View style={[styles.check, checked && styles.checkSelected]}>
                      {checked && <Ionicons name="checkmark" size={16} color={PREFERENCE_COLORS.accentText} />}
                    </View>}
                  </Pressable>;
                })}
                {multiple && row.options.length === 1 && <View style={styles.optionCell} />}
              </View>
            )} />}
          {onRequirementChange && !keyboardOpen && <View style={styles.requirement}>
            <View style={styles.optionBody}><Text style={styles.optionText}>Must match</Text><Text style={styles.optionDetail}>
              {requirementLockedReason && !mustMatch ? requirementLockedReason : 'Only people with a matching answer - and they only see you if you match theirs.'}
            </Text></View>
            <PreferenceToggle value={mustMatch} onChange={setMustMatch} label="Must match this preference"
              disabled={!!requirementLockedReason && !mustMatch} />
          </View>}
          {(multiple || range) && changed && <View style={styles.sheetActions}>
            <Pressable onPress={submit} style={styles.done} accessibilityRole="button">
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>}
        </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  liveRangeValue: { color: ACCENT, fontFamily: 'DMSans_700Bold', fontSize: 18, padding: 0, textAlign: 'right', minWidth: 115 },
  toggleTouch: { width: 48, height: 44, alignItems: 'center', justifyContent: 'center' },
  toggleTrack: { width: 40, height: 22, borderRadius: 11, padding: 2 },
  toggleThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#FFFFFF' },
  pillRow: { flexDirection: 'row', gap: 8 },
  optionCell: { flex: 1 },
  optionSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 5, paddingTop: 16, paddingBottom: 10 },
  optionSectionTitle: { flex: 1, color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 15 },
  optionSectionCount: { color: PREFERENCE_COLORS.secondary, fontFamily: 'DMSans_500Medium', fontSize: 12 },
  selectedOptionText: { color: ACCENT },
  optionPill: { flex: 1, borderRadius: 24, backgroundColor: '#383238', marginBottom: 8, minHeight: 44 },
  openPill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 10, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, marginVertical: 6, backgroundColor: '#383238' },
  rangeInset: { paddingHorizontal: 21, marginTop: 8 },
  range: { height: 42, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: '#51464C' },
  selectedTrack: { position: 'absolute', height: 4, top: 19, backgroundColor: ACCENT },
  thumbTouch: { position: 'absolute', left: -21, top: 0, width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 23, height: 23, borderRadius: 12, backgroundColor: ACCENT },
  rangeLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -3 },
  secondary: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: PREFERENCE_COLORS.secondary },
  modal: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  keyboardArea: { flex: 1, width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  dim: { backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { width: '100%', maxWidth: 600, backgroundColor: PREFERENCE_COLORS.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26 },
  searchableSheet: { height: '80%' },
  keyboardSheet: { height: '100%' },
  handleArea: { height: 22, justifyContent: 'center', alignItems: 'center' },
  handle: { width: 34, height: 4, borderRadius: 2, backgroundColor: '#71676C' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 8 },
  sheetTitle: { flex: 1, color: '#FFFFFF', fontSize: 20, fontFamily: 'DMSans_700Bold' },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#393237', alignItems: 'center', justifyContent: 'center' },
  sheetDetail: { color: '#BEB6BA', fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19, paddingHorizontal: 20, paddingBottom: 10 },
  options: { paddingHorizontal: 12, paddingBottom: 4 },
  optionList: { flexGrow: 0, flexShrink: 1 },
  // Override optionList's explicit flexGrow; flex: 1 alone leaves it at zero.
  searchableList: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#393237', borderRadius: 24, marginHorizontal: 20, marginBottom: 10, paddingHorizontal: 13 },
  searchInput: { flex: 1, minHeight: 44, paddingVertical: 8, color: '#FFFFFF', fontFamily: 'DMSans_400Regular', fontSize: 14 },
  empty: { color: '#BEB6BA', fontFamily: 'DMSans_400Regular', fontSize: 14, paddingVertical: 24, textAlign: 'center' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 13, borderRadius: 14, marginBottom: 3 },
  optionSelected: { backgroundColor: PREFERENCE_COLORS.selected },
  optionBody: { flex: 1 },
  optionText: { color: '#FFFFFF', fontFamily: 'DMSans_500Medium', fontSize: 15 },
  optionDetail: { color: '#BEB6BA', fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 17, marginTop: 3 },
  check: { width: 23, height: 23, borderRadius: 12, backgroundColor: '#4C4248', alignItems: 'center', justifyContent: 'center' },
  checkSelected: { backgroundColor: ACCENT },
  pressed: { opacity: 0.75 },
  done: { flex: 1, minHeight: 46, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: ACCENT },
  doneText: { color: PREFERENCE_COLORS.accentText, fontSize: 15, fontFamily: 'DMSans_700Bold' },
  sheetActions: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 10 },
  clearButton: { paddingHorizontal: 8, minHeight: 44, justifyContent: 'center' },
  clearText: { color: ACCENT, fontFamily: 'DMSans_500Medium', fontSize: 14 },
  requirement: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 20, paddingTop: 12 },
  profileAnswer: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 20, marginBottom: 12, padding: 12, borderRadius: 14, backgroundColor: '#303338' },
  answerCaption: { color: PREFERENCE_COLORS.secondary, fontSize: 10, letterSpacing: 1, fontFamily: 'DMSans_700Bold' },
  answerText: { color: '#FFFFFF', fontSize: 13, fontFamily: 'DMSans_500Medium', marginTop: 4 },
  useMine: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 18, backgroundColor: PREFERENCE_COLORS.selected },
  useMineText: { color: ACCENT, fontFamily: 'DMSans_700Bold', fontSize: 12 },
  heightRange: { paddingHorizontal: 20, paddingVertical: 18 },
  rangeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rangeValue: { fontFamily: 'DMSans_700Bold', fontSize: 18, color: ACCENT },
});
