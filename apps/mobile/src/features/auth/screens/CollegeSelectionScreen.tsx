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
  TextInput,
  ScrollView,
} from "react-native";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useDispatch, useSelector } from "react-redux";
import { setCredentials } from "../../../store/authSlice";
import { api } from "../../../services/api";
import { RootState } from "../../../store";

const { width } = Dimensions.get("window");

export const CollegeSelectionScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const auth = useSelector((state: RootState) => state.auth);
  const { ...profileData } = route.params || {};
  const user = route.params?.user || auth.user;
  const token = route.params?.token || auth.token;

  const [selectedCollege] = useState<string | null>(user?.college || null);
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

  const collegeOptions = selectedCollege ? [selectedCollege] : [];

  const handleNext = async () => {
    if (!selectedCollege) return;

    setUpdating(true);
    try {
      const allowedKeys = [
        'name', 'birthday', 'age', 'gender', 'showGender', 
        'orientation', 'showOrientation', 'distancePreference', 
        'seeking', 'department', 'year'
      ];
      
      const filteredData: any = {};
      Object.keys(profileData).forEach(key => {
        if (allowedKeys.includes(key)) {
          filteredData[key] = profileData[key];
        }
      });
      
      const finalData = filteredData;

      await api.put("/profile", finalData);

      // Navigate to academic selection
      navigation.navigate("AcademicSelection", {
        user: { ...user, ...finalData },
        token,
        ...finalData
      });
    } catch (error: any) {
      if (error.response) {
      }
      setUpdating(false);
      alert("Failed to save settings. Please try again.");
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      <KeyboardAvoidingView 
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <View style={styles.topHeader}>
          <TouchableOpacity onPress={() => navigation.navigate("GenderSelection")}>
            <MaterialCommunityIcons name="arrow-left" size={32} color="#FFF" />
          </TouchableOpacity>
        </View>

        <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.header}>
            <Text style={styles.title}>If studying is your thing...</Text>
            <Text style={styles.infoText}>This is how it’ll appear on your profile.</Text>
          </View>

          <View style={styles.listContainer}>
            {collegeOptions.map((college) => (
              <TouchableOpacity
                key={college}
                style={[
                  styles.collegeItem,
                  selectedCollege === college && styles.collegeItemSelected
                ]}
                onPress={() => undefined}
                activeOpacity={0.7}
              >
                <Text style={[
                  styles.collegeText,
                  selectedCollege === college && styles.collegeTextSelected
                ]}>
                  {college}
                </Text>
                <View style={[styles.radioButton, selectedCollege === college && styles.radioButtonSelected]}>
                  {selectedCollege === college && <View style={styles.radioInner} />}
                </View>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.footer}>
            <TouchableOpacity 
              style={[styles.nextButton, (!selectedCollege || updating) && styles.disabledNextButton]}
              onPress={handleNext}
              disabled={!selectedCollege || updating}
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
    marginBottom: 30,
  },
  title: {
    fontSize: 34,
    fontWeight: "800",
    color: "#FFF",
    marginBottom: 8,
  },
  infoText: {
    fontSize: 16,
    color: "rgba(255,255,255,0.6)",
    marginBottom: 20,
  },
  listContainer: {
    flex: 1,
  },
  collegeItem: {
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  collegeItemSelected: {
    // optional selected style
  },
  collegeText: {
    fontSize: 16,
    color: "#FFF",
    flex: 1,
    marginRight: 10,
  },
  collegeTextSelected: {
    color: "#FFF",
    fontWeight: "700",
  },
  radioButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioButtonSelected: {
    borderColor: '#F94E27',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#F94E27',
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
