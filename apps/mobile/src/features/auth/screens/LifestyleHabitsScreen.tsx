import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Animated,
  ScrollView,
  Dimensions,
  Platform,
  SafeAreaView,
} from "react-native";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useDispatch } from "react-redux";
import { setCredentials, updateUser } from "../../../store/authSlice";
import { api } from "../../../services/api";

const { width } = Dimensions.get("window");

type HabitOption = {
  id: string;
  label: string;
};

type HabitSection = {
  id: string;
  title: string;
  icon: string;
  options: HabitOption[];
};

const HABIT_SECTIONS: HabitSection[] = [
  {
    id: "drink",
    title: "How often do you drink?",
    icon: "glass-wine",
    options: [
      { id: "not_for_me", label: "Not for me" },
      { id: "newly_teetotal", label: "Newly teetotal" },
      { id: "sober_curious", label: "Sober curious" },
      { id: "special_occasions", label: "On special occasions" },
      { id: "socially", label: "Socially, at the weekend" },
      { id: "most_nights", label: "Most nights" },
    ],
  },
  {
    id: "smoke",
    title: "How often do you smoke?",
    icon: "cigar",
    options: [
      { id: "social_smoker", label: "Social smoker" },
      { id: "smoker_drinking", label: "Smoker when drinking" },
      { id: "non_smoker", label: "Non-smoker" },
      { id: "smoker", label: "Smoker" },
      { id: "trying_to_quit", label: "Trying to quit" },
    ],
  },
  {
    id: "exercise",
    title: "Do you exercise?",
    icon: "dumbbell",
    options: [
      { id: "every_day", label: "Every day" },
      { id: "often", label: "Often" },
      { id: "sometimes", label: "Sometimes" },
      { id: "never", label: "Never" },
    ],
  },
  {
    id: "pets",
    title: "Do you have any pets?",
    icon: "paw",
    options: [
      { id: "dog", label: "Dog" },
      { id: "cat", label: "Cat" },
      { id: "reptile", label: "Reptile" },
      { id: "amphibian", label: "Amphibian" },
      { id: "bird", label: "Bird" },
      { id: "fish", label: "Fish" },
      { id: "love_pets", label: "Don't have, but love" },
      { id: "other", label: "Other" },
      { id: "turtle", label: "Turtle" },
      { id: "hamster", label: "Hamster" },
      { id: "rabbit", label: "Rabbit" },
      { id: "pet_free", label: "Pet-free" },
      { id: "all_pets", label: "All the pets" },
      { id: "want_pet", label: "Want a pet" },
      { id: "allergic", label: "Allergic to pets" },
    ],
  },
];

export const LifestyleHabitsScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const { user, token, ...profileData } = route.params || {};

  const [selections, setSelections] = useState<Record<string, string>>({});
  const [updating, setUpdating] = useState(false);

  // This screen stays mounted in the navigation stack, so returning to it
  // after a successful save would otherwise leave a stuck loading button
  // that is also disabled. Clearing on focus covers every exit path.
  useFocusEffect(
    React.useCallback(() => {
      setUpdating(false);
    }, [])
  );

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

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

  const handleSkip = () => {
    console.log("Skipping Lifestyle Habits, navigating to PersonalityTraits...");
    navigation.navigate("PersonalityTraits", { ...route.params });
  };

  const handleSelect = (sectionId: string, optionId: string) => {
    setSelections((prev) => ({
      ...prev,
      [sectionId]: optionId,
    }));
  };

  const selectedCount = Object.keys(selections).length;
  const isComplete = selectedCount === HABIT_SECTIONS.length;

  const handleNext = async () => {
    if (!isComplete) return;

    setUpdating(true);
    try {
      const lifestyleHabits = selections;
      
      const currentPrefs = (route.params?.preferences && typeof route.params.preferences === 'object') 
        ? route.params.preferences 
        : (user?.preferences && typeof user.preferences === 'object') 
          ? user.preferences 
          : {};

      const {
        campus,
        isHosteller,
        clubs,
        attendanceMood,
        hangoutSpots,
        orientation,
        showOrientation,
        distancePreference,
        seeking,
        department,
        degree,
        graduationYear,
        yearOfStudy
      } = route.params || {};

      const finalData: any = {
        preferences: {
          ...currentPrefs,
          lifestyle: lifestyleHabits,
        },
      };

      if (campus !== undefined) finalData.campus = campus;
      if (isHosteller !== undefined) finalData.isHosteller = isHosteller;
      if (clubs !== undefined) finalData.clubs = clubs;
      if (attendanceMood !== undefined) finalData.attendanceMood = attendanceMood;
      if (hangoutSpots !== undefined) finalData.hangoutSpots = hangoutSpots;
      if (orientation !== undefined) finalData.orientation = orientation;
      if (showOrientation !== undefined) finalData.showOrientation = showOrientation;
      if (distancePreference !== undefined) finalData.distancePreference = distancePreference;
      if (seeking !== undefined) finalData.seeking = seeking;
      if (department !== undefined) finalData.department = department;
      if (degree !== undefined) finalData.degree = degree;
      if (graduationYear !== undefined) finalData.graduationYear = graduationYear;
      if (yearOfStudy !== undefined) finalData.yearOfStudy = yearOfStudy;


      const response = await api.put("/profile", finalData);

      if (response.data?.success) {
        dispatch(updateUser(response.data.data));
      }

      console.log("Lifestyle habits saved successfully. Navigating to PersonalityTraits...");
      setUpdating(false);

      navigation.navigate("PersonalityTraits", {
        ...route.params,
        preferences: {
          ...currentPrefs,
          lifestyle: lifestyleHabits,
        },
      });

    } catch (error) {
      console.error("Failed to save lifestyle habits");
      setUpdating(false);
      alert("Failed to save settings. Please try again.");
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      <View style={styles.headerNav}>
        <TouchableOpacity onPress={() => navigation.navigate("SeekingSelection")}>
          <MaterialCommunityIcons name="arrow-left" size={28} color="#FFF" />
        </TouchableOpacity>
        <TouchableOpacity onPress={handleSkip}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={[styles.mainContent, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <Text style={styles.mainTitle}>Let’s talk lifestyle habits, {user?.name || "there"}</Text>
          <Text style={styles.subtitle}>Do their habits match yours? You go first.</Text>

          {HABIT_SECTIONS.map((section) => (
            <View key={section.id} style={styles.section}>
              <View style={styles.sectionHeader}>
                <MaterialCommunityIcons name={section.icon as any} size={20} color="rgba(255,255,255,0.6)" />
                <Text style={styles.sectionTitle}>{section.title}</Text>
              </View>
              
              <View style={styles.optionsContainer}>
                {section.options.map((option) => (
                  <TouchableOpacity
                    key={option.id}
                    style={[
                      styles.optionPill,
                      selections[section.id] === option.id && styles.optionPillSelected
                    ]}
                    onPress={() => handleSelect(section.id, option.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={[
                      styles.optionLabel,
                      selections[section.id] === option.id && styles.optionLabelSelected
                    ]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.divider} />
            </View>
          ))}
        </Animated.View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.nextButton,
            isComplete && styles.nextButtonActive,
            (!isComplete || updating) && styles.disabledButton,
          ]}
          onPress={handleNext}
          disabled={!isComplete || updating}
          activeOpacity={0.8}
        >
          <Text style={[
            styles.nextButtonText,
            isComplete && styles.nextButtonTextActive
          ]}>
            {updating ? "Saving..." : `Next ${selectedCount}/4`}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F1115",
  },
  headerNav: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 10 : 45,
    height: Platform.OS === "ios" ? 60 : 90,
  },
  skipText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 16,
    fontWeight: "600",
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  mainContent: {
    marginTop: 20,
  },
  mainTitle: {
    fontSize: 32,
    fontWeight: "800",
    color: "#FFF",
    lineHeight: 40,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: "rgba(255,255,255,0.6)",
    marginBottom: 40,
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFF",
    marginLeft: 12,
  },
  optionsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 10,
  },
  optionPill: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    marginRight: 8,
    marginBottom: 10,
    backgroundColor: "transparent",
  },
  optionPillSelected: {
    borderColor: "#F94E27",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  optionLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    lineHeight: 14,
    fontWeight: "600",
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  optionLabelSelected: {
    color: "#FFF",
    fontWeight: "600",
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.05)",
    marginTop: 10,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === "ios" ? 40 : 20,
    paddingTop: 20,
    backgroundColor: "#0F1115",
  },
  nextButton: {
    backgroundColor: "rgba(255,255,255,0.15)",
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  nextButtonActive: {
    backgroundColor: "#FFF",
    shadowColor: "#FFF",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 8,
  },
  disabledButton: {
    opacity: 0.5,
  },
  nextButtonText: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 18,
    fontWeight: "700",
  },
  nextButtonTextActive: {
    color: "#000",
  },
});
