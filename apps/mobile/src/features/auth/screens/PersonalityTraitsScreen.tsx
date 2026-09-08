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

type TraitOption = {
  id: string;
  label: string;
};

type TraitSection = {
  id: string;
  title: string;
  icon: string;
  options: TraitOption[];
};

const TRAIT_SECTIONS: TraitSection[] = [
  {
    id: "communication",
    title: "What's your communication style?",
    icon: "message-text-outline",
    options: [
      { id: "whatsapp_all_day", label: "I stay on WhatsApp all day" },
      { id: "big_time_texter", label: "Big time texter" },
      { id: "phone_caller", label: "Phone caller" },
      { id: "video_chatter", label: "Video chatter" },
      { id: "slow_to_answer", label: "I'm slow to answer on WhatsApp" },
      { id: "bad_texter", label: "Bad texter" },
      { id: "better_in_person", label: "Better in person" },
    ],
  },
  {
    id: "love_reception",
    title: "How do you receive love?",
    icon: "heart-outline",
    options: [
      { id: "thoughtful_gestures", label: "Thoughtful gestures" },
      { id: "presents", label: "Presents" },
      { id: "touch", label: "Touch" },
      { id: "compliments", label: "Compliments" },
      { id: "time_together", label: "Time together" },
    ],
  },
  {
    id: "education",
    title: "What is your education level?",
    icon: "school-outline",
    options: [
      { id: "bachelor", label: "Bachelor degree" },
      { id: "at_uni", label: "At uni" },
      { id: "high_school", label: "High school" },
      { id: "phd", label: "PhD" },
      { id: "graduate_programme", label: "On a graduate programme" },
      { id: "master", label: "Master degree" },
      { id: "trade_college", label: "Trade college" },
    ],
  },
  {
    id: "star_sign",
    title: "What's your star sign?",
    icon: "moon-waning-crescent",
    options: [
      { id: "capricorn", label: "Capricorn" },
      { id: "aquarius", label: "Aquarius" },
      { id: "pisces", label: "Pisces" },
      { id: "aries", label: "Aries" },
      { id: "taurus", label: "Taurus" },
      { id: "gemini", label: "Gemini" },
      { id: "cancer", label: "Cancer" },
      { id: "leo", label: "Leo" },
      { id: "virgo", label: "Virgo" },
      { id: "libra", label: "Libra" },
      { id: "scorpio", label: "Scorpio" },
      { id: "sagittarius", label: "Sagittarius" },
    ],
  },
  {
    id: "personality",
    title: "How would you describe your personality?",
    icon: "account-outline",
    options: [
      { id: "introvert", label: "Introvert" },
      { id: "extrovert", label: "Extrovert" },
      { id: "ambivert", label: "Ambivert" },
      { id: "chill", label: "Chill" },
      { id: "energetic", label: "Energetic" },
    ],
  },
];

export const PersonalityTraitsScreen = () => {
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

  const handleSelect = (sectionId: string, optionId: string) => {
    setSelections((prev) => ({
      ...prev,
      [sectionId]: optionId,
    }));
  };

  const selectedCount = Object.keys(selections).length;
  const isComplete = selectedCount === TRAIT_SECTIONS.length;

  const handleNext = async () => {
    if (!isComplete) return;

    setUpdating(true);
    try {
      const personalityTraits = selections;
      
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
          personality: personalityTraits,
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

      console.log("Personality traits saved successfully. Navigating to Interests...");
      setUpdating(false);

      navigation.navigate("Interests", {
        ...route.params,
        preferences: {
          ...currentPrefs,
          personality: personalityTraits,
        },
      });
    } catch (error) {
      console.error("Failed to save personality traits");
      setUpdating(false);
      alert("Failed to save settings. Please try again.");
    }
  };

  const handleSkip = () => {
    console.log("Skipping Personality Traits, navigating to Interests...");
    navigation.navigate("Interests", { ...route.params });
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      <View style={styles.headerNav}>
        <TouchableOpacity onPress={() => navigation.navigate("LifestyleHabits")}>
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
          <Text style={styles.mainTitle}>What else makes you, you?</Text>
          <Text style={styles.subtitle}>Don't hold back. Authenticity attracts authenticity.</Text>

          {TRAIT_SECTIONS.map((section) => (
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
            {updating ? "Saving..." : `Next ${selectedCount}/5`}
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
    color: "rgba(255,255,255,0.4)",
    fontSize: 16,
    fontWeight: "700",
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
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    marginRight: 8,
    marginBottom: 10,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  optionPillSelected: {
    borderColor: "#F94E27",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  optionLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    fontWeight: "600",
    includeFontPadding: false,
    textAlignVertical: "center",
    paddingTop: 2,
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
