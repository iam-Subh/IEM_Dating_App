import React, {useEffect, useMemo, useRef, useState} from 'react';
import {View, Text, Pressable, StyleSheet, Animated, FlatList, ScrollView, Platform, InteractionManager, type ScrollViewProps} from 'react-native';
type Option = {value: string; label: string};
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const ROW = 48;
export const WINDOW = ROW * 5;
const rowLayout = (_data: unknown, index: number) => ({length: ROW, offset: index * ROW, index});

export function DateWheel({label, options, value, disabled, onChange, onMoving, onPreview, dark = false, virtualized = true}: {
  dark?: boolean; virtualized?: boolean; label: string; options: Option[]; value: string; disabled: boolean;
  onChange: (value: string) => void; onMoving: (moving: boolean) => void;
  onPreview?: (value: string) => void;
}) {
  const initialIndex = Math.max(0, options.findIndex(option => option.value === value));
  const initialOffset = useRef({x: 0, y: initialIndex * ROW}).current;
  const list = useRef<FlatList<Option | null>>(null);
  const scroll = useRef<ScrollView>(null);
  const moveTo = (y: number, animated: boolean) => {
    if (virtualized) list.current?.scrollToOffset({offset: y, animated});
    else scroll.current?.scrollTo({y, animated});
  };
  const webPositioned = useRef(false);
  const position = useRef(new Animated.Value(initialIndex * ROW)).current;
  const selected = useRef(initialIndex);
  const previewIndex = useRef(initialIndex);
  const offset = useRef(initialIndex * ROW);
  const dragging = useRef(false);
  const momentum = useRef(false);
  const active = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({options, onChange, onMoving, onPreview});
  latest.current = {options, onChange, onMoving, onPreview};
  const clearTimer = () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = null;
  };
  useEffect(() => () => clearTimer(), []);
  const begin = () => {
    clearTimer();
    if (!active.current) {active.current = true; latest.current.onMoving(true);}
  };
  const finish = () => {
    clearTimer();
    const items = latest.current.options;
    const index = Math.max(0, Math.min(items.length - 1, Math.round(offset.current / ROW)));
    // Native snapping owns the motion. Commit only when it has stopped.
    selected.current = index;
    previewIndex.current = index;
    latest.current.onChange(items[index].value);
    active.current = false;
    latest.current.onMoving(false);
  };
  const scheduleFinish = () => {
    clearTimer();
    settleTimer.current = setTimeout(() => {
      if (!dragging.current && !momentum.current) finish();
    }, 180);
  };
  const select = (index: number) => {
    begin();
    const safeIndex = Math.max(0, Math.min(latest.current.options.length - 1, index));
    moveTo(safeIndex * ROW, true);
    scheduleFinish();
  };
  useEffect(() => {
    if (!active.current && selected.current !== initialIndex) {
      selected.current = initialIndex;
      previewIndex.current = initialIndex;
      offset.current = initialIndex * ROW;
      moveTo(initialIndex * ROW, false);
    }
  }, [initialIndex, options.length]);
  // The two blank rows at each end let the first and last values reach the centre.
  const rows = useMemo(() => [null, null, ...options, null, null], [options]);
  // Built once per list, not on every parent render: each one is a native animated node.
  const rowStyles = useMemo(() => options.map((_, index) => ({
    opacity: position.interpolate({inputRange: [(index - 2) * ROW, (index - 1) * ROW, index * ROW, (index + 1) * ROW, (index + 2) * ROW], outputRange: [0.18, 0.45, 1, 0.45, 0.18], extrapolate: 'clamp'}),
    transform: [{scale: position.interpolate({inputRange: [(index - 1) * ROW, index * ROW, (index + 1) * ROW], outputRange: [0.86, 1, 0.86], extrapolate: 'clamp'})}],
  })), [options.length, position]);
  const renderRow = (option: Option | null, rowIndex: number) => {
    if (!option) return <View key={`padding-${rowIndex}`} accessible={false} style={s.wheelRow}/>;
    const index = rowIndex - 2;
    return <Pressable key={option.value} accessible={false} disabled={disabled} onPress={() => select(index)} style={s.wheelRow}>
      <Animated.Text style={[s.wheelText, {color: dark ? '#F3C1CA' : '#712C48'}, rowStyles[index]]}>{option.label}</Animated.Text>
    </Pressable>;
  };
  // A plain scroller opens with only the rows around the saved value; the rest
  // join once the screen has finished opening. Spacers keep every offset the same.
  const [allRows, setAllRows] = useState(virtualized);
  useEffect(() => {
    if (allRows) return;
    const task = InteractionManager.runAfterInteractions(() => setAllRows(true));
    return () => task.cancel();
  }, [allRows]);
  const plainRows = useMemo(() => {
    if (virtualized) return null;
    if (allRows) return rows.map(renderRow);
    const start = Math.max(0, initialIndex - 3), end = Math.min(rows.length, initialIndex + 8);
    return [
      start > 0 && <View key="before" style={{height: start * ROW}}/>,
      ...rows.slice(start, end).map((row, i) => renderRow(row, start + i)),
      end < rows.length && <View key="after" style={{height: (rows.length - end) * ROW}}/>,
    ];
  }, [virtualized, allRows, rows, rowStyles, disabled, dark, initialIndex]);
  const scrollProps: ScrollViewProps = {
    style: s.wheel,
    nestedScrollEnabled: true,
    onContentSizeChange: Platform.OS === 'web' ? () => {
      if (webPositioned.current) return;
      webPositioned.current = true;
      moveTo(initialIndex * ROW, false);
    } : undefined,
    contentOffset: initialOffset,
    scrollEnabled: !disabled,
    showsVerticalScrollIndicator: false,
    snapToInterval: ROW,
    decelerationRate: 'fast',
    bounces: false,
    overScrollMode: 'never',
    scrollEventThrottle: 16,
    onScrollBeginDrag: () => {dragging.current = true; momentum.current = false; begin();},
    onMomentumScrollBegin: () => {momentum.current = true; begin();},
    onScrollEndDrag: event => {
      dragging.current = false;
      offset.current = event.nativeEvent.contentOffset.y;
      scheduleFinish();
    },
    onMomentumScrollEnd: event => {
      momentum.current = false;
      offset.current = event.nativeEvent.contentOffset.y;
      if (!dragging.current) finish();
    },
    onScroll: Animated.event([{nativeEvent: {contentOffset: {y: position}}}], {
      useNativeDriver: true,
      listener: (event: any) => {
        offset.current = event.nativeEvent.contentOffset.y;
        const items = latest.current.options;
        const index = Math.max(0, Math.min(items.length - 1, Math.round(offset.current / ROW)));
        if (active.current && index !== previewIndex.current) {
          previewIndex.current = index;
          latest.current.onPreview?.(items[index].value);
        }
        if (active.current && !dragging.current && !momentum.current) scheduleFinish();
      },
    }),
  };
  return <View style={s.column}>
    <Text style={[s.columnLabel, dark && {color: '#BDB5AF'}]}>{label}</Text>
    <View accessible accessibilityRole="adjustable" accessibilityLabel={label}
      accessibilityValue={{text: options[initialIndex].label}}
      accessibilityState={{disabled}}
      accessibilityHint="Swipe up or down to choose."
      accessibilityActions={[{name: 'increment'}, {name: 'decrement'}]}
      onAccessibilityAction={event => {
        if (!disabled) select(selected.current + (event.nativeEvent.actionName === 'increment' ? 1 : -1));
      }}>
      {virtualized ? <Animated.FlatList ref={list} {...scrollProps} data={rows}
        keyExtractor={(option, index) => option ? option.value : `padding-${index}`}
        renderItem={({item, index}) => renderRow(item, index)}
        getItemLayout={rowLayout} initialScrollIndex={initialIndex}
        initialNumToRender={9} maxToRenderPerBatch={6} windowSize={3}
        updateCellsBatchingPeriod={16} removeClippedSubviews={false}
      /> : <Animated.ScrollView ref={scroll} {...scrollProps}>{plainRows}</Animated.ScrollView>}
    </View>
  </View>;
}


const s = StyleSheet.create({column: {flex: 1}, columnLabel: {fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 18, color: '#8A747F', textAlign: 'center', marginBottom: 16}, wheel: {height: WINDOW}, wheelRow: {height: ROW, alignItems: 'center', justifyContent: 'center'}, wheelText: {fontFamily: 'DMSans_500Medium', fontSize: 24, color: '#712C48'}});
