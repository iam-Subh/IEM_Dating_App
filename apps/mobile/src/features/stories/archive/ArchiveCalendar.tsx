import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { settingsLayout, settingsPalette as palette } from '../../../core/settings/SettingsLayout';
import { storyArchiveApi, type CalendarDay } from '../settings/storySettings';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** A month grid with a dot on each day that has archived stories. Jump by month; tap a day to see it. */
export function ArchiveCalendar() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const [cursor, setCursor] = useState(() => route.params?.selectedDate ? new Date(`${route.params.selectedDate}T12:00:00`) : new Date());
  const [days, setDays] = useState<CalendarDay[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);

  const key = monthKey(cursor);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    setDays(null);
    storyArchiveApi.calendar(key)
      .then((result) => { if (active) setDays(result.days); })
      .catch(() => { if (active) { setDays([]); setFailed(true); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [key, reload]);

  const countOf = useMemo(() => new Map((days ?? []).map((day) => [day.date, day.count])), [days]);

  const grid = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ date: string; day: number } | null> = [];
    for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push({ date: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`, day });
    }
    while (cells.length < 42) cells.push(null);
    return cells;
  }, [cursor]);

  const today = new Date();
  const todayKey = `${monthKey(today)}-${String(today.getDate()).padStart(2, '0')}`;
  const nextDisabled = key >= monthKey(today);

  return (
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
        {Platform.OS === 'android' && <View style={styles.handle} />}
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">Find a story</Text>
          <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Close calendar" style={styles.iconButton}>
            <Ionicons name="close" size={19} color="#FFFFFF" />
          </Pressable>
        </View>
        <View style={styles.monthRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setCursor((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} style={styles.monthButton}>
            <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
          </Pressable>
          <Text style={styles.monthLabel}>{cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Next month" disabled={nextDisabled} accessibilityState={{ disabled: nextDisabled }}
            onPress={() => setCursor((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} style={[styles.monthButton, nextDisabled && styles.disabled]}>
            <Ionicons name="chevron-forward" size={20} color="#FFFFFF" />
          </Pressable>
        </View>

        <View style={styles.weekdays}>
          {WEEKDAYS.map((label, index) => <Text key={`${label}-${index}`} style={styles.weekday}>{label}</Text>)}
        </View>

        <View style={styles.calendar}>
          <View style={styles.grid}>
            {grid.map((cell, index) => {
              if (!cell) return <View key={`empty-${index}`} style={styles.cell} />;
              const count = countOf.get(cell.date) ?? 0;
              const disabled = loading || count === 0 || cell.date > todayKey;
              return (
                <Pressable
                  key={cell.date}
                  accessibilityRole="button"
                  disabled={disabled}
                  accessibilityLabel={`${cell.date}, ${count} ${count === 1 ? 'story' : 'stories'}`}
                  accessibilityState={{ disabled, selected: cell.date === route.params?.selectedDate }}
                  onPress={() => navigation.popTo('StoryArchive', { archiveDate: cell.date })}
                  style={({ pressed }) => [styles.cell, pressed && settingsLayout.pressed]}
                >
                  <View style={[styles.dayFace, count > 0 && styles.dayWithStories, cell.date === route.params?.selectedDate && styles.selectedDay]}>
                    <Text style={[styles.dayText, disabled && styles.dayTextDim, cell.date === route.params?.selectedDate && styles.selectedDayText]}>{cell.day}</Text>
                  </View>
                  {count > 0 && <View style={styles.dot} />}
                </Pressable>
              );
            })}
          </View>
          {loading && <View style={styles.loading} pointerEvents="none"><ActivityIndicator color={palette.accent} /></View>}
        </View>
        {failed ? <Pressable onPress={() => setReload((value) => value + 1)} accessibilityRole="button" style={styles.legend}>
          <Text style={styles.error}>Could not load dates. Tap to retry.</Text>
        </Pressable> : <View style={styles.legend}><View style={styles.dot} /><Text style={styles.legendText}>Select a marked day to see its stories.</Text></View>}
      </View>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: palette.card, paddingHorizontal: 16, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: '#716A70', marginBottom: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  title: { flex: 1, color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 19 },
  iconButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#363136', alignItems: 'center', justifyContent: 'center' },
  monthButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.35 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  monthLabel: { color: palette.text, fontFamily: 'DMSans_700Bold', fontSize: 15 },
  weekdays: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', color: palette.secondary, fontFamily: 'DMSans_500Medium', fontSize: 11, paddingVertical: 6 },
  calendar: { position: 'relative' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, height: 44, alignItems: 'center', justifyContent: 'center' },
  dayFace: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  dayWithStories: { backgroundColor: '#382A30' },
  selectedDay: { backgroundColor: palette.accent },
  selectedDayText: { color: palette.accentText },
  dayText: { color: palette.text, fontFamily: 'DMSans_700Bold', fontSize: 13 },
  dayTextDim: { color: palette.muted },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: palette.accent },
  loading: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(35,35,35,0.5)' },
  legend: { minHeight: 30, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, marginTop: 8 },
  legendText: { color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 11, flexShrink: 1 },
  error: { color: palette.danger, fontFamily: 'DMSans_500Medium', fontSize: 12 },
});
