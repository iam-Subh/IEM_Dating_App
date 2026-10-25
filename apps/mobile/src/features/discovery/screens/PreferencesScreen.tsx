import { UnverifiedNudge } from '../../verification/VerifyNudge';
import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ProfileFieldIcon } from '../../../components/ProfileFieldIcon';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../../store';
import { updateUser } from '../../../store/authSlice';
import { api } from '../../../services/api';
import { notifyPreferencesChanged } from '../preferencesEvents';
import { shareLocationNow } from '../../location/shareLocationNow';
import { formatDistance, useDistanceUnit } from '../../location/distanceUnits';
import { PREFERENCE_AGE_MAX, PREFERENCE_AGE_MIN, clampAgePreference } from '@iem-dating/shared/age';
import { AgeRangeSlider, PreferenceChoiceSheet, PreferenceToggle, PreferenceDistanceSlider } from '../components/PreferenceControls';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { criterionProfileAnswer, criterionValueLabel, PREFERENCE_COLORS as palette, PREFERENCE_CRITERIA, PreferenceOption } from '../preferenceOptions';
import Animated, { cancelAnimation, Easing, interpolateColor, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

type CriterionSelection = { values: string[]; required: boolean };
const EMPTY_CRITERION: CriterionSelection = { values: [], required: false };
type Draft = {
  show: string[]; minimumAge: number; maximumAge: number; flexibleAge: boolean;
  area: string; distance: number; flexibleArea: boolean; verified: boolean;
  criteria: Record<string, CriterionSelection>;
};

/** What the server keeps (PREFERENCES_SPEC.md). */
type AreaOption = { label: string; detail: string; locked: boolean; lockedReason: string | null };
type AreaOptions = { campus: AreaOption | null; college: AreaOption | null; city: AreaOption; nearby: AreaOption };
type Saved = {
  areaOptions?: AreaOptions;
  show: string[]; minimumAge: number; maximumAge: number; flexibleAge: boolean; area: string; distance: number;
  flexibleArea: boolean; verifiedOnly: boolean; criteria: Record<string, CriterionSelection>;
  ownAnswers: Record<string, boolean>; maxRequired: number;
};
/** About how many people the draft would show: a band, never a count. */
type Estimate = { band: 'none' | 'few' | 'some' | 'many' | 'blocked' | 'unknown'; message: string | null };
const ESTIMATE_TEXT: Record<Exclude<Estimate['band'], 'blocked' | 'unknown'>, string> = {
  many: 'Plenty of people match these choices.',
  some: 'A good number of people match.',
  few: 'Only a few people match. Loosening a "Must match" or the area shows more.',
  none: 'No one matches right now. Try a wider area, age range, or fewer "Must match".',
};

function fromSaved(saved: Saved): Draft {
  return {
    show: saved.show,
    minimumAge: Math.min(PREFERENCE_AGE_MAX - 1, clampAgePreference(saved.minimumAge)),
    maximumAge: Math.max(Math.min(PREFERENCE_AGE_MAX - 1, clampAgePreference(saved.minimumAge)) + 1, clampAgePreference(saved.maximumAge)),
    flexibleAge: saved.flexibleAge, area: saved.area, distance: saved.distance, flexibleArea: saved.flexibleArea,
    verified: saved.verifiedOnly,
    criteria: Object.fromEntries(PREFERENCE_CRITERIA.map((criterion) => [criterion.id, saved.criteria[criterion.id] ?? { values: [], required: false }])),
  };
}

function toServer(draft: Draft) {
  return {
    show: draft.show, minimumAge: draft.minimumAge, maximumAge: draft.maximumAge, flexibleAge: draft.flexibleAge,
    area: draft.area, distance: draft.distance, flexibleArea: draft.flexibleArea, verifiedOnly: draft.verified,
    // Only choices that choose something; "Must match" only where there is something to match.
    criteria: Object.fromEntries(Object.entries(draft.criteria)
      .filter(([, selection]) => selection.values.length > 0)
      .map(([id, selection]) => [id, { values: selection.values, required: selection.required }])),
  };
}
/**
 * "Who you see" (GOOGLE_SIGNUP_PLAN.md 2.1), named for the person: "My campus
 * · Gurukul", "All IEM campuses", "IEM & UEM Newtown", "People near me". The
 * server sends the names; these are only the words until it answers. Before
 * verifying, only My campus and People near me can be chosen: the others show
 * a lock and open Verify your college.
 */
const AREAS: PreferenceOption[] = [
  { value: 'campus', label: 'My campus', detail: 'Students from your campus' },
  { value: 'college', label: 'All my college campuses', detail: 'Students from your college' },
  { value: 'city', label: 'Both colleges', detail: 'Both colleges in your city' },
  { value: 'nearby', label: 'People near me', detail: 'Anyone within a distance you choose' },
];
/** Older saved values: "Whole group" is now both colleges. */
const simpleArea = (value: unknown) =>
  value === 'nearby' ? 'nearby' : value === 'city' || value === 'group' ? 'city' : value === 'campus' ? 'campus' : 'college';
const LOCK = '🔒 ';
function areasFrom(options?: AreaOptions): PreferenceOption[] {
  if (!options) return AREAS;
  const row = (value: string, option: AreaOption | null): PreferenceOption[] => !option ? [] : [{
    value,
    label: option.locked ? `${LOCK}${option.label}` : option.label,
    detail: option.locked ? option.lockedReason ?? 'Verify your college to choose this' : option.detail,
  }];
  return [
    ...row('campus', options.campus),
    ...row('college', options.college),
    ...row('city', options.city),
    ...row('nearby', options.nearby),
  ];
}
const isLocked = (options: AreaOptions | undefined, value: string) =>
  !!options && !!(options as Record<string, AreaOption | null>)[value]?.locked;
const PEOPLE = [{ value: 'man', label: 'Men' }, { value: 'woman', label: 'Women' }, { value: 'nonbinary', label: 'Nonbinary' }];
const GROUPS = ['Connection', 'Lifestyle', 'Personality', 'College'] as const;

function initialDraft(user: any): Draft {
  // Inside 18-35 (@iem-dating/shared/age), with room for both handles.
  const minimumAge = Math.min(PREFERENCE_AGE_MAX - 1, clampAgePreference(user?.minAgePref ?? PREFERENCE_AGE_MIN));
  const maximumAge = Math.max(minimumAge + 1, clampAgePreference(user?.maxAgePref ?? 30));
  const show = Array.isArray(user?.showMeCategories)
    ? user.showMeCategories.filter((value: string) => PEOPLE.some((person) => person.value === value)) : [];
  const scope = simpleArea(user?.collegeScope);
  return {
    show: show.length ? show : PEOPLE.map((person) => person.value), minimumAge, maximumAge,
    flexibleAge: true, area: user?.discoveryMode === 'distance' ? 'nearby' : scope,
    distance: Math.max(1, Math.min(100, Math.round(Number(user?.distancePreference) || 25))),
    flexibleArea: user?.expandRadius !== false, verified: false,
    criteria: Object.fromEntries(PREFERENCE_CRITERIA.map((criterion) => [criterion.id, { values: [], required: false }])),
  };
}

export function PreferencesScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const user = useSelector((state: RootState) => state.auth.user);
  const dispatch = useDispatch();
  const unit = useDistanceUnit();
  // What is saved on the server: the baseline for "changed", and what Reset returns to.
  const [baseline, setBaseline] = useState<Draft>(() => initialDraft(user));
  const [draft, setDraft] = useState<Draft>(baseline);
  const [ownAnswers, setOwnAnswers] = useState<Record<string, boolean>>({});
  const [maxRequired, setMaxRequired] = useState(3);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [areaOptions, setAreaOptions] = useState<AreaOptions | undefined>();
  const areas = useMemo(() => areasFrom(areaOptions), [areaOptions]);
  const [saving, setSaving] = useState(false);
  const [estimate, setEstimate] = useState<Estimate | null>(null);

  useEffect(() => {
    let active = true;
    let started = false;
    // Show the controls before starting the refresh. Native-stack transitions
    // do not register an InteractionManager task.
    const loadSaved = () => {
      if (!active || started) return;
      started = true;
      startTransition(() => setMoreMounted(true));
      api.get('/profile/preferences')
        .then((response) => {
          if (!active) return;
          const saved = response.data.data as Saved;
          setAreaOptions(saved.areaOptions);
          const next = fromSaved({ ...saved, area: simpleArea(saved.area) });
          setBaseline(next);
          setDraft(next);
          setOwnAnswers(saved.ownAnswers ?? {});
          setMaxRequired(saved.maxRequired ?? 3);
        })
        .catch(() => undefined)
        .finally(() => { if (active) setLoadingSaved(false); });
    };
    const unsubscribe = navigation.addListener('transitionEnd', (event: { data: { closing: boolean } }) => {
      if (!event.data.closing) loadSaved();
    });
    // A restored route can open without a transition event.
    const fallback = setTimeout(loadSaved, 400);
    return () => { active = false; clearTimeout(fallback); unsubscribe(); };
  }, [navigation]);
  const signature = (value: Draft) => JSON.stringify({ ...value, show: [...value.show].sort(), criteria: Object.fromEntries(Object.entries(value.criteria).map(([key, entry]) => [key, { ...entry, values: [...entry.values].sort() }])) });
  const hasChanges = signature(draft) !== signature(baseline);
  const requiredCount = Object.values(draft.criteria).filter((selection) => selection.required && selection.values.length > 0).length;

  // Live: about how many people these choices would show, as they change.
  const estimateSeq = useRef(0);
  const draftSignature = signature(draft);
  useEffect(() => {
    if (loadingSaved) return;
    const id = ++estimateSeq.current;
    const timer = setTimeout(() => {
      api.post('/profile/preferences/estimate', toServer(draft))
        .then((response) => { if (id === estimateSeq.current) setEstimate(response.data.data as Estimate); })
        .catch(() => undefined);
    }, 450);
    return () => clearTimeout(timer);
    // The signature stands for the draft's content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftSignature, loadingSaved]);
  const [editing, setEditing] = useState<string | null>(null);
  const [tab, setTab] = useState<'basics' | 'more'>('basics');
  // Prepare the hidden tab after the page opens. Keep both panels mounted
  // so a tab animation does not create or remove native rows.
  const [moreMounted, setMoreMounted] = useState(false);
  const [highlightWidth, setHighlightWidth] = useState(0);
  const tabPosition = useSharedValue(0);
  const tabWidth = useSharedValue(0);
  const panelWidth = useSharedValue(0);
  const basicsPanelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -tabPosition.value * panelWidth.value }],
  }));
  const morePanelStyle = useAnimatedStyle(() => ({
    opacity: panelWidth.value > 0 ? 1 : 0,
    transform: [{ translateX: (1 - tabPosition.value) * panelWidth.value }],
  }));
  const highlightStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tabPosition.value * (tabWidth.value + 5) }],
  }));
  const basicsLabelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(tabPosition.value, [0, 1], [palette.accentText, palette.secondary]),
  }));
  const moreLabelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(tabPosition.value, [0, 1], [palette.secondary, palette.accentText]),
  }));
  const tabCountStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(tabPosition.value, [0, 1], [palette.selected, '#FFE2A3']),
  }));
  const tabCountTextStyle = useAnimatedStyle(() => ({
    color: interpolateColor(tabPosition.value, [0, 1], [palette.accent, palette.accentText]),
  }));
  // Update React after the UI-thread animation. Mounting rows or changing
  // native accessibility flags during the animation can interrupt frames.
  const shownTab = useRef<'basics' | 'more'>('basics');
  const commitTab = useCallback((next: 'basics' | 'more') => {
    if (shownTab.current !== next) return;
    startTransition(() => {
      if (next === 'more') setMoreMounted(true);
      setTab(next);
    });
  }, []);
  useEffect(() => () => cancelAnimation(tabPosition), [tabPosition]);
  const switchTab = (next: 'basics' | 'more') => {
    if (next === shownTab.current) return;
    shownTab.current = next;
    tabPosition.value = withTiming(next === 'more' ? 1 : 0, { duration: 220, easing: Easing.inOut(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(commitTab)(next);
    });
  };
  const activeCount = Object.values(draft.criteria).filter((selection) => selection.values.length > 0).length;
  const activeCriterion = PREFERENCE_CRITERIA.find((criterion) => criterion.id === editing);
  const profileAnswer = activeCriterion ? criterionProfileAnswer(activeCriterion, user) : [];
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((previous) => ({ ...previous, [key]: value }));
  const togglePerson = (value: string) => {
    setDraft((previous) => {
      const selected = previous.show.includes(value);
      if (selected && previous.show.length === 1) return previous;
      return { ...previous, show: selected ? previous.show.filter((person) => person !== value) : [...previous.show, value] };
    });
  };
  /**
   * Done: one save. Every surface that shows people then works from it - the
   * deck and Browse reload now, the rest on their next open.
   */
  const finish = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await api.put('/profile/preferences', toServer(draft));
      const saved = response.data.data as Saved;
      dispatch(updateUser({
        showMeCategories: saved.show,
        minAgePref: saved.minimumAge,
        maxAgePref: saved.maximumAge,
        discoveryMode: saved.area === 'nearby' ? 'distance' : 'college',
        ...(saved.area === 'nearby' ? {} : { collegeScope: saved.area }),
        distancePreference: saved.distance,
        expandRadius: saved.flexibleArea,
      }));
      notifyPreferencesChanged();
      navigation.goBack();
    } catch (cause: any) {
      const code = cause?.response?.data?.code;
      const message = cause?.response?.data?.message ?? 'Your preferences could not be saved. Check your connection and try again.';
      if (code === 'LOCATION_REQUIRED') {
        // Share it here and save again - no detour through another page.
        Alert.alert(
          'Share your location',
          `People nearby uses your location while the app is open. It's rounded to about ${formatDistance(2, unit)} before it leaves your phone, and others only ever see a distance band.`,
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Share location', onPress: async () => { if (await shareLocationNow()) void finish(); } },
          ],
        );
      } else {
        Alert.alert("Couldn't save", message);
      }
    } finally {
      setSaving(false);
    }
  };
  const updateCriterion = (id: string, selection: Partial<CriterionSelection>) => setDraft((previous) => ({
    ...previous, criteria: { ...previous.criteria, [id]: { ...previous.criteria[id], ...selection } },
  }));

  // Keep the native rows and controls mounted. Tab presses only move the panels.
  const basicsContent = useMemo(() => <>
        <View style={styles.intro}><Text style={styles.description}>Choose who you want to meet.</Text></View>

        <SectionHeading icon="people-outline" title="The essentials" />
        <View style={styles.group}>
          <View style={styles.block}>
            <Text style={styles.label}>Show me</Text>
            <Text style={styles.rowDetail}>Select one or more.</Text>
            <View style={styles.chips}>
              {PEOPLE.map((person) => {
                const selected = draft.show.includes(person.value);
                return <Pressable key={person.value} onPress={() => togglePerson(person.value)} accessibilityRole="checkbox"
                  disabled={selected && draft.show.length === 1}
                  accessibilityLabel={person.label} accessibilityState={{ checked: selected, disabled: selected && draft.show.length === 1 }}
                  style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}>
                  {selected && <Ionicons name="checkmark" size={15} color={palette.accentText} />}
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{person.label}</Text>
                </Pressable>;
              })}
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.block}>
            <AgeRangeSlider minimum={draft.minimumAge} maximum={draft.maximumAge}
              onChange={(minimumAge, maximumAge) => setDraft((previous) => ({ ...previous, minimumAge, maximumAge }))} />
          </View>
          <ToggleRow title="Show people slightly out of my preferred range if I run out of profiles to see"
            detail="Up to 2 years either side, only after everyone in your range."
            value={draft.flexibleAge} onChange={(value) => update('flexibleAge', value)} compact />
        </View>

        <SectionHeading icon="location-outline" title="Where you connect" />
        <View style={styles.group}>
          <ChoiceRow label="Who you see" value={(areas.find((area) => area.value === draft.area)?.label ?? AREAS.find((area) => area.value === draft.area)?.label ?? 'My college').replace(LOCK, '')} onPress={() => setEditing('area')} widerValue />
          {draft.area === 'nearby' && <View style={[styles.block, styles.distanceBlock]}>
            <PreferenceDistanceSlider value={draft.distance} onChange={(value) => update('distance', value)} />
          </View>}
          <View style={styles.divider} />
          <ToggleRow title="Show people further away if I run out of profiles to see"
            detail={draft.area === 'nearby'
              ? `Up to ${formatDistance(100, unit)}, only after everyone within your distance.`
              : draft.area === 'group' ? 'Campuses further away come after your own.' : 'The next area out, only after everyone in yours.'}
            value={draft.flexibleArea} onChange={(value) => update('flexibleArea', value)} />
        </View>

        <SectionHeading icon={<VerifiedBadge />} title="Profile verification" />
        <View style={styles.group}>
          <ToggleRow title="Verified students only" detail="People who verified their college email."
            value={draft.verified} onChange={(value) => update('verified', value)} />
        </View>
  </>, [draft, unit, areas]);
  const moreContent = useMemo(() => moreMounted ? <>
          <View style={styles.moreIntro}>
            <View style={styles.moreIntroTitle}><Text style={styles.title}>More about your type</Text></View>
            <Text style={styles.description}>Use the same choices as your profile. Select more than one, or leave a preference open.</Text>
          </View>
          {GROUPS.map((group) => <View key={group}>
            <Text style={styles.criteriaGroupTitle} accessibilityRole="header">{group}</Text>
            <View style={styles.group}>
              {PREFERENCE_CRITERIA.filter((criterion) => criterion.group === group).map((criterion, index) => {
                const selection = draft.criteria[criterion.id] ?? EMPTY_CRITERION;
                return <React.Fragment key={criterion.id}>
                  {index > 0 && <View style={styles.divider} />}
                  <ChoiceRow label={criterion.label} value={criterionValueLabel(criterion, selection.values)}
                    icon={criterion.icon} required={selection.required && selection.values.length > 0}
                    active={selection.values.length > 0} onPress={() => setEditing(criterion.id)} />
                </React.Fragment>;
              })}
            </View>
          </View>)}
          <View style={styles.info}><Ionicons name="information-circle-outline" size={18} color="#FFFFFF" />
            <Text style={styles.infoText}>These choices describe who you want to meet. They do not change your profile answers.</Text>
          </View>
  </> : null, [draft.criteria, moreMounted]);

  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor="#100F0D" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={25} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.headerTitle} accessibilityRole="header">My preferences</Text>
        <Pressable onPress={() => setDraft(baseline)} disabled={!hasChanges}
          style={({ pressed }) => [styles.reset, pressed && styles.pressed, !hasChanges && styles.resetOff]}
          accessibilityRole="button" accessibilityLabel="Reset to saved preferences">
          <Text style={styles.resetText}>Reset</Text>
        </Pressable>
      </View>

      <View style={styles.tabs} accessibilityRole="tablist"
        onLayout={(event) => {
          const width = Math.max(0, (event.nativeEvent.layout.width - 13) / 2);
          tabWidth.value = width;
          setHighlightWidth(width);
        }}>
        <Animated.View pointerEvents="none" style={[styles.tabHighlight, { width: highlightWidth }, highlightStyle]} />
        {([{ id: 'basics', title: 'Basics' }, { id: 'more', title: 'More criteria' }] as const).map((item) => (
          <Pressable key={item.id} onPressIn={() => switchTab(item.id)} accessibilityRole="tab" accessibilityState={{ selected: tab === item.id }}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
            <Animated.Text style={[styles.tabText, item.id === 'basics' ? basicsLabelStyle : moreLabelStyle]}>{item.title}</Animated.Text>
            {item.id === 'more' && activeCount > 0 && <Animated.View style={[styles.tabCount, tabCountStyle]}><Animated.Text style={[styles.tabCountText, tabCountTextStyle]}>{activeCount}</Animated.Text></Animated.View>}
          </Pressable>
        ))}
      </View>
      <View style={styles.panels} onLayout={(event) => { panelWidth.value = event.nativeEvent.layout.width; }}>
        <Animated.View style={[styles.panel, basicsPanelStyle]} pointerEvents={tab === 'basics' ? 'auto' : 'none'}
          accessibilityElementsHidden={tab !== 'basics'} importantForAccessibility={tab === 'basics' ? 'auto' : 'no-hide-descendants'}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            {/* Before verifying, "My campus" / "My college" / "In my city" can't apply (GOOGLE_SIGNUP_PLAN.md 2.1). */}
            <UnverifiedNudge compact art="campus" icon="globe-outline" text="You meet students from your campus. Verify to see every campus." />
            {basicsContent}
          </ScrollView>
        </Animated.View>
        <Animated.View style={[styles.panel, morePanelStyle]} pointerEvents={tab === 'more' ? 'auto' : 'none'}
          accessibilityElementsHidden={tab !== 'more'} importantForAccessibility={tab === 'more' ? 'auto' : 'no-hide-descendants'}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            {moreContent}
          </ScrollView>
        </Animated.View>
      </View>

      <View style={[styles.footer, { paddingBottom: Math.max(12, insets.bottom + 8) }]}>
        {estimate && (
          <View style={styles.previewNote} accessibilityLiveRegion="polite">
            <Ionicons
              name={estimate.band === 'many' || estimate.band === 'some' ? 'people' : estimate.band === 'few' ? 'people-outline' : 'alert-circle-outline'}
              size={16}
              color={estimate.band === 'many' || estimate.band === 'some' ? palette.accent : '#F2A7A0'}
            />
            <Text style={styles.previewText}>
              {estimate.band === 'blocked' || estimate.band === 'unknown' ? estimate.message : ESTIMATE_TEXT[estimate.band]}
            </Text>
          </View>
        )}
        {hasChanges && <Pressable onPress={() => void finish()} disabled={saving || estimate?.band === 'blocked'} accessibilityRole="button"
          accessibilityState={{ busy: saving, disabled: saving || estimate?.band === 'blocked' }}
          style={({ pressed }) => [styles.done, pressed && styles.donePressed, estimate?.band === 'blocked' && styles.doneOff]}>
          {saving ? <ActivityIndicator color={palette.accentText} /> : <Text style={styles.doneText}>Done</Text>}
        </Pressable>}
      </View>
      {editing === 'area' && <PreferenceChoiceSheet title="Who you see" options={areas} selected={[draft.area]}
        detail={areaOptions?.city.locked ? 'Until you verify your college, you meet students from your campus, or people near you.' : undefined}
        onChange={(values) => {
          // A locked choice opens Verify your college instead (GOOGLE_SIGNUP_PLAN.md 2.1).
          if (isLocked(areaOptions, values[0])) { setEditing(null); navigation.navigate('VerifyRules', { reason: 'area' }); return; }
          update('area', values[0]);
        }} onClose={() => setEditing(null)} />}
      {activeCriterion && <PreferenceChoiceSheet key={activeCriterion.id} title={activeCriterion.label}
        detail={activeCriterion.range ? 'Choose a height range, or keep the full range open.' : 'Choose any answers you are open to. Leave this preference open to include everyone.'}
        options={activeCriterion.options} multiple searchable={activeCriterion.searchable} range={activeCriterion.range}
        selected={(draft.criteria[activeCriterion.id] ?? EMPTY_CRITERION).values} required={(draft.criteria[activeCriterion.id] ?? EMPTY_CRITERION).required}
        profileAnswer={profileAnswer} profileAnswerLabel={activeCriterion.range ? `${profileAnswer[0]} cm` : criterionValueLabel(activeCriterion, profileAnswer)}
        onRequirementChange={(required) => updateCriterion(activeCriterion.id, { required })}
        requirementLockedReason={
          !ownAnswers[activeCriterion.id]
            ? 'Answer this on your own profile first - it goes both ways.'
            : requiredCount >= maxRequired && !(draft.criteria[activeCriterion.id] ?? EMPTY_CRITERION).required
              ? `Up to ${maxRequired} "Must match" at a time, so your deck doesn't run dry.`
              : undefined
        }
        onChange={(values) => updateCriterion(activeCriterion.id, { values })} onClose={() => setEditing(null)} />}
    </View>
  );
}

function SectionHeading({ icon, title, subtitle }: { icon: React.ComponentProps<typeof Ionicons>['name'] | React.ReactElement; title: string; subtitle?: string }) {
  return <View style={styles.sectionHeading}>
    <View style={styles.sectionTitleRow}>{typeof icon === 'string' ? <Ionicons name={icon} size={17} color={palette.accent} /> : icon}<Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text></View>
    {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
  </View>;
}

function ToggleRow({ title, detail, value, onChange, compact = false }: {
  title: string; detail: string; value: boolean; onChange: (value: boolean) => void; compact?: boolean;
}) {
  return <View style={[styles.toggleRow, compact && styles.compactToggle]}>
    <View style={styles.toggleBody}><Text style={[styles.label, compact && styles.flexibleLabel]}>{title}</Text><Text style={styles.rowDetail}>{detail}</Text></View>
    <PreferenceToggle value={value} onChange={onChange} label={title} hint={detail} />
  </View>;
}

function ChoiceRow({ label, value, onPress, icon, required = false, active = false, widerValue = false }: {
  label: string; value: string; onPress: () => void; icon?: string; required?: boolean; active?: boolean; widerValue?: boolean;
}) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value}${required ? ', must match' : ''}`}
    style={({ pressed }) => [styles.choiceRow, widerValue && styles.areaRowSpacing, pressed && styles.rowPressed]}>
    {icon && <ProfileFieldIcon name={icon} size={20} color="#FFFFFF" />}
    <View style={styles.choiceLabelBody}><Text style={styles.choiceLabel}>{label}</Text>{required && <Text style={styles.requiredText}>Must match</Text>}</View>
    <View style={[styles.valuePill, widerValue && styles.areaValueWidth]}><Text style={[styles.choiceValue, active && styles.activeValue]} numberOfLines={2}>{value}</Text></View>
    <Ionicons name="chevron-forward" size={17} color="#FFFFFF" />
  </Pressable>;
}

const styles = StyleSheet.create({
  panels: { flex: 1, overflow: 'hidden' },
  panel: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  page: { flex: 1, backgroundColor: palette.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 5, gap: 4 },
  back: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontFamily: 'DMSans_700Bold', fontSize: 23, color: '#FFFFFF' },
  reset: { minHeight: 42, paddingHorizontal: 12, justifyContent: 'center' },
  resetText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: palette.accent },
  resetOff: { opacity: 0.4 },
  doneOff: { opacity: 0.5 },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, maxWidth: 620, width: '100%', alignSelf: 'center' },
  tabs: { flexDirection: 'row', gap: 5, backgroundColor: '#242427', padding: 4, borderRadius: 24, marginHorizontal: 16, marginTop: 7, marginBottom: 4, maxWidth: 588, alignSelf: 'center', width: '92%' },
  tab: { flex: 1, minHeight: 40, borderRadius: 21, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
  tabHighlight: { position: 'absolute', left: 4, top: 4, bottom: 4, borderRadius: 21, backgroundColor: palette.accent },
  tabText: { color: palette.secondary, fontFamily: 'DMSans_700Bold', fontSize: 14 },
  tabCount: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.selected },
  tabCountSelected: { backgroundColor: '#FFE0E7' },
  tabCountText: { color: palette.accent, fontFamily: 'DMSans_700Bold', fontSize: 12 },
  tabCountTextSelected: { color: palette.accentText },
  intro: { paddingHorizontal: 2, marginBottom: 6 },
  title: { flexShrink: 1, fontFamily: 'DMSans_700Bold', fontSize: 21, lineHeight: 28, color: '#FFFFFF' },
  description: { fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19, color: palette.secondary, marginTop: 5 },
  sectionHeading: { marginTop: 15, marginBottom: 9, paddingHorizontal: 3 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 16 },
  sectionSubtitle: { color: '#BEB6BA', fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, marginTop: 5 },
  group: { backgroundColor: palette.surface, borderRadius: 20, overflow: 'hidden' },
  block: { paddingHorizontal: 16, paddingTop: 15, paddingBottom: 13 },
  label: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FFFFFF' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 40, gap: 5, paddingHorizontal: 13, borderRadius: 22, backgroundColor: '#393237' },
  chipSelected: { backgroundColor: palette.accent },
  chipText: { fontSize: 13, color: '#E9E3E6', fontFamily: 'DMSans_500Medium' },
  chipTextSelected: { color: palette.accentText },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#433B40', marginHorizontal: 16 },
  rangeValue: { color: palette.accent, fontFamily: 'DMSans_700Bold', fontSize: 18, fontVariant: ['tabular-nums'] },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  toggleBody: { flex: 1 },
  rowDetail: { color: palette.secondary, fontSize: 12, fontFamily: 'DMSans_400Regular', lineHeight: 17, marginTop: 4 },
  compactToggle: { paddingTop: 0, paddingBottom: 13 },
  flexibleLabel: { fontSize: 13 },
  choiceRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 14, gap: 10, minHeight: 56 },
  choiceLabelBody: { flex: 1 },
  choiceLabel: { color: '#FFFFFF', fontSize: 14, fontFamily: 'DMSans_500Medium' },
  valuePill: { maxWidth: '40%', backgroundColor: '#373137', borderRadius: 18, paddingHorizontal: 10, paddingVertical: 7 },
  areaRowSpacing: { gap: 8 },
  areaValueWidth: { maxWidth: '65%', flexShrink: 1 },
  choiceValue: { color: palette.secondary, fontSize: 12, lineHeight: 17, textAlign: 'right', fontFamily: 'DMSans_500Medium' },
  activeValue: { color: palette.accent },
  requiredText: { color: palette.accent, fontFamily: 'DMSans_400Regular', fontSize: 10, marginTop: 3 },
  distanceBlock: { paddingTop: 0 },
  distanceSlider: { height: 38, marginHorizontal: -6, marginTop: 7 },
  caption: { color: '#BEB6BA', fontFamily: 'DMSans_400Regular', fontSize: 12 },
  moreIntro: { paddingHorizontal: 2, paddingTop: 8, paddingBottom: 4 },
  moreIntroTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  criteriaGroupTitle: { fontFamily: 'DMSans_700Bold', color: '#FFFFFF', fontSize: 15, marginTop: 19, marginBottom: 9, paddingHorizontal: 3 },
  info: { flexDirection: 'row', gap: 9, paddingHorizontal: 3, marginTop: 18 },
  infoText: { flex: 1, color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18 },
  footer: { paddingHorizontal: 20, paddingTop: 10, backgroundColor: '#100F0D', alignSelf: 'center', width: '100%', maxWidth: 620 },
  previewNote: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  previewBadge: { backgroundColor: palette.selected, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  previewBadgeText: { color: palette.accent, fontFamily: 'DMSans_700Bold', fontSize: 10 },
  previewText: { flex: 1, color: '#BEB6BA', fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 16 },
  done: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, borderRadius: 25, backgroundColor: palette.accent },
  doneText: { color: palette.accentText, fontFamily: 'DMSans_700Bold', fontSize: 16 },
  donePressed: { backgroundColor: '#E6A7B5' },
  pressed: { opacity: 0.7 },
  rowPressed: { backgroundColor: '#382D33' },
});
