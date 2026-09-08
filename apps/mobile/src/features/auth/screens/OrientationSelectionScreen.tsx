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
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useDispatch } from "react-redux";
import { setCredentials } from "../../../store/authSlice";
import { api } from "../../../services/api";

const { width } = Dimensions.get("window");

export const OrientationSelectionScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const { user, token, name, birthday, age, gender, showGender } = route.params || {};

  const [selectedOrientations, setSelectedOrientations] = useState<string[]>([]);
  const [showOrientation, setShowOrientation] = useState(true);
  const [updating, setUpdating] = useState(false);
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

  const orientationOptions = [
    { id: 'Straight', label: 'Straight', description: 'A person who is exclusively attracted to members of the opposite gender' },
    { id: 'Gay', label: 'Gay', description: 'An umbrella term used to describe someone who is attracted to members of their gender' },
    { id: 'Lesbian', label: 'Lesbian', description: 'A woman who is emotionally, romantically, or sexually attracted to other women and non-binary people' },
    { id: 'Bisexual', label: 'Bisexual', description: 'A person who has potential for emotional, romantic or sexual attraction to people of more than one gender' },
    { id: 'Asexual', label: 'Asexual', description: 'A person who may not experience sexual attraction or may experience a limited amount of sexual desire. May still experience romantic attraction or desire' },
    { id: 'Demisexual', label: 'Demisexual', description: 'A person who does not experience sexual attraction unless they form a strong emotional connection. May still experience romantic attraction or desire' },
    { id: 'Pansexual', label: 'Pansexual', description: 'A person who has potential for emotional, romantic or sexual attraction to people regardless of gender' },
    { id: 'Queer', label: 'Queer', description: 'An umbrella term used to express a spectrum of sexual orientations and genders often used to include those who do not identify as exclusively heterosexual' },
    { id: 'Bicurious', label: 'Bicurious', description: '' },
    { id: 'Aromantic', label: 'Aromantic', description: 'A person who does not experience romantic attraction, although they may still experience sexual attraction' },
  ];

  const toggleOrientation = (id: string) => {
    if (selectedOrientations.includes(id)) {
      setSelectedOrientations(selectedOrientations.filter(item => item !== id));
    } else {
      if (selectedOrientations.length < 3) {
        setSelectedOrientations([...selectedOrientations, id]);
      } else {
        alert("You can select up to 3 orientations.");
      }
    }
  };

  const handleNext = () => {
    navigation.navigate("DistancePreference", {
      ...route.params,
      orientation: selectedOrientations,
      showOrientation
    });
  };

  const handleSkip = () => {
    // Optionally save default empty orientation or just proceed
    handleNext();
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      <KeyboardAvoidingView 
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <View style={styles.topHeader}>
          <TouchableOpacity onPress={() => navigation.navigate("SocialSelection")}>
            <MaterialCommunityIcons name="arrow-left" size={32} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSkip}>
            <Text style={styles.skipButton}>Skip</Text>
          </TouchableOpacity>
        </View>

        <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.header}>
            <Text style={styles.title}>What's your sexual orientation?</Text>
            <Text style={styles.subtitle}>
              Select all that describe you to reflect your identity.
            </Text>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            style={styles.optionsContainer}
            contentContainerStyle={styles.optionsContent}
          >
            {orientationOptions.map((option) => (
              <TouchableOpacity
                key={option.id}
                style={[
                  styles.optionCard,
                  selectedOrientations.includes(option.id) && styles.optionCardSelected
                ]}
                onPress={() => toggleOrientation(option.id)}
                activeOpacity={0.7}
              >
                <View style={styles.optionHeader}>
                  <Text style={[
                    styles.optionLabel,
                    selectedOrientations.includes(option.id) && styles.optionLabelSelected
                  ]}>
                    {option.label}
                  </Text>
                  {selectedOrientations.includes(option.id) && (
                    <MaterialCommunityIcons name="check" size={24} color="#F94E27" />
                  )}
                </View>
                {option.description ? (
                  <Text style={styles.optionDescription}>
                    {option.description}
                  </Text>
                ) : null}
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity 
              style={styles.visibilityToggle}
              onPress={() => setShowOrientation(!showOrientation)}
              activeOpacity={0.7}
            >
              <View style={styles.visibilityLabelContainer}>
                <View style={[styles.checkbox, showOrientation && styles.checkboxSelected]}>
                  {showOrientation && <MaterialCommunityIcons name="check" size={18} color="#FFF" />}
                </View>
                <Text style={styles.visibilityToggleText}>Show sexual orientation on profile</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.nextButton, (selectedOrientations.length === 0 || updating) && styles.disabledNextButton]}
              onPress={handleNext}
              disabled={selectedOrientations.length === 0 || updating}
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
  skipButton: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 18,
    fontWeight: '700',
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
  optionCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  optionCardSelected: {
    borderColor: '#F94E27',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  optionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  optionLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFF',
  },
  optionLabelSelected: {
    color: '#FFF',
  },
  optionDescription: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    lineHeight: 20,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 0 : 20,
    backgroundColor: '#0F1115',
  },
  visibilityToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    marginBottom: 10,
  },
  visibilityLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  visibilityToggleText: {
    fontSize: 16,
    color: "#FFF",
    fontWeight: "600",
    marginLeft: 12,
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
