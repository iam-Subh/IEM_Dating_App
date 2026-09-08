import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
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
  TextInput,
  Pressable,
} from "react-native";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useDispatch } from "react-redux";
import { setCredentials, updateUser } from "../../../store/authSlice";
import { api } from "../../../services/api";

const { width } = Dimensions.get("window");

import { INTEREST_CATEGORIES, InterestOption } from "@iem-dating/shared/interest-catalog";

type InterestPillProps = {
  interest: InterestOption;
  selected: boolean;
  onToggle: (interestId: string) => void;
};

const InterestPill = React.memo(({ interest, selected, onToggle }: InterestPillProps) => (
  <Pressable
    style={({ pressed }) => [
      styles.interestPill,
      selected && styles.interestPillSelected,
      pressed && styles.interestPillPressed,
    ]}
    onPress={() => onToggle(interest.id)}
  >
    <Text style={[
      styles.interestLabel,
      selected && styles.interestLabelSelected,
    ]}>
      {interest.label}
    </Text>
  </Pressable>
));

const MAX_INTERESTS = INTEREST_CATEGORIES.length;

export const InterestsScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const { user, token, ...profileData } = route.params || {};

  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [updating, setUpdating] = useState(false);
  // This screen stays mounted in the navigation stack, so returning to it
  // after a successful save would otherwise leave a stuck loading button
  // that is also disabled. Clearing on focus covers every exit path.
  useFocusEffect(
    React.useCallback(() => {
      setUpdating(false);
    }, [])
  );

  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    creativity: false,
    fan_favorites: false,
    food_and_drink: false,
    gaming: false,
    going_out: false,
    music: false,
    outdoors: false,
    social_and_content: false,
    sports_and_fitness: false,
    tv_and_movies: false,
    values_and_causes: false,
    wellness_and_lifestyle: false,
  });

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

  const selectedCategoriesCount = useMemo(() => {
    const categories = new Set();
    INTEREST_CATEGORIES.forEach(cat => {
      if (cat.interests.some(interest => selectedInterests.includes(interest.id))) {
        categories.add(cat.id);
      }
    });
    return categories.size;
  }, [selectedInterests]);

  const selectedInterestSet = useMemo(
    () => new Set(selectedInterests),
    [selectedInterests]
  );

  const toggleInterest = useCallback((interestId: string) => {
    setSelectedInterests((prev) => {
      if (prev.includes(interestId)) {
        return prev.filter((id) => id !== interestId);
      }

      // Find which category this interest belongs to
      const category = INTEREST_CATEGORIES.find(cat => 
        cat.interests.some(i => i.id === interestId)
      );

      if (!category) return prev;

      // Check if this category is already "active" (has at least one interest selected)
      const isCategoryActive = category.interests.some(i => prev.includes(i.id));

      // If category is already active, we can always add more interests to it
      if (isCategoryActive) {
        return [...prev, interestId];
      }

      // If it's a new category, check if we've reached the 10 category limit
      const activeCategoryCount = INTEREST_CATEGORIES.reduce((count, item) => (
        item.interests.some((interest) => prev.includes(interest.id)) ? count + 1 : count
      ), 0);

      if (activeCategoryCount < MAX_INTERESTS) {
        return [...prev, interestId];
      }

      return prev;
    });
  }, []);

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [categoryId]: !prev[categoryId],
    }));
  };

  const filteredCategories = useMemo(() => {
    if (!searchQuery) return INTEREST_CATEGORIES;
    const query = searchQuery.toLowerCase();
    return INTEREST_CATEGORIES.map((cat) => ({
      ...cat,
      interests: cat.interests.filter((interest) =>
        interest.label.toLowerCase().includes(query)
      ),
    })).filter((cat) => cat.interests.length > 0);
  }, [searchQuery]);

  const handleDone = async () => {
    if (selectedInterests.length === 0) return;

    setUpdating(true);
    try {
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
          interests: selectedInterests,
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

      /* 
      dispatch(
        setCredentials({
          user: { ...user, preferences: finalData.preferences },
          token,
        })
      );
      */

      // Navigate to the new ShareMore screen
      navigation.navigate("ShareMore", {
        ...route.params,
        user: { ...user, preferences: finalData.preferences },
        token,
        preferences: finalData.preferences
      });
    } catch (error) {
      console.error("Failed to save interests");
      setUpdating(false);
      alert("Failed to save settings. Please try again.");
    }
  };

  const handleSkip = () => {
    navigation.navigate("ShareMore", { ...route.params, user, token });
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      <View style={styles.headerNav}>
        <TouchableOpacity onPress={() => navigation.navigate("PersonalityTraits")}>
          <MaterialCommunityIcons name="arrow-left" size={28} color="#FFF" />
        </TouchableOpacity>
        <View />
      </View>

      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={[styles.mainContent, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.titleRow}>
            <Text style={styles.mainTitle}>Interests</Text>
            <Text style={styles.progressText}>{selectedCategoriesCount} of {MAX_INTERESTS}</Text>
          </View>
          <Text style={styles.subtitle}>Add up to {MAX_INTERESTS} interest categories to your profile. You can select multiple options within each category.</Text>

          <View style={styles.searchContainer}>
            <MaterialCommunityIcons name="magnify" size={20} color="rgba(255,255,255,0.4)" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search"
              placeholderTextColor="rgba(255,255,255,0.4)"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>

          {filteredCategories.map((category) => {
            const isExpanded = expandedCategories[category.id];
            const visibleInterests = isExpanded ? category.interests : category.interests.slice(0, 12);
            const hasMore = category.interests.length > 12;
            const selectedInCategory = category.interests.filter(i => selectedInterestSet.has(i.id)).length;

            return (
              <View key={category.id} style={styles.categorySection}>
                <View style={styles.categoryHeader}>
                  <Text style={styles.categoryEmoji}>{category.emoji}</Text>
                  <Text style={styles.categoryTitle}>{category.title}</Text>
                  {selectedInCategory > 0 && (
                    <View style={styles.categoryBadge}>
                      <Text style={styles.categoryBadgeText}>
                        {selectedInCategory}
                      </Text>
                    </View>
                  )}
                </View>
                
                <View style={styles.interestsContainer}>
                  {visibleInterests.map((interest) => (
                    <InterestPill
                      key={interest.id}
                      interest={interest}
                      selected={selectedInterestSet.has(interest.id)}
                      onToggle={toggleInterest}
                    />
                  ))}
                </View>

                {hasMore && !searchQuery && (
                   <TouchableOpacity 
                    style={styles.showMoreBtn} 
                    onPress={() => toggleCategory(category.id)}
                  >
                    <Text style={styles.showMoreText}>
                      {isExpanded ? "Show less" : "Show more"}
                    </Text>
                    <MaterialCommunityIcons 
                      name={isExpanded ? "chevron-up" : "chevron-down"} 
                      size={18} 
                      color="rgba(255,255,255,0.4)" 
                    />
                  </TouchableOpacity>
                )}
                <View style={styles.divider} />
              </View>
            );
          })}
        </Animated.View>
      </ScrollView>

      {/* Next Button Footer */}
      {selectedCategoriesCount > 0 && (
        <View style={styles.footer}>
          <TouchableOpacity 
            style={styles.nextButton} 
            onPress={handleDone}
            disabled={updating}
            activeOpacity={0.8}
          >
            <Text style={styles.nextButtonText}>
              {updating ? "Saving..." : `Next ${selectedCategoriesCount}/${MAX_INTERESTS}`}
            </Text>
          </TouchableOpacity>
        </View>
      )}
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
  doneText: {
    color: "#007AFF", // Blue color for Done
    fontSize: 17,
    fontWeight: "600",
  },
  disabledDone: {
    color: "rgba(0, 122, 255, 0.4)",
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 120, // Increased to account for floating footer
  },
  mainContent: {
    marginTop: 10,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 12,
  },
  mainTitle: {
    fontSize: 32,
    fontWeight: "800",
    color: "#FFF",
  },
  progressText: {
    fontSize: 16,
    color: "rgba(255,255,255,0.6)",
    fontWeight: "600",
    paddingBottom: 5,
  },
  subtitle: {
    fontSize: 15,
    color: "rgba(255,255,255,0.6)",
    lineHeight: 22,
    marginBottom: 24,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 15,
    marginBottom: 32,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    color: "#FFF",
    fontSize: 16,
    padding: 0,
  },
  categorySection: {
    marginBottom: 24,
  },
  categoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  categoryEmoji: {
    fontSize: 18,
    marginRight: 10,
  },
  categoryTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#FFF",
  },
  interestsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  interestPill: {
    height: 38,
    paddingHorizontal: 16,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    marginRight: 8,
    marginBottom: 10,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  interestPillSelected: {
    borderColor: "#F94E27",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  interestPillPressed: {
    borderColor: "#F94E27",
    backgroundColor: "rgba(249,78,39,0.18)",
    transform: [{ scale: 0.97 }],
  },
  interestLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    fontWeight: "600",
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  interestLabelSelected: {
    color: "#FFF",
  },
  showMoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    marginTop: 4,
  },
  showMoreText: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 14,
    fontWeight: "700",
    marginRight: 4,
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.05)",
    marginTop: 10,
  },
  categoryBadge: {
    backgroundColor: "#F94E27",
    width: 22,
    height: 22,
    borderRadius: 11,
    marginLeft: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryBadgeText: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "900",
    includeFontPadding: false,
    textAlign: "center",
    textAlignVertical: "center",
    lineHeight: 22,
    height: 22,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === "ios" ? 34 : 20,
    paddingTop: 10,
    backgroundColor: "#0F1115",
  },
  nextButton: {
    backgroundColor: "#FFF",
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  },
  nextButtonText: {
    color: "#0F1115",
    fontSize: 18,
    fontWeight: "700",
  },
});
