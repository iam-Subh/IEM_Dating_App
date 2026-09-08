import React, { useEffect, useState } from "react";
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
import * as Location from "expo-location";
import { api } from "../../../services/api";
type Props = { visible: boolean; onClose: () => void; onSaved: (confirmedAt?: string) => void; required?: boolean };
const categories = [
  { id: "man", label: "Men" },
  { id: "woman", label: "Women" },
  { id: "nonbinary", label: "Nonbinary people" },
];
export function DiscoverySettings({ visible, onClose, onSaved, required = false }: Props) {
  const [category, setCategory] = useState("");
  const [show, setShow] = useState<string[]>([]);
  const [min, setMin] = useState("18"),
    [max, setMax] = useState("30");
  const [mode, setMode] = useState("college"),
    [distance, setDistance] = useState("50");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setBusy(true);
    setLoaded(false);
    setError("");
    api
      .get("/profile/discovery")
      .then((res) => {
        if (!active) return;
        const d = res.data.data;
        setConfirmed(!!d.preferencesConfirmedAt);
        setLoaded(true);
        setCategory(d.discoveryCategory ?? "");
        setShow(d.showMeCategories ?? []);
        setMin(String(d.minAgePref ?? Math.max(18, (d.age ?? 21) - 3)));
        setMax(String(d.maxAgePref ?? Math.min(120, (d.age ?? 21) + 5)));
        setMode(d.discoveryMode ?? "college");
        setDistance(String(d.distancePreference ?? 50));
      })
      .catch(() => {
        if (active)
          setError("Could not load preferences. Close this screen and retry.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [visible]);
  async function save() {
    if (!loaded || busy) return;
    if (!category || !show.length) {
      setError("Select your discovery category and whom you want to see.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await api.put("/profile/discovery", {
        discoveryCategory: category,
        showMeCategories: show,
        minAgePref: Number(min),
        maxAgePref: Number(max),
        discoveryMode: mode,
        distancePreference: Number(distance),
      });
      onSaved(response.data?.data?.preferencesConfirmedAt);
    } catch (e: any) {
      setError(
        e.response?.data?.message ?? "Could not save preferences. Retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  function shareLocation() {
    Alert.alert(
      "Share approximate location?",
      "The server stores your location on an approximate grid for distance discovery. Other users see a distance band. You can remove your stored location here.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Share location",
          onPress: async () => {
            setBusy(true);
            setError("");
            try {
              const permission =
                await Location.requestForegroundPermissionsAsync();
              if (permission.status !== "granted") {
                setError(
                  "Location permission was not granted. You can use college discovery.",
                );
                return;
              }
              const location = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
              });
              await api.put("/profile/location", {
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
              });
              setMode("distance");
            } catch {
              setError(
                "Could not share location. Retry or use college discovery.",
              );
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
      setMode("college");
    } catch {
      setError("Could not remove location. Retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Discovery preferences</Text>
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
        {categories.map((c) => (
          <TouchableOpacity
            accessibilityRole="radio"
            accessibilityState={{ checked: category === c.id }}
            key={c.id}
            style={[styles.option, category === c.id && styles.selected]}
            onPress={() => setCategory(c.id)}
          >
            <Text style={styles.text}>{c.label}</Text>
          </TouchableOpacity>
        ))}
        <Text style={styles.label}>Show me</Text>
        {categories.map((c) => (
          <TouchableOpacity
            accessibilityRole="checkbox"
            accessibilityState={{ checked: show.includes(c.id) }}
            key={c.id}
            style={[styles.option, show.includes(c.id) && styles.selected]}
            onPress={() =>
              setShow((s) =>
                s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id],
              )
            }
          >
            <Text style={styles.text}>{c.label}</Text>
          </TouchableOpacity>
        ))}
        <Text style={styles.text}>
          Both people must accept each other's category and age.
        </Text>
        <Text style={styles.label}>Age range (18–120)</Text>
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
        <Text style={styles.label}>Location rule</Text>
        {[
          { id: "college", label: "Same college" },
          { id: "distance", label: "Distance (requires shared location)" },
        ].map((c) => (
          <TouchableOpacity
            key={c.id}
            style={[styles.option, mode === c.id && styles.selected]}
            onPress={() => setMode(c.id)}
          >
            <Text style={styles.text}>{c.label}</Text>
          </TouchableOpacity>
        ))}
        <Text style={styles.text}>
          {mode === "college"
            ? "Show people at your college who also selected college discovery."
            : "Both people must select distance discovery and be within each other’s distance limit. Share location in the app before selecting this mode."}
        </Text>
        <Text style={styles.label}>Distance limit in km (1–100)</Text>
        <TextInput
          accessibilityLabel="Distance in kilometres"
          keyboardType="number-pad"
          value={distance}
          onChangeText={setDistance}
          style={styles.input}
        />
        <TouchableOpacity
          disabled={busy}
          style={styles.option}
          onPress={shareLocation}
        >
          <Text style={styles.text}>Share current location</Text>
        </TouchableOpacity>
        <TouchableOpacity
          disabled={busy}
          style={styles.option}
          onPress={removeLocation}
        >
          <Text style={styles.text}>Remove stored location</Text>
        </TouchableOpacity>
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        <TouchableOpacity
          disabled={busy || !loaded}
          style={[styles.option, styles.selected]}
          accessibilityState={{ disabled: busy || !loaded }}
          onPress={save}
        >
          {busy ? (
            <ActivityIndicator />
          ) : (
            <Text style={styles.text}>Confirm preferences</Text>
          )}
        </TouchableOpacity>
        {!required && (
          <TouchableOpacity style={styles.option} onPress={onClose}>
            <Text style={styles.text}>Close</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  container: {
    padding: 24,
    paddingTop: 55,
    paddingBottom: 60,
    backgroundColor: "#1F2125",
    flexGrow: 1,
  },
  title: { color: "#fff", fontSize: 24, fontWeight: "700", marginBottom: 16 },
  label: { color: "#fff", fontSize: 18, marginTop: 20, marginBottom: 8 },
  text: { color: "#fff", fontSize: 15, lineHeight: 22 },
  option: {
    borderWidth: 1,
    borderColor: "#777",
    padding: 14,
    borderRadius: 10,
    marginVertical: 5,
  },
  selected: { borderColor: "#6AB04C", backgroundColor: "#294523" },
  input: {
    borderColor: "#aaa",
    borderWidth: 1,
    borderRadius: 8,
    color: "#fff",
    minWidth: 80,
    padding: 12,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  error: { color: "#ffb0a0", marginVertical: 12 },
});
