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
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { useDispatch } from "react-redux";
import { setCredentials } from "../../../store/authSlice";
import { api } from "../../../services/api";

const { width } = Dimensions.get("window");

export const DistancePreferenceScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const { user, token, ...profileData } = route.params || {};

  const [distance, setDistance] = useState(100);
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

  const handleNext = () => {
    navigation.navigate("SeekingSelection", {
      ...route.params,
      distancePreference: distance
    });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      <KeyboardAvoidingView 
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <View style={styles.topHeader}>
          <TouchableOpacity onPress={() => navigation.navigate("OrientationSelection")}>
            <MaterialCommunityIcons name="arrow-left" size={32} color="#FFF" />
          </TouchableOpacity>
        </View>

        <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.header}>
            <Text style={styles.title}>Your distance preference?</Text>
            <Text style={styles.subtitle}>
              Use the slider to set the maximum distance you would like potential matches to be located.
            </Text>
          </View>

          <View style={styles.sliderContainer}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>Distance preference</Text>
              <Text style={styles.distanceValue}>{distance} km</Text>
            </View>
            
            <Slider
              style={styles.slider}
              minimumValue={1}
              maximumValue={100}
              step={1}
              value={distance}
              onValueChange={setDistance}
              minimumTrackTintColor="#F94E27"
              maximumTrackTintColor="rgba(255,255,255,0.1)"
              thumbTintColor="#F94E27"
            />
          </View>

          <View style={styles.infoContainer}>
            <Text style={styles.infoText}>You can change preferences later in Settings</Text>
          </View>

          <View style={styles.footer}>
            <TouchableOpacity 
              style={[styles.nextButton, updating && styles.disabledNextButton]}
              onPress={handleNext}
              disabled={updating}
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
    paddingBottom: 20,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 30,
    marginTop: 10,
  },
  content: {
    flex: 1,
  },
  header: {
    marginBottom: 40,
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
  sliderContainer: {
    marginBottom: 30,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  sliderLabel: {
    fontSize: 18,
    color: "#FFF",
    fontWeight: "600",
  },
  distanceValue: {
    fontSize: 16,
    color: "rgba(255,255,255,0.6)",
    fontWeight: "600",
  },
  slider: {
    width: '100%',
    height: 40,
  },
  infoContainer: {
    alignItems: 'center',
    marginTop: 20,
  },
  infoText: {
    fontSize: 16,
    color: "rgba(255,255,255,0.4)",
    textAlign: 'center',
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    width: '100%',
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
