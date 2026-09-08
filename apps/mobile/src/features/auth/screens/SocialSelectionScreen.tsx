import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  ScrollView,
  TextInput,
  Keyboard,
} from "react-native";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { api } from "../../../services/api";

const { width } = Dimensions.get("window");

const CLUBS = ["Robotics", "Tech/Coding", "Music/Band", "Dance", "Drama", "Sports", "Photography", "Debate"];
const ATTENDANCE_STYLES = ["75% Maintainer", "Front Bencher", "Bunker", "Risk Taker"];

export const SocialSelectionScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user, token, ...profileData } = route.params || {};

  const [selectedClubs, setSelectedClubs] = useState<string[]>([]);
  const [attendanceMood, setAttendanceMood] = useState<string | null>(null);
  const [hangoutSpot, setHangoutSpot] = useState("");
  const [updating, setUpdating] = useState(false);
  // This screen stays mounted in the navigation stack, so returning to it
  // after a successful save would otherwise leave a stuck loading button
  // that is also disabled. Clearing on focus covers every exit path.
  useFocusEffect(
    React.useCallback(() => {
      setUpdating(false);
    }, [])
  );

  const [keyboardContentInset, setKeyboardContentInset] = useState(0);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const buttonKeyboardOffset = useRef(new Animated.Value(0)).current;
  const initialWindowHeight = useRef(Dimensions.get("window").height);
  const scrollViewRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      const resizedHeight = Math.max(
        0,
        initialWindowHeight.current - Dimensions.get("window").height
      );
      const requiredLift = Platform.OS === "android"
        ? Math.max(0, event.endCoordinates.height - resizedHeight)
        : 0;

      setKeyboardContentInset(requiredLift + 40);

      Animated.timing(buttonKeyboardOffset, {
        toValue: -requiredLift,
        duration: event.duration || 180,
        useNativeDriver: true,
      }).start();

      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    });

    const hideSubscription = Keyboard.addListener(hideEvent, (event) => {
      setKeyboardContentInset(0);
      Animated.timing(buttonKeyboardOffset, {
        toValue: 0,
        duration: event.duration || 180,
        useNativeDriver: true,
      }).start();
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [buttonKeyboardOffset]);

  const toggleClub = (club: string) => {
    if (selectedClubs.includes(club)) {
      setSelectedClubs(selectedClubs.filter(c => c !== club));
    } else if (selectedClubs.length < 5) {
      setSelectedClubs([...selectedClubs, club]);
    }
  };

  const handleNext = async () => {
    if (!attendanceMood) return;
    
    setUpdating(true);
    try {
      const finalData = {
        ...profileData,
        clubs: selectedClubs,
        attendanceMood: attendanceMood,
        hangoutSpots: hangoutSpot ? [hangoutSpot] : [],
      };

      // In a real app, we might wait until the very end to save, 
      // but here we follow the pattern of saving incrementally or passing state.
      // Since the original flow saves at CollegeSelection, we'll follow that pattern 
      // of passing data to the final registration step.
      
      navigation.navigate("OrientationSelection", {
        ...route.params,
        ...finalData
      });
    } catch (error) {
      console.error("Failed to process social selection:", error);
      setUpdating(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      <KeyboardAvoidingView 
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardView}
      >
        <View style={styles.topHeader}>
          <TouchableOpacity onPress={() => navigation.navigate("CampusSelection")}>
            <MaterialCommunityIcons name="arrow-left" size={32} color="#FFF" />
          </TouchableOpacity>
        </View>

        <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <ScrollView
            ref={scrollViewRef}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={[
              styles.scrollContent,
              keyboardContentInset > 0 && { paddingBottom: keyboardContentInset },
            ]}
          >
            <View style={styles.header}>
              <Text style={styles.title}>Social & Vibes</Text>
              <Text style={styles.subtitle}>
                Relatable IEM things to start the conversation.
              </Text>
            </View>

            <Text style={styles.sectionLabel}>IEM Clubs (Max 5)</Text>
            <View style={styles.chipsContainer}>
              {CLUBS.map((club) => (
                <TouchableOpacity
                  key={club}
                  style={[
                    styles.chip,
                    selectedClubs.includes(club) && styles.chipSelected
                  ]}
                  onPress={() => toggleClub(club)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, selectedClubs.includes(club) && styles.chipTextSelected]}>
                    {club}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.sectionLabel, { marginTop: 25 }]}>Attendance Style</Text>
            <View style={styles.attendanceContainer}>
              {ATTENDANCE_STYLES.map((style) => (
                <TouchableOpacity
                  key={style}
                  style={[
                    styles.styleOption,
                    attendanceMood === style && styles.styleOptionSelected
                  ]}
                  onPress={() => setAttendanceMood(style)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.styleText, attendanceMood === style && styles.styleTextSelected]}>
                    {style}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.sectionLabel, { marginTop: 25 }]}>Favorite Sector V Spot</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="e.g. RDB chai stall or CCD"
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={hangoutSpot}
                onChangeText={setHangoutSpot}
                multiline
                numberOfLines={2}
                maxLength={100}
                textAlignVertical="top"
                onFocus={() => {
                  setTimeout(() => {
                    scrollViewRef.current?.scrollToEnd({ animated: true });
                  }, 180);
                }}
              />
            </View>
          </ScrollView>

          <Animated.View
            style={[
              styles.footer,
              { transform: [{ translateY: buttonKeyboardOffset }] },
            ]}
          >
            <TouchableOpacity 
              style={[styles.nextButton, (!attendanceMood || updating) && styles.disabledNextButton]}
              onPress={handleNext}
              disabled={!attendanceMood || updating}
              activeOpacity={0.8}
            >
              <Text style={styles.nextButtonText}>
                {updating ? "Processing..." : "Next"}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F1115",
  },
  keyboardView: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 60 : 40,
    paddingBottom: 20,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 10,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    marginBottom: 25,
  },
  title: {
    fontSize: 34,
    fontWeight: "800",
    color: "#FFF",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: "rgba(255,255,255,0.6)",
    lineHeight: 24,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#F94E27",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 15,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -5,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.2)",
    margin: 5,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  chipSelected: {
    borderColor: "#F94E27",
    backgroundColor: "rgba(249, 78, 39, 0.15)",
  },
  chipText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 15,
    fontWeight: "600",
  },
  chipTextSelected: {
    color: "#FFF",
  },
  attendanceContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  styleOption: {
    width: (width - 55) / 2,
    paddingVertical: 15,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.1)",
    alignItems: 'center',
    marginBottom: 10,
  },
  styleOptionSelected: {
    borderColor: "#F94E27",
    backgroundColor: "rgba(249, 78, 39, 0.1)",
  },
  styleText: {
    color: "rgba(255,255,255,0.8)",
    fontWeight: "600",
  },
  styleTextSelected: {
    color: "#FFF",
    fontWeight: "800",
  },
  inputContainer: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 15,
  },
  input: {
    minHeight: 72,
    maxHeight: 96,
    color: "#FFF",
    fontSize: 15,
    lineHeight: 21,
    paddingVertical: 13,
    includeFontPadding: false,
    textAlignVertical: "top",
  },
  footer: {
    paddingVertical: 10,
  },
  nextButton: {
    backgroundColor: '#FFF',
    width: '100%',
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000',
  },
  disabledNextButton: {
    opacity: 0.5,
  },
});
