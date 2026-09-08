import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  StatusBar,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Dimensions,
  Keyboard,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

const { width, height } = Dimensions.get("window");

export const NameSelectionScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user, token } = route.params || {};

  const [name, setName] = useState(user?.name?.startsWith("User_") ? "" : user?.name || "");
  const [showModal, setShowModal] = useState(false);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const modalScale = useRef(new Animated.Value(0.8)).current;
  const modalOpacity = useRef(new Animated.Value(0)).current;
  const buttonKeyboardOffset = useRef(new Animated.Value(0)).current;
  const initialWindowHeight = useRef(Dimensions.get("window").height);

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
        ? Math.max(0, event.endCoordinates.height - resizedHeight) + 12
        : 0;

      Animated.timing(buttonKeyboardOffset, {
        toValue: -requiredLift,
        duration: event.duration || 180,
        useNativeDriver: true,
      }).start();
    });

    const hideSubscription = Keyboard.addListener(hideEvent, (event) => {
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

  const handleNext = () => {
    if (name.trim().length < 2) return;
    Keyboard.dismiss();
    setShowModal(true);
    Animated.parallel([
      Animated.spring(modalScale, {
        toValue: 1,
        friction: 8,
        useNativeDriver: true,
      }),
      Animated.timing(modalOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  };
  const handleConfirm = () => {
    setShowModal(false);
    navigation.navigate("BirthdaySelection", { 
      user, 
      token, 
      name: name.trim() 
    });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      <KeyboardAvoidingView 
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardView}
        keyboardVerticalOffset={Platform.OS === 'ios' ? -20 : undefined}
      >
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.navigate("HouseRules")}
        >
          <MaterialCommunityIcons name="arrow-left" size={32} color="#FFF" />
        </TouchableOpacity>

        <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <Text style={styles.title}>What's your first name?</Text>
          
          <TextInput
            style={styles.input}
            placeholder="Enter your name"
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={name}
            onChangeText={setName}
            autoFocus
            selectionColor="#FFF"
          />
          
          <Text style={styles.note}>
            This is how it will appear on IEM Connect and you will not be able to change it.
          </Text>
        </Animated.View>

        <Animated.View
          style={[
            styles.nextButtonLift,
            { transform: [{ translateY: buttonKeyboardOffset }] },
          ]}
        >
          <TouchableOpacity
            style={[styles.nextButton, name.trim().length < 2 && styles.disabledButton]}
            onPress={handleNext}
            disabled={name.trim().length < 2}
          >
            <Text style={styles.nextButtonText}>Next</Text>
          </TouchableOpacity>
        </Animated.View>
      </KeyboardAvoidingView>

      <Modal transparent visible={showModal} animationType="none">
        <View style={styles.modalOverlay}>
          <Animated.View style={[styles.modalContent, { opacity: modalOpacity, transform: [{ scale: modalScale }] }]}>
            <Text style={styles.handEmoji}>👋</Text>
            <Text style={styles.modalTitle}>Welcome, {name}!</Text>
            <Text style={styles.modalSubtitle}>
              There's a lot to discover out there. But let's get your profile set up first.
            </Text>

            <TouchableOpacity 
              style={styles.modalPrimaryButton}
              onPress={handleConfirm}
            >
              <Text style={styles.modalPrimaryText}>
                Let's go
              </Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.modalSecondaryButton}
              onPress={() => setShowModal(false)}
            >
              <Text style={styles.modalSecondaryText}>Edit name</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  keyboardView: {
    flex: 1,
    paddingHorizontal: 32,
    paddingTop: Platform.OS === "ios" ? 60 : 40,
    paddingBottom: 20,
  },
  backButton: {
    marginBottom: 40,
    marginLeft: -8,
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 42,
    fontWeight: "800",
    color: "#FFF",
    lineHeight: 50,
    marginBottom: 40,
  },
  input: {
    fontSize: 32,
    color: "#FFF",
    fontWeight: "600",
    borderBottomWidth: 2,
    borderBottomColor: "rgba(255,255,255,0.5)",
    paddingVertical: 10,
    marginBottom: 12,
  },
  note: {
    fontSize: 14,
    color: "rgba(255,255,255,0.4)",
    fontWeight: "500",
  },
  nextButtonLift: {
    width: "100%",
  },
  nextButton: {
    backgroundColor: "#FFF",
    width: "100%",
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  disabledButton: {
    opacity: 0.5,
  },
  nextButtonText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#000",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  modalContent: {
    backgroundColor: "#1C1C1E",
    width: "100%",
    borderRadius: 24,
    padding: 30,
    alignItems: "center",
  },
  handEmoji: {
    fontSize: 50,
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FFF",
    textAlign: "center",
    marginBottom: 10,
  },
  modalSubtitle: {
    fontSize: 16,
    color: "rgba(255,255,255,0.6)",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 30,
  },
  modalPrimaryButton: {
    backgroundColor: "#FFF",
    width: "100%",
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: "center",
    marginBottom: 15,
  },
  modalPrimaryText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#000",
  },
  modalSecondaryButton: {
    paddingVertical: 10,
  },
  modalSecondaryText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFF",
  },
});
