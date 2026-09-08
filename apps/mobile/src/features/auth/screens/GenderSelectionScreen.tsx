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
  Modal,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useDispatch } from "react-redux";
import { setCredentials } from "../../../store/authSlice";
import { api } from "../../../services/api";

const { width, height } = Dimensions.get("window");

export const GenderSelectionScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const { user, token, name, birthday, age } = route.params || {};

  const [gender, setGender] = useState<string | null>(null);
  const [showGender, setShowGender] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [specificGender, setSpecificGender] = useState<string | null>(null);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const expandAnim = useRef(new Animated.Value(0)).current;

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

  const handleNext = () => {
    if (!gender) return;
    const finalGender = specificGender || gender;
    navigation.navigate("CollegeSelection", {
      ...route.params,
      gender: finalGender,
      showGender
    });
  };

  const genderOptions = [
    { id: 'Man', label: 'Man' },
    { id: 'Woman', label: 'Woman' },
    { id: 'Beyond binary', label: 'Beyond binary' },
  ];

  const subGenderData: Record<string, { label: string; description: string }[]> = {
    'Man': [
      { label: 'Cis man', description: 'A man whose gender aligns with the sex they were assigned at birth.' },
      { label: 'Intersex man', description: "A man born with variations of sex characteristics that don't fit into the binary categorisation of male and female bodies" },
      { label: 'Trans man', description: 'A man who is transgender and whose gender is different from the sex assigned to them at birth.' },
      { label: 'Transmasculine', description: 'A person who was assigned female at birth, but presents as masculine and identifies with masculinity. This person may or may not see themselves as a man or a transgender man.' },
    ],
    'Woman': [
      { label: 'Cis woman', description: 'A woman whose gender aligns with the sex they were assigned at birth.' },
      { label: 'Intersex woman', description: "A woman born with variations of sex characteristics that don't fit into the binary categorisation of male and female bodies" },
      { label: 'Trans woman', description: 'A woman who is transgender and whose gender is different from the sex assigned to them at birth.' },
      { label: 'Transfeminine', description: 'A person who was assigned male at birth, but presents as feminine and identifies with femininity. This person may or may not see themselves as a woman or a transgender woman.' },
    ],
    'Beyond binary': [
      { label: 'Agender', description: 'A person who does not have a gender.' },
      { label: 'Bigender', description: 'A person who has two or more genders (can be simultaneously or fluid between them).' },
      { label: 'Gender fluid', description: 'A person who does not have a single fixed gender.' },
      { label: 'Gender questioning', description: 'A person who is questioning their current gender and/or exploring.' },
      { label: 'Genderqueer', description: 'A person who does not identify or express their gender within the gender binary.' },
      { label: 'Intersex', description: "An umbrella term that refers to people born with variations in sex characteristics that don't fit binary categorisation of male and female" },
      { label: 'Non-binary', description: 'A person whose gender is beyond the exclusive categories of man and woman.' },
      { label: 'Pangender', description: 'A person who experiences multiple genders either simultaneously or' },
      { label: 'Trans person', description: 'A person who is transgender and whose gender is different from the sex assigned to them at birth.' },
      { label: 'Transfeminine', description: 'A person who was assigned male at birth, but presents as feminine and identifies with femininity. This person may or may not see themselves as a woman or a transgender woman.' },
      { label: 'Transmasculine', description: 'A person who was assigned female at birth, but presents as masculine and identifies with masculinity. This person may or may not see themselves as a man or a transgender man.' },
      { label: 'Two-spirit', description: 'An umbrella term used by those belonging to US Native American and Canadian First Nations communities to honour the sacred role that people who are not exclusively cisgender and/or heterosexual hold.' },
    ]
  };

  const toggleExpand = () => {
    const toValue = expanded ? 0 : 1;
    setExpanded(!expanded);
    Animated.spring(expandAnim, {
      toValue,
      friction: 8,
      useNativeDriver: false,
    }).start();
  };

  useEffect(() => {
    // If gender changes, reset specific gender and close expansion
    setSpecificGender(null);
    if (expanded) {
      toggleExpand();
    }
  }, [gender]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      <KeyboardAvoidingView 
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <View style={styles.topHeader}>
          <TouchableOpacity onPress={() => navigation.navigate("BirthdaySelection")}>
            <MaterialCommunityIcons name="arrow-left" size={32} color="#FFF" />
          </TouchableOpacity>
        </View>

        <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.header}>
            <Text style={styles.title}>My gender</Text>
            <Text style={styles.subtitle}>
              Select all that describe you to help us show your profile to the right people. You can add more details if you'd like.
            </Text>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            style={styles.optionsContainer}
            contentContainerStyle={styles.optionsContent}
          >
            {genderOptions.map((option) => (
              <View key={option.id}>
                <TouchableOpacity
                  style={[
                    styles.genderOption,
                    gender === option.id && styles.genderOptionSelected
                  ]}
                  onPress={() => setGender(option.id)}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.primaryGenderText,
                    gender === option.id && styles.primaryGenderTextSelected
                  ]}>
                    {option.label}
                  </Text>
                  {gender === option.id && (
                    <MaterialCommunityIcons name="check" size={24} color="#F94E27" />
                  )}
                </TouchableOpacity>

                {gender === option.id && (
                  <View style={styles.subOnboardingContainer}>
                    <TouchableOpacity 
                      style={[styles.moreOptionsHeader, expanded && styles.moreOptionsExpanded]}
                      onPress={toggleExpand}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.moreOptionsText}>
                        Add more about your gender (optional)
                      </Text>
                      <Animated.View style={{ 
                        transform: [{ 
                          rotate: expandAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0deg', '180deg']
                          }) 
                        }] 
                      }}>
                        <MaterialCommunityIcons name="chevron-down" size={24} color="#FFF" />
                      </Animated.View>
                    </TouchableOpacity>

                    <Animated.View style={{
                      maxHeight: expandAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, 1200] // Large enough to cover Beyond binary content
                      }),
                      opacity: expandAnim,
                      overflow: 'hidden'
                    }}>
                      <ScrollView 
                        nestedScrollEnabled 
                        style={[styles.subOptionsList, { maxHeight: gender === 'Beyond binary' ? 500 : 400 }]}
                        contentContainerStyle={styles.subOptionsContent}
                        indicatorStyle="white"
                      >
                        {subGenderData[option.id]?.map((sub) => (
                          <TouchableOpacity
                            key={sub.label}
                            style={[
                              styles.subOptionCard,
                              specificGender === sub.label && styles.subOptionCardSelected
                            ]}
                            onPress={() => setSpecificGender(specificGender === sub.label ? null : sub.label)}
                          >
                            <Text style={[styles.subOptionLabel, specificGender === sub.label && styles.subOptionLabelSelected]}>
                              {sub.label}
                            </Text>
                            <Text style={styles.subOptionDescription}>
                              {sub.description}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </Animated.View>
                  </View>
                )}
              </View>
            ))}

          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity 
              style={styles.visibilityToggle}
              onPress={() => setShowGender(!showGender)}
              activeOpacity={0.7}
            >
              <Text style={styles.visibilityToggleText}>Show my gender on my profile</Text>
              <View style={[styles.checkbox, showGender && styles.checkboxSelected]}>
                {showGender && <MaterialCommunityIcons name="check" size={18} color="#FFF" />}
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.learnMore}>
              <Text style={styles.learnMoreText}>Learn how IEM Connect uses this info.</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.nextButton, (!gender || updating) && styles.disabledNextButton]}
              onPress={handleNext}
              disabled={!gender || updating}
              activeOpacity={0.8}
            >
              <Text style={styles.nextButtonText}>
                {updating ? "Saving..." : "Next"}
              </Text>
            </TouchableOpacity>
          </View>
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
    paddingBottom: Platform.OS === "ios" ? 20 : 0,
  },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 30,
    marginTop: 10,
  },
  doneButton: {
    color: '#00A3FF',
    fontSize: 18,
    fontWeight: '700',
  },
  disabledDone: {
    opacity: 0.5,
  },
  content: {
    flex: 1,
  },
  header: {
    marginBottom: 30,
  },
  title: {
    fontSize: 34,
    fontWeight: "800",
    color: "#FFF",
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 16,
    color: "rgba(255,255,255,0.6)",
    lineHeight: 24,
  },
  optionsContainer: {
    flex: 1,
  },
  optionsContent: {
    paddingBottom: 190,
  },
  genderOption: {
    height: 60,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.02)",
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  genderOptionSelected: {
    borderColor: "#F94E27",
  },
  primaryGenderText: {
    fontSize: 18,
    fontWeight: "700",
    color: "rgba(255,255,255,0.9)",
  },
  primaryGenderTextSelected: {
    color: "#FFF",
  },
  subOnboardingContainer: {
    backgroundColor: '#000',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  moreOptionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    paddingHorizontal: 10,
  },
  moreOptionsExpanded: {
    // any style for expanded header
  },
  moreOptionsText: {
    fontSize: 16,
    color: "#FFF",
    fontWeight: "600",
    flex: 1,
  },
  subOptionsList: {
    maxHeight: 400,
  },
  subOptionsContent: {
    paddingHorizontal: 8, // Spacing to avoid scrollbar overlapping border
    paddingBottom: 0,
  },
  subOptionCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    marginHorizontal: 2, // Slight margin to keep border clear
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  subOptionCardSelected: {
    borderColor: '#454D59',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  subOptionLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 6,
  },
  subOptionLabelSelected: {
    // label style when selected
  },
  subOptionDescription: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    lineHeight: 18,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: Platform.OS === 'ios' ? 0 : -16,
    paddingTop: 10,
    paddingBottom: 0,
    backgroundColor: '#0F1115',
  },
  visibilityToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    marginBottom: 10,
  },
  visibilityToggleText: {
    fontSize: 16,
    color: "#FFF",
    fontWeight: "600",
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.2)",
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#F94E27',
    borderColor: '#F94E27',
  },
  learnMore: {
    marginTop: 5,
    marginBottom: 10,
  },
  learnMoreText: {
    fontSize: 14,
    color: '#00A3FF',
    fontWeight: '600',
  },
  nextButton: {
    backgroundColor: '#FFF',
    width: '100%',
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
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
