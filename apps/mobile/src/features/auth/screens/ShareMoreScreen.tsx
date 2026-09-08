import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Animated,
  TextInput,
  SafeAreaView,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  Dimensions,
  Keyboard,
} from "react-native";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useDispatch } from "react-redux";
import { setCredentials, updateUser } from "../../../store/authSlice";
import { api } from "../../../services/api";

export const ShareMoreScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const { user, token } = route.params || {};

  const [bio, setBio] = useState("");
  const [updating, setUpdating] = useState(false);
  const [isBioActive, setIsBioActive] = useState(false);
  const [keyboardContentInset, setKeyboardContentInset] = useState(0);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const buttonKeyboardOffset = useRef(new Animated.Value(0)).current;
  const initialWindowHeight = useRef(Dimensions.get("window").height);
  const scrollViewRef = useRef<any>(null);
  const scrollOffsetY = useRef(0);
  const bioContentHeight = useRef(0);
  const hasBioContent = useRef(false);
  const bioCardY = useRef(0);
  const footerRef = useRef<any>(null);
  const keyboardTop = useRef(0);
  const bioValue = useRef("");
  const cursorPosition = useRef(0);

  // Collapsing header: the large title fades into the nav bar once it
  // scrolls behind it, and returns when scrolled back up.
  const headerTitleAnim = useRef(new Animated.Value(0)).current;
  const titleBottom = useRef(0);
  const headerTitleShown = useRef(false);

  const syncHeaderTitle = (offsetY: number) => {
    if (!titleBottom.current) return;
    // Only once the large title has scrolled completely out of view.
    const shouldShow = offsetY > titleBottom.current;
    if (shouldShow === headerTitleShown.current) return;

    headerTitleShown.current = shouldShow;
    Animated.timing(headerTitleAnim, {
      toValue: shouldShow ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  };

  const bioInputRef = useRef<TextInput>(null);
  const bioInputWidth = useRef(0);

  const BIO_LINE_HEIGHT = 24;
  const BIO_FONT_SIZE = 16;

  // Approximate wrapped-line count up to the caret. Chars-per-line comes from
  // the measured input width instead of a hard-coded guess, so the estimate
  // holds across screen sizes.
  const getVisualLine = (value: string, position: number) => {
    const charsPerLine = bioInputWidth.current
      ? Math.max(1, Math.floor(bioInputWidth.current / (BIO_FONT_SIZE * 0.5)))
      : 30;
    const textBeforeCursor = value.slice(0, position);
    return textBeforeCursor.split("\n").reduce(
      (lineCount, line) => lineCount + Math.max(1, Math.ceil(line.length / charsPerLine)),
      0
    );
  };

  // Scrolls so the caret sits above the keyboard. Everything is measured in
  // window coordinates at call time, so it does not depend on the footer
  // animation having settled.
  const scrollCaretIntoView = (keyboardScreenY: number) => {
    if (!keyboardScreenY) return;

    bioInputRef.current?.measureInWindow((_x: number, inputY: number) => {
      const cursorLine = getVisualLine(bioValue.current, cursorPosition.current);
      const caretBottom = inputY + (cursorLine + 1) * BIO_LINE_HEIGHT;

      const applyDelta = (safeBottom: number) => {
        const delta = caretBottom - safeBottom;
        if (delta > 1) {
          scrollViewRef.current?.scrollTo({
            y: scrollOffsetY.current + delta,
            animated: true,
          });
        }
      };

      if (footerRef.current) {
        footerRef.current.measureInWindow((_fx: number, footerY: number) => {
          // Keep the caret clear of the Done button when it is showing.
          applyDelta((footerY > 0 ? Math.min(footerY, keyboardScreenY) : keyboardScreenY) - 12);
        });
      } else {
        applyDelta(keyboardScreenY - 12);
      }
    });
  };

  const scrollBioIntoView = (preserveCurrentOffset: boolean) => {
    if (!keyboardTop.current) return;

    scrollViewRef.current?.measureInWindow((_x: number, scrollViewY: number) => {
      footerRef.current?.measureInWindow((_footerX: number, footerY: number) => {
        const visibleBottom = footerY - scrollViewY - 12;
        const cursorLine = getVisualLine(bioValue.current, cursorPosition.current);
        const textBottom = bioCardY.current + 54 + cursorLine * BIO_LINE_HEIGHT + BIO_LINE_HEIGHT;
        const minimumOffset = Math.max(0, textBottom - visibleBottom);
        const nextOffset = preserveCurrentOffset
          ? Math.max(scrollOffsetY.current, minimumOffset)
          : minimumOffset;

        scrollViewRef.current?.scrollTo({ y: nextOffset, animated: true });
      });
    });
  };

  // The screen stays mounted in the navigation stack, so navigating away
  // mid-save and coming back would otherwise show a stuck "Saving..."
  // button. Clearing on focus covers every exit path.
  useFocusEffect(
    React.useCallback(() => {
      setUpdating(false);
    }, [])
  );

  useEffect(() => {
    bioValue.current = bio;
  }, [bio]);

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
      keyboardTop.current = event.endCoordinates.screenY;
      const resizedHeight = Math.max(
        0,
        initialWindowHeight.current - Dimensions.get("window").height
      );
      const requiredLift = Platform.OS === "android"
        ? Math.max(0, event.endCoordinates.height - resizedHeight)
        : 0;

      setKeyboardContentInset(requiredLift + 120);

      Animated.timing(buttonKeyboardOffset, {
        toValue: -requiredLift,
        duration: event.duration || 180,
        useNativeDriver: true,
      }).start();

      // Run after the keyboard animation so measureInWindow reports the
      // settled layout, not a mid-flight position.
      setTimeout(() => {
        scrollCaretIntoView(event.endCoordinates.screenY);
      }, (event.duration || 180) + 60);
    });

    const hideSubscription = Keyboard.addListener(hideEvent, (event) => {
      keyboardTop.current = 0;
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

  const handleSave = async () => {
    if (!bio.trim()) return;

    setUpdating(true);
    try {
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
          ...user?.preferences,
          bio: bio.trim(),
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
      navigation.navigate("FaceVerificationInfo");

      // RootNavigator will automatically switch to Main stack
    } catch (error) {
      console.error("Failed to save bio:", error);
      alert("Failed to save. Please try again.");
    } finally {
      setUpdating(false);
    }
  };

  const handleBioChange = (nextBio: string) => {
    const previous = bioValue.current;
    const addedOneChar = nextBio.length === previous.length + 1;

    // A typed Enter is ignored outright, so it costs no character and the
    // card cannot be grown with empty breaks. Pasted multi-line text still
    // collapses to spaces so words do not run together.
    const singleLine = addedOneChar
      ? nextBio.replace(new RegExp('[\\r\\n]', "g"), "")
      : nextBio.replace(new RegExp('[\\r\\n]' + "+", "g"), " ");

    hasBioContent.current = singleLine.length > 0;
    bioValue.current = singleLine;
    setBio(singleLine);
  };

  const handleBioContentSizeChange = (nextHeight: number) => {
    const previousHeight = bioContentHeight.current;
    bioContentHeight.current = nextHeight;

    if (previousHeight > 0 && nextHeight > previousHeight) {
      setTimeout(() => {
        scrollBioIntoView(true);
      }, 32);
    }
  };

  const handleSkip = async () => {
    setUpdating(true);
    try {
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

      const hasUpdate = [campus, isHosteller, clubs, attendanceMood, hangoutSpots, orientation, showOrientation, distancePreference, seeking, department, degree, graduationYear, yearOfStudy].some(val => val !== undefined);

      if (hasUpdate) {
        const finalData: any = {};
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
      }
    } catch (error) {
      console.error("Failed to save skipped profile items:", error);
    } finally {
      navigation.navigate("FaceVerificationInfo");
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView 
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
          <View style={{ flex: 1 }}>
            <View style={styles.headerNav}>
              <TouchableOpacity onPress={() => navigation.navigate("Interests")}>
                <MaterialCommunityIcons name="arrow-left" size={28} color="#FFF" />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSkip}>
                <Text style={styles.skipText}>Skip</Text>
              </TouchableOpacity>

              <Animated.Text
                pointerEvents="none"
                numberOfLines={1}
                style={[
                  styles.headerTitle,
                  {
                    opacity: headerTitleAnim,
                    transform: [
                      {
                        translateY: headerTitleAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [10, 0],
                        }),
                      },
                    ],
                  },
                ]}
              >
                Share more about yourself
              </Animated.Text>
            </View>

            <ScrollView 
              ref={scrollViewRef}
              style={styles.content}
              contentContainerStyle={[
                styles.contentContainer,
                { paddingBottom: 100 + keyboardContentInset },
              ]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={(event) => {
                scrollOffsetY.current = event.nativeEvent.contentOffset.y;
                syncHeaderTitle(scrollOffsetY.current);
              }}
            >
              <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
                <Text
                  style={styles.title}
                  onLayout={(event) => {
                    const { y, height } = event.nativeEvent.layout;
                    titleBottom.current = y + height;
                  }}
                >
                  Share more about yourself
                </Text>
                <Text style={styles.subtitle}>
                  Write a bio to help your profile stand out.
                </Text>

                <TouchableOpacity 
                  activeOpacity={0.9}
                  onPress={() => bioInputRef.current?.focus()}
                  onLayout={(event) => {
                    bioCardY.current = event.nativeEvent.layout.y;
                  }}
                  style={[
                    styles.bioCard,
                    isBioActive && styles.bioCardActive,
                    bio.length > 0 && styles.bioCardFilled
                  ]}
                >
                  <View style={styles.bioHeader}>
                    <Text style={styles.bioTitle}>About me</Text>
                    {!isBioActive && !bio && (
                      <View style={styles.plusCircle}>
                        <MaterialCommunityIcons name="plus" size={24} color="#000" />
                      </View>
                    )}
                  </View>
                  
                  <TextInput
                    ref={bioInputRef}
                    multiline
                    style={styles.bioInput}
                    placeholder="Introduce yourself and stand out."
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    value={bio}
                    onChangeText={handleBioChange}
                    returnKeyType="done"
                    submitBehavior="blurAndSubmit"
                    onLayout={(event) => {
                      bioInputWidth.current = event.nativeEvent.layout.width;
                    }}
                    onContentSizeChange={(event) => {
                      handleBioContentSizeChange(event.nativeEvent.contentSize.height);
                    }}
                    onSelectionChange={(event) => {
                      cursorPosition.current = event.nativeEvent.selection.start;

                      if (keyboardTop.current) {
                        setTimeout(() => {
                          scrollCaretIntoView(keyboardTop.current);
                        }, 32);
                      }
                    }}
                    onFocus={() => {
                      setIsBioActive(true);
                      // If the keyboard is already open no keyboardDidShow
                      // fires, so handle that case here. When it is closed,
                      // keyboardDidShow drives the scroll instead.
                      if (keyboardTop.current) {
                        setTimeout(() => {
                          scrollCaretIntoView(keyboardTop.current);
                        }, 60);
                      }
                    }}
                    onBlur={() => setIsBioActive(false)}
                    maxLength={500}
                  />
                </TouchableOpacity>
              </Animated.View>
            </ScrollView>

            {bio.trim().length > 0 && (
              <Animated.View
                ref={footerRef}
                style={[
                  styles.footer,
                  { transform: [{ translateY: buttonKeyboardOffset }] },
                ]}
              >
                <TouchableOpacity 
                  style={styles.nextButton} 
                  onPress={handleSave}
                  disabled={updating}
                >
                  <Text style={styles.nextButtonText}>
                    {updating ? "Saving..." : "Done"}
                  </Text>
                </TouchableOpacity>
              </Animated.View>
            )}
          </View>
      </KeyboardAvoidingView>
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
  headerTitle: {
    position: "absolute",
    left: 64,
    right: 64,
    bottom: Platform.OS === "ios" ? 10 : 14,
    textAlign: "center",
    color: "#FFF",
    fontSize: 17,
    fontWeight: "700",
  },
  skipText: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 17,
    fontWeight: "700",
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  title: {
    fontSize: 40,
    fontWeight: "800",
    color: "#FFF",
    lineHeight: 48,
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 16,
    color: "rgba(255,255,255,0.6)",
    lineHeight: 24,
    marginBottom: 24,
  },
  bioCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.7)",
    borderStyle: "dotted",
    minHeight: 120,
    marginTop: 4,
  },
  bioCardActive: {
    borderStyle: "solid",
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  bioCardFilled: {
    borderStyle: "solid",
    borderColor: "rgba(255,255,255,0.15)",
  },
  bioHeader: {
    marginBottom: 8,
  },
  bioTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#FFF",
    marginBottom: 4,
  },
  plusCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
    position: "absolute",
    right: 0,
    top: 0,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 3,
    elevation: 5,
  },
  bioInput: {
    fontSize: 16,
    color: "#FFF",
    lineHeight: 24,
    paddingTop: 0,
    minHeight: 40,
    textAlignVertical: "top",
  },
  bioPreview: {
    fontSize: 15,
    color: "rgba(255,255,255,0.6)",
    lineHeight: 22,
  },
  bioPreviewActive: {
    color: "#FFF",
  },
  footer: {
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === "ios" ? 34 : 30,
    paddingTop: 14,
    backgroundColor: "#17191F",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  nextButton: {
    backgroundColor: "#FFF",
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  nextButtonText: {
    color: "#0F1115",
    fontSize: 18,
    fontWeight: "700",
  },
});
