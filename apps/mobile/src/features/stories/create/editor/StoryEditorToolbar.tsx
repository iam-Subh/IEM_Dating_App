import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedScrollHandler, useSharedValue, withTiming } from 'react-native-reanimated';
import { StoryEditorIcon, type StoryEditorIconName } from './StoryEditorIcon';
import { EDITOR_HEADER_HEIGHT, EDITOR_RAIL_RIGHT, EDITOR_RAIL_WIDTH } from './editorChromeLayout';
import { PhotoDurationPill, type PhotoDurationControl } from './PhotoDurationPill';
import { PhotoEffectsPill, type PhotoEffectsControl } from './PhotoEffectsPill';

export type StoryToolAction = {
  id: string; icon: StoryEditorIconName; label: string; accessibilityLabel?: string;
  onPress: () => void; selected?: boolean; value?: string; disabled?: boolean; busy?: boolean;
};

function useToolPill(open: boolean) {
  const [visible, setVisible] = useState(open);
  const progress = useSharedValue(0);
  const anchorY = useSharedValue(0);
  useEffect(() => {
    if (open) setVisible(true);
    progress.value = withTiming(open ? 1 : 0, {
      duration: open ? 260 : 200, easing: Easing.out(Easing.cubic),
    }, finished => {
      if (finished && !open) runOnJS(setVisible)(false);
    });
  }, [open, progress]);
  return { visible, progress, anchorY };
}

function ToolButton({ action, onHint, onLayout }: { action: StoryToolAction; onHint: (label: string) => void; onLayout?: (event: LayoutChangeEvent) => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={action.accessibilityLabel ?? action.label}
    accessibilityState={{ selected: !!action.selected, disabled: !!action.disabled }} disabled={action.disabled} onPress={action.onPress}
    onLongPress={() => onHint(action.accessibilityLabel ?? action.label)} delayLongPress={350}
    onLayout={onLayout}
    style={({ pressed }) => [s.tool, action.disabled && !action.busy && s.disabled, pressed && s.pressed]}>
    <View style={[s.toolIcon, action.selected && s.selectedIcon, action.icon === 'back' && s.backIcon]}>
      {action.busy ? <ActivityIndicator color="#F3C1CA" /> : <StoryEditorIcon name={action.icon} color={action.selected ? '#F3C1CA' : '#FFF4F6'} />}
      {action.value && <View style={s.valueBadge}><Text style={s.valueText}>{action.value}</Text></View>}
    </View>
  </Pressable>;
}

export function StoryEditorToolbar({ top, viewport, activeTool, onClose, onReset, canReset, onUndo, canUndo, onSave, onHint, primary, secondary, duration, effects, disabled = false }: {
  top: number; viewport: { left: number; top: number; width: number; height: number }; activeTool: string; onClose: () => void;
  onUndo: () => void; canUndo: boolean; onSave: () => void;
  onReset: () => void; canReset: boolean;
  primary: StoryToolAction[]; secondary: StoryToolAction[];
  onHint: (label: string) => void;
  duration?: PhotoDurationControl;
  effects?: PhotoEffectsControl;
  disabled?: boolean;
}) {
  const durationOpen = activeTool === 'duration' && !!duration;
  const effectsOpen = activeTool === 'effects' && !!effects;
  const durationPill = useToolPill(durationOpen);
  const effectsPill = useToolPill(effectsOpen);
  const scrollY = useSharedValue(0);
  const railScroll = useAnimatedScrollHandler(event => { scrollY.value = event.contentOffset.y; });
  const actions: StoryToolAction[] = [
    ...primary, ...secondary,
    { id: 'undo', icon: 'undo', label: 'Undo', disabled: !canUndo, onPress: onUndo },
    { id: 'save', icon: 'download', label: 'Save', accessibilityLabel: 'Save to device', onPress: onSave },
  ];
  return <>
    <View style={[s.header, { top, height: EDITOR_HEADER_HEIGHT }]}>
      <View style={s.headerSlot}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close editor" hitSlop={4} disabled={disabled} onPress={onClose} style={({ pressed }) => [s.headerButton, disabled && s.disabled, pressed && s.pressed]}><StoryEditorIcon name="close" /></Pressable>
      </View>
      <Text numberOfLines={1} style={s.title}>Edit story</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Reset current story" accessibilityHint="Restore this story to its starting state. You can undo the reset."
        hitSlop={4} disabled={disabled || !canReset} onPress={onReset} style={({ pressed }) => [s.resetButton, (disabled || !canReset) && s.disabled, pressed && s.pressed]}>
        <Text style={s.resetText}>Reset</Text>
      </Pressable>
    </View>
    {(duration || effects) && <View pointerEvents="box-none" style={[s.pillViewport, viewport]}>
      {duration && <PhotoDurationPill width={viewport.width} progress={durationPill.progress} anchorY={durationPill.anchorY} scrollY={scrollY}
        control={duration} open={durationOpen} />}
      {effects && <PhotoEffectsPill width={viewport.width} progress={effectsPill.progress} anchorY={effectsPill.anchorY} scrollY={scrollY}
        control={effects} open={effectsOpen} onHint={onHint} />}
    </View>}
    <View style={[s.tools, {
      left: viewport.left + viewport.width - EDITOR_RAIL_WIDTH - EDITOR_RAIL_RIGHT,
      top: viewport.top + 8, height: Math.max(1, viewport.height - 16),
    }]}>
      <Animated.ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={s.toolColumn}
        onScroll={railScroll} scrollEventThrottle={16} scrollEnabled={!durationPill.visible && !effectsPill.visible}>
        {actions.map(action => {
          let displayed = { ...action, selected: action.selected || activeTool === action.id, disabled: disabled || action.disabled,
            busy: action.id === 'effects' && !!effects?.busy && !effectsPill.visible };
          if (action.id === 'duration' && durationPill.visible && duration) displayed = {
            ...displayed, icon: 'back', value: undefined, selected: true, accessibilityLabel: 'Close photo length', onPress: duration.onClose,
          };
          if (action.id === 'effects' && effectsPill.visible && effects) displayed = {
            ...displayed, icon: 'back', selected: true, accessibilityLabel: 'Close photo effects', onPress: effects.onClose,
          };
          return <ToolButton key={action.id} action={displayed} onHint={onHint}
            onLayout={action.id === 'duration' ? event => { durationPill.anchorY.value = event.nativeEvent.layout.y; }
              : action.id === 'effects' ? event => { effectsPill.anchorY.value = event.nativeEvent.layout.y; } : undefined} />;
        })}
      </Animated.ScrollView>
    </View>
  </>;
}

const s = StyleSheet.create({
  header: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 12, gap: 6, flexDirection: 'row', alignItems: 'center', backgroundColor: '#161616' },
  headerButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#222222', alignItems: 'center', justifyContent: 'center' },
  headerSlot: { width: 56, height: 36, justifyContent: 'center' },
  resetButton: { width: 56, height: 36, borderRadius: 18, backgroundColor: '#2B2528', alignItems: 'center', justifyContent: 'center' },
  resetText: { color: '#F3C1CA', fontSize: 12, fontWeight: '600' },
  title: { flex: 1, minWidth: 0, textAlign: 'center', fontSize: 14, fontWeight: '600', color: '#FFF4F6' },
  tools: { position: 'absolute', width: EDITOR_RAIL_WIDTH },
  pillViewport: { position: 'absolute', borderRadius: 14, overflow: 'hidden' },
  toolColumn: { paddingVertical: 4, gap: 4, alignItems: 'center' },
  tool: { width: EDITOR_RAIL_WIDTH, height: 44, alignItems: 'center', justifyContent: 'center' },
  toolIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.42)', alignItems: 'center', justifyContent: 'center' },
  selectedIcon: { backgroundColor: 'rgba(67,37,48,0.88)' },
  backIcon: { backgroundColor: '#282628' },
  valueBadge: { position: 'absolute', right: 0, top: 0, paddingHorizontal: 4, minWidth: 19, height: 16, borderRadius: 8, backgroundColor: '#F3C1CA', alignItems: 'center', justifyContent: 'center' },
  valueText: { fontSize: 9, fontWeight: '700', color: '#332027' },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.4 },
});
