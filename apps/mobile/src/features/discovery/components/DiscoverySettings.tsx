import {MatchingIntroduction} from './MatchingIntroduction';
import React, { useEffect, useState, useRef } from "react";
import { formatDistance, useDistanceUnit } from "../../location/distanceUnits";
import {
  Modal,
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { RADIUS_PRESETS_KM, toRadiusPreset } from "@iem-dating/shared/location";
import { api } from "../../../services/api";
import { PREFERENCE_AGE_MAX, PREFERENCE_AGE_MIN, clampAgePreference } from "@iem-dating/shared/age";
import {
  locationErrorMessage,
  requestPermission,
  resetLocationSession,
  sendCurrentLocation,
} from "../../location/locationClient";
import { OnboardingFrame, ui } from '../../auth/onboarding/OnboardingFrame';
import { rose } from '../../auth/onboarding/theme';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../../store';
import { saveOnboardingDraft } from '../../../store/authSlice';
type Props = { embedded?: boolean; visible: boolean; onClose: () => void; onSaved: (confirmedAt?: string) => void; required?: boolean };
type Scope = "campus" | "college" | "city";
type ScopeOption = { id: Scope; label: string; detail: string; locked?: boolean };
/**
 * Who you see in college mode (GOOGLE_SIGNUP_PLAN.md 2.1): your college, or
 * both colleges in your city. The server names them for the person ("IEM",
 * "IEM & UEM Newtown"); these are only the words until it answers.
 */
const DEFAULT_SCOPES: ScopeOption[] = [
  { id: "campus", label: "My campus", detail: "Students from your campus." },
  { id: "college", label: "All my college campuses", detail: "Students from your college. Your own campus comes first." },
  { id: "city", label: "Both colleges", detail: "Both colleges in your city." },
];
/** Older saved values: "Whole group" is now both colleges. */
const simpleScope = (value: unknown): Scope => (value === "city" || value === "group" ? "city" : value === "campus" ? "campus" : "college");
const categories = [
  { id: "man", label: "Men" },
  { id: "woman", label: "Women" },
  { id: "nonbinary", label: "Nonbinary people" },
];
export function DiscoverySettings({ visible, onClose, onSaved, required = false, embedded = false }: Props) {
  const dispatch = useDispatch();
  const auth = useSelector((state: RootState) => state.auth);
  const initialDraft = useRef(auth.onboardingDraft?.fields.discovery).current;
  const [category, setCategory] = useState("");
  const [show, setShow] = useState<string[]>([]);
  const [min, setMin] = useState("18"),
    [max, setMax] = useState("30");
  const navigation = useNavigation<any>();
  const [mode, setMode] = useState("college"),
    [distance, setDistance] = useState(25);
  const [scope, setScope] = useState<Scope>("college");
  const [scopes, setScopes] = useState<ScopeOption[]>(DEFAULT_SCOPES);
  const [expandRadius, setExpandRadius] = useState(true);
  const unit = useDistanceUnit();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [locationReady, setLocationReady] = useState(false);
  const [locationError, setLocationError] = useState('');
  useEffect(() => {if (mode !== 'distance') setLocationError('');}, [mode]);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setBusy(true);
    setLoaded(false);
    setError("");
    setLocationReady(false);
    setLocationError('');
    Promise.all([api.get("/profile/discovery"), api.get("/profile/preferences"), api.get("/profile/location").catch(() => null)])
      .then(([res, preferences, location]) => {
        if (!active) return;
        const d = { ...res.data.data, ...(embedded ? initialDraft : {}) };
        setConfirmed(!!d.preferencesConfirmedAt);

        const gender = String(auth.onboardingDraft?.fields.gender ?? auth.user?.gender ?? '').toLowerCase();
        const directCategory = gender === 'man' || gender === 'woman' ? gender : '';
        setCategory(d.discoveryCategory || (embedded ? directCategory : ''));
        setShow(d.showMeCategories ?? []);
        setMin(String(clampAgePreference(d.minAgePref ?? (d.age ?? 21) - 3)));
        setMax(String(clampAgePreference(d.maxAgePref ?? (d.age ?? 21) + 5)));
        setMode(d.discoveryMode ?? "college");
        setDistance(toRadiusPreset(d.distancePreference ?? 25));
        const area = preferences.data.data?.areaOptions;
        if (!area) throw new Error('Missing college options');
        const nextScopes: ScopeOption[] = (['campus', 'college', 'city'] as Scope[])
          .filter(id => area[id])
          .map(id => ({id, label: area[id].label, detail: area[id].detail, locked: !!area[id].locked}));
        setScopes(nextScopes);
        const savedScope = simpleScope(d.collegeScope);
        setScope(nextScopes.find(item => item.id === savedScope && !item.locked)?.id
          ?? nextScopes.find(item => !item.locked)?.id ?? 'college');
        setExpandRadius(!!d.expandRadius);
        const status = location?.data?.data;
        setLocationReady(!!status?.consented && (!!status?.canSavePlace || (!!status?.fresh && !!status?.cell)));
        setLoaded(true);
      })
      .catch(() => {
        if (active)
          setError("Could not load preferences. Select Retry.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [visible, retry, embedded, initialDraft]);
  useEffect(() => {
    if (!embedded || !loaded) return;
    const timer = setTimeout(() => dispatch(saveOnboardingDraft({ fields: { discovery: {
      discoveryCategory: category, showMeCategories: show, minAgePref: min, maxAgePref: max,
      discoveryMode: mode, distancePreference: distance, collegeScope: scope, expandRadius,
    } } })), 300);
    return () => clearTimeout(timer);
  }, [embedded, loaded, category, show, min, max, mode, distance, scope, expandRadius, dispatch]);
  async function save() {
    if (!loaded || busy) return;
    if (embedded && mode === 'distance' && !locationReady) {
      setError('');
      setLocationError('Tap Share location to use Nearby.');
      return;
    }
    if (!category || !show.length) {
      setError("Select your discovery category and whom you want to see.");
      return;
    }
    if (!/^\d+$/.test(min) || !/^\d+$/.test(max) || Number(min) < PREFERENCE_AGE_MIN || Number(max) > PREFERENCE_AGE_MAX || Number(min) > Number(max)) {
      setError(`Enter ages from ${PREFERENCE_AGE_MIN} to ${PREFERENCE_AGE_MAX}. Minimum age must not exceed maximum age.`); return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await api.put("/profile/discovery", {
        discoveryCategory: category,
        showMeCategories: show,
        minAgePref: clampAgePreference(min),
        maxAgePref: clampAgePreference(max),
        discoveryMode: mode,
        distancePreference: distance,
        collegeScope: scope,
        expandRadius,
      });
      onSaved(response.data?.data?.preferencesConfirmedAt);
    } catch (e: any) {
      if (embedded && mode === 'distance' && e.response?.data?.code === 'LOCATION_REQUIRED') {
        setLocationReady(false);
        setLocationError('Tap Share location to use Nearby.');
        return;
      }
      setError(
        e.response?.data?.message ?? "Could not save preferences. Retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  /**
   * The prominent disclosure Google Play asks for, then the system dialog.
   * Approximate is enough; a precise fix is rounded on the phone.
   */
  function shareLocation() {
    Alert.alert(
      "Share your location?",
      "Distance discovery uses your location only while the app is open. Approximate location is enough: a precise one is rounded to about 2 km on your phone before it is sent. Others only ever see a distance band. You can remove it here at any time.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          onPress: async () => {
            setBusy(true);
            setError("");
            setLocationError('');
            try {
              const permission = await requestPermission();
              if (permission.status !== "granted") {
                (embedded ? setLocationError : setError)(
                  permission.canAskAgain
                    ? "Location was not allowed. You can use college discovery instead."
                    : "Location is blocked for this app. Allow it in your phone's settings, or use college discovery.",
                );
                return;
              }
              await sendCurrentLocation(permission.accuracy);
              setLocationReady(true);
              setLocationError('');
              setMode("distance");
            } catch (cause) {
              (embedded ? setLocationError : setError)(locationErrorMessage(cause));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }
  async function removeLocation() {
    setBusy(true);
    setError("");
    try {
      await api.delete("/profile/location");
      resetLocationSession();
      setLocationReady(false);
      setLocationError('');
      setMode("college");
    } catch {
      setError("Could not remove location. Retry.");
    } finally {
      setBusy(false);
    }
  }
  if (embedded) return <MatchingIntroduction category={category} setCategory={setCategory} show={show} setShow={setShow}
    min={min} max={max} setMin={setMin} setMax={setMax} mode={mode} setMode={setMode}
    distance={distance} setDistance={setDistance} scope={scope} setScope={setScope} scopes={scopes}
    expandRadius={expandRadius} setExpandRadius={setExpandRadius} busy={busy} loaded={loaded} error={error}
    locationReady={locationReady} locationError={locationError}
    onBack={onClose} onNext={save} retry={() => setRetry(value => value + 1)} shareLocation={shareLocation} removeLocation={removeLocation}/>;
  const content = (
    <OnboardingFrame stage={embedded ? 2 : undefined} title="Matching preferences" subtitle="Choose who you want to see and where to find them." onBack={embedded || !required ? onClose : undefined} onNext={save} action={embedded ? 'Continue' : 'Confirm preferences'} disabled={!loaded || !category || !show.length} busy={busy} error={error}>
        {!loaded && !busy && <TouchableOpacity accessibilityRole="button" onPress={() => setRetry(value => value + 1)} style={ui.choice}><Text style={ui.link}>Retry</Text></TouchableOpacity>}
        {loaded && !confirmed && (
          <Text style={styles.text}>
            Confirm these preferences to appear in discovery and see other
            people. We do not select preferences from your gender or
            orientation.
          </Text>
        )}
        <Text style={styles.text}>
          Your discovery category controls whose preferences include you. It
          does not change your displayed gender. Select the category you want to
          use.
        </Text>
        <Text style={styles.label}>Include me in</Text>
        <View style={styles.row}>{categories.map((c) => (
          <TouchableOpacity
            accessibilityRole="radio"
            accessibilityState={{ checked: category === c.id }}
            key={c.id}
            style={[styles.segment, category === c.id && styles.selected]}
            onPress={() => setCategory(c.id)}
          >
            <Text style={[styles.text, {fontSize: 13, textAlign: "center"}]}>{(category === c.id ? "✓ " : "") + c.label}</Text>
          </TouchableOpacity>
        ))}</View>
        <Text style={styles.label}>Show me</Text>
        <View style={styles.row}>{categories.map((c) => (
          <TouchableOpacity
            accessibilityRole="checkbox"
            accessibilityState={{ checked: show.includes(c.id) }}
            key={c.id}
            style={[styles.segment, show.includes(c.id) && styles.selected]}
            onPress={() =>
              setShow((s) =>
                s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id],
              )
            }
          >
            <Text style={[styles.text, {fontSize: 13, textAlign: "center"}]}>{(show.includes(c.id) ? "✓ " : "") + c.label}</Text>
          </TouchableOpacity>
        ))}</View>
        <Text style={styles.text}>
          Both people must accept each other's category and age.
        </Text>
        <Text style={styles.label}>Age range ({PREFERENCE_AGE_MIN}–{PREFERENCE_AGE_MAX})</Text>
        <View style={styles.row}>
          <TextInput
            accessibilityLabel="Minimum age"
            keyboardType="number-pad"
            value={min}
            onChangeText={setMin}
            style={styles.input}
          />
          <Text style={styles.text}>to</Text>
          <TextInput
            accessibilityLabel="Maximum age"
            keyboardType="number-pad"
            value={max}
            onChangeText={setMax}
            style={styles.input}
          />
        </View>
        <Text style={styles.label}>How to find people</Text>
        {[
          { id: "college", label: "College mode", detail: "No location needed." },
          { id: "distance", label: "Distance mode", detail: "Uses your location while the app is open." },
        ].map((c) => (
          <TouchableOpacity
            key={c.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: mode === c.id }}
            style={[styles.option, mode === c.id && styles.selected]}
            onPress={() => setMode(c.id)}
          >
            <Text style={styles.text}>{(mode === c.id ? "✓ " : "") + c.label}</Text>
            <Text style={styles.hint}>{c.detail}</Text>
          </TouchableOpacity>
        ))}

        {mode === "college" ? (
          <>
            <Text style={styles.label}>Who you see</Text>
            {scopes.map((option) => (
              <TouchableOpacity
                key={option.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: scope === option.id, disabled: option.locked }}
                disabled={option.locked}
                style={[styles.option, scope === option.id && styles.selected, option.locked && { opacity: 0.5 }]}
                onPress={() => setScope(option.id)}
              >
                <Text style={styles.text}>{(scope === option.id ? "✓ " : "") + option.label}</Text>
                <Text style={styles.hint}>{option.locked ? "Verify your college to choose this." : option.detail}</Text>
              </TouchableOpacity>
            ))}
            <Text style={styles.hint}>
              This works both ways: someone from another campus only appears
              if their setting includes you too. People from your own college
              always come first.
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.label}>Distance</Text>
            <View style={styles.chips}>
              {RADIUS_PRESETS_KM.map((km) => (
                <TouchableOpacity
                  key={km}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: distance === km }}
                  style={[styles.chip, distance === km && styles.selected]}
                  onPress={() => setDistance(km)}
                >
                  <Text style={styles.text}>{formatDistance(km, unit)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              accessibilityRole="switch"
              accessibilityState={{ checked: expandRadius }}
              style={[styles.option, expandRadius && styles.selected]}
              onPress={() => setExpandRadius((value) => !value)}
            >
              <Text style={styles.text}>
                Show people further away when I run out
              </Text>
              <Text style={styles.hint}>
                Off means your distance is a strict limit. On, people beyond
                it appear only after everyone inside it.
              </Text>
            </TouchableOpacity>
          </>
        )}
        {mode === "distance" && <>
        <TouchableOpacity
          accessibilityRole="button"
          disabled={busy}
          style={styles.option}
          onPress={shareLocation}
        >
          <Text style={styles.text}>Share current location</Text>
        </TouchableOpacity>
        {!embedded && <TouchableOpacity
          accessibilityRole="button"
          disabled={busy}
          style={styles.option}
          onPress={() => {
            onClose();
            navigation.navigate("LocationSettings");
          }}
        >
          <Text style={styles.text}>Saved places and location privacy</Text>
        </TouchableOpacity>}
        <TouchableOpacity
          accessibilityRole="button"
          disabled={busy}
          style={styles.option}
          onPress={removeLocation}
        >
          <Text style={styles.text}>Remove stored location</Text>
        </TouchableOpacity>
        </>}
    </OnboardingFrame>
  );
  return embedded ? content : <Modal visible={visible} animationType="slide" onRequestClose={onClose}>{content}</Modal>;
}
const styles = StyleSheet.create({
  segment: {flex: 1, borderWidth: 1, borderColor: rose.border, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 5},
  container: {
    padding: 24,
    paddingTop: 55,
    paddingBottom: 60,
    backgroundColor: rose.canvas,
    flexGrow: 1,
  },
  title: { color: rose.text, fontSize: 24, fontWeight: "700", marginBottom: 16 },
  label: { color: rose.text, fontSize: 18, marginTop: 20, marginBottom: 8 },
  text: { fontFamily: 'DMSans_500Medium', color: rose.text, fontSize: 15, lineHeight: 22 },
  option: {
    borderWidth: 1,
    borderColor: rose.border,
    padding: 18,
    borderRadius: 18,
    marginVertical: 5,
  },
  selected: { borderColor: rose.highlight, backgroundColor: rose.selected },
  input: {
    borderColor: rose.border,
    borderWidth: 1,
    borderRadius: 16,
    color: rose.text,
    flex: 1,
    textAlign: "center",
    fontFamily: "CormorantGaramond_600SemiBold",
    fontSize: 38,
    padding: 12,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  hint: { fontFamily: 'DMSans_400Regular', color: rose.secondary, fontSize: 13, lineHeight: 18, marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: rose.border,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  error: { color: rose.error, marginVertical: 12 },
});
