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

const { width } = Dimensions.get("window");

export const BatchSelectionScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user, token, ...profileData } = route.params || {};

  const [selectedBatch, setSelectedBatch] = useState<number | null>(null);

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

  // Generate a range of years: from 2020 to 2032
  const batchOptions = Array.from({ length: 13 }, (_, i) => 2020 + i);

  const handleNext = () => {
    if (!selectedBatch) return;
    
    navigation.navigate("CampusSelection", {
      ...route.params,
      graduationYear: selectedBatch,
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
          <TouchableOpacity onPress={() => navigation.navigate("AcademicSelection")}>
            <MaterialCommunityIcons name="arrow-left" size={32} color="#FFF" />
          </TouchableOpacity>
        </View>

        <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.header}>
            <Text style={styles.title}>Which batch?</Text>
            <Text style={styles.subtitle}>
              Knowing your batch helps us match you with people in a similar phase of their college journey.
            </Text>
          </View>

          <ScrollView 
            style={{ flex: 1 }} 
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 20 }}
          >
            <View style={styles.gridContainer}>
              {batchOptions.map((year) => (
                <TouchableOpacity
                  key={year}
                  style={[
                    styles.batchItem,
                    selectedBatch === year && styles.batchItemSelected
                  ]}
                  onPress={() => setSelectedBatch(year)}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.batchText,
                    selectedBatch === year && styles.batchTextSelected
                  ]}>
                    {year}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity 
              style={[styles.nextButton, !selectedBatch && styles.disabledNextButton]}
              onPress={handleNext}
              disabled={!selectedBatch}
              activeOpacity={0.8}
            >
              <Text style={styles.nextButtonText}>Next</Text>
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
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: "rgba(255,255,255,0.6)",
    lineHeight: 24,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingTop: 10,
  },
  batchItem: {
    width: (width - 60) / 3,
    aspectRatio: 1.5,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.02)",
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
  },
  batchItemSelected: {
    borderColor: "#F94E27",
    backgroundColor: "rgba(249, 78, 39, 0.1)",
  },
  batchText: {
    fontSize: 20,
    fontWeight: "700",
    color: "rgba(255,255,255,0.8)",
  },
  batchTextSelected: {
    color: "#FFF",
  },
  footer: {
    marginTop: 'auto',
    paddingVertical: 15,
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
