import type { RootState } from '../../store';
import { completeProfileUpload, explicitUploadMessage, precheckPhoto, tellBeingChecked } from '../../features/safety/mediaCheck';
import { FaceMediaNote, useFaceMediaIssues } from '../../features/verification/RealPerson';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
  Dimensions,
  Modal,
  Animated,
  Platform,
  InteractionManager,
  BackHandler,
  StatusBar,
  type LayoutChangeEvent,
} from 'react-native';

// Animations and gestures for the media action sheet.
import Reanimated, { Easing, useSharedValue, useAnimatedStyle, runOnJS, withSpring, withTiming } from 'react-native-reanimated';
import { GestureDetector, Gesture, GestureHandlerRootView, Pressable as GesturePressable, ScrollView as GestureScrollView } from 'react-native-gesture-handler';

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useDispatch, useSelector } from 'react-redux';
import { api } from '../../services/api';
import { updateUser } from '../../store/authSlice';
import { colors } from '../../core/theme/colors';
import { EditTapChoice, editColors } from '../../components/ProfileEditDesign';
import { CAMPUS_ICONS } from '../../core/profile/campusIcons';
import { ProfileFieldIcon } from '../../components/ProfileFieldIcon';
import { ABOUT_ME_ICONS } from '../../core/profile/aboutMeIcons';
import { photoExtFromAsset } from '../../utils/mediaFileExt';
import { useNavigation, useRoute, useFocusEffect, usePreventRemove, type NavigationAction } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SettingsToggle, settingsPalette as palette } from '../../core/settings/SettingsLayout';
import { AvatarCropModal } from './profile/AvatarCropModal';
import { PhotoCropModal } from './profile/PhotoCropModal';
import { PhotoDiscardDialog } from './profile/PhotoDiscardDialog';
import { ProfileVideoSection } from './profile/ProfileVideoSection';
import { PhotoReorderGrid } from './profile/PhotoReorderGrid';
import type { ProfileEditorSection } from './profile/profileEditNavigation';
import {studiesSummary} from './edit/studiesModel';
import {afterScreenTransition} from '../../features/auth/onboarding/afterScreenTransition';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Resting offset for the media sheet while closed. Deliberately taller than the
// sheet can be, and shared with the stylesheet so the very first frame after
// mount is already off-screen.
const SHEET_CLOSED_OFFSET = 420;
const width = SCREEN_WIDTH;


// ─── List Row (Option D) ───────────────────────────────────────────
const ListRow = ({
  icon, label, value, onPress, locked = false, isLast = false, iconFamily = 'Ionicons',
}: {
  icon: string; label: string; value: string; onPress?: () => void; locked?: boolean; isLast?: boolean; iconFamily?: 'Ionicons' | 'MaterialCommunityIcons';
}) => (
  <EditTapChoice
    accessibilityRole={onPress ? 'button' : 'text'}
    accessibilityLabel={`${label}, ${value || 'Not added'}${locked ? ', locked' : ''}`}
    style={[styles.listRow, !isLast && styles.listRowBorder]}
    onPress={onPress}
    activeOpacity={onPress ? 0.6 : 1}
    disabled={!onPress}
  >
    <View style={styles.listRowIconContainer}>
      {iconFamily === 'Ionicons' ? (
        <ProfileFieldIcon name={icon} size={19} color="#FFB8C7" />
      ) : (
        <MaterialCommunityIcons name={icon as any} size={19} color="#FFB8C7" />
      )}
    </View>
    <View style={styles.listRowContent}>
      <Text style={styles.listRowLabel}>{label}</Text>
      <Text style={[styles.listRowValue, !value && styles.listRowValueEmpty]} numberOfLines={2}>
        {value || `Add ${label.toLowerCase()}`}
      </Text>
    </View>
    <View style={styles.listRowRight}>
      {locked ? (
        <Ionicons name="lock-closed-outline" size={15} color={palette.muted} />
      ) : onPress ? (
        <Ionicons name="chevron-forward" size={17} color={palette.muted} />
      ) : null}
    </View>
  </EditTapChoice>
);


// ─── List Toggle Row ───────────────────────────────────────────────
const ListToggleRow = ({
  icon, label, value, onToggle, saving, isLast = false,
}: {
  icon: string; label: string; value: boolean; onToggle: (val: boolean) => void; saving?: boolean; isLast?: boolean;
}) => (
  <View style={[styles.listRow, !isLast && styles.listRowBorder]}>
    <View style={styles.listRowIconContainer}>
      <Ionicons name={icon as any} size={19} color="#FFB8C7" />
    </View>
    <View style={styles.listRowContent}>
      <Text style={[styles.listRowValue, { marginTop: 0 }]}>{label}</Text>
    </View>
    <View pointerEvents={saving ? 'none' : 'auto'}>
      <SettingsToggle label={label} value={value} onChange={onToggle} />
    </View>
  </View>
);

// ─── List Section Container ────────────────────────────────────────
const ListSection = ({ children, title, onLayout }: { children: React.ReactNode; title: string; onLayout?: (event: LayoutChangeEvent) => void }) => (
  <View style={styles.listSectionContainer} onLayout={onLayout}>
    <Text accessibilityRole="header" style={styles.sectionLabel}>{title}</Text>
    <View style={styles.listBlock}>
      {children}
    </View>
  </View>
);

// ─── Success Modal component ──────────────────────────────────────────
const SuccessModal = ({ visible, onDone }: { visible: boolean; onDone: () => void }) => {
  const scaleValue = useRef(new Animated.Value(0)).current;
  const opacityValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scaleValue, {
          toValue: 1,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
        Animated.timing(opacityValue, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      scaleValue.setValue(0);
      opacityValue.setValue(0);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onDone}>
      <View style={styles.successModalOverlay}>
        <Animated.View style={[
          styles.successCard,
          { opacity: opacityValue, transform: [{ scale: scaleValue }] }
        ]}>
          <View style={styles.successIconCircle}><Ionicons name="checkmark" size={27} color={palette.accentText} /></View>
          <Text style={styles.successTitle}>Photos saved</Text>
          <TouchableOpacity style={styles.doneButton} onPress={onDone} activeOpacity={0.8} accessibilityRole="button">
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
};



// ─── Main Screen ──────────────────────────────────────────────────────
export const EditProfileScreen = () => {
  const insets = useSafeAreaInsets();
  const dispatch = useDispatch();
  const navigation = useNavigation<any>();
  const route = useRoute();
  // Opened without a profile (the real-person check's "Fix" / "Edit my photos"):
  // start from the saved one; the refresh below brings the latest.
  const savedUser = useSelector((state: RootState) => state.auth.user);
  const { profile: passedProfile, section: entrySection } = (route.params ?? {}) as { profile?: any; section?: ProfileEditorSection };
  const initialProfile = passedProfile ?? savedUser ?? {};

  const [profile, setProfile] = useState<any>(initialProfile);
  const [saving, setSaving] = useState(false);
  const [successVisible, setSuccessVisible] = useState(false);
  const [toggleSaving, setToggleSaving] = useState<Set<string>>(() => new Set());
  const toggleRequests = useRef(new Set<string>());
  const photoDraft = useRef(false);
  const replacementPhoto = useRef<any | null>(null);
  const pendingExit = useRef<NavigationAction | null>(null);
  const [discardVisible, setDiscardVisible] = useState(false);

  const [mediaActionVisible, setMediaActionVisible] = useState(false);

  // Distance the sheet travels to sit fully off-screen. Seeded with a value
  // taller than the sheet can be, then replaced by the real measurement on
  // first layout so the resting position never depends on a guess.
  // Reanimated shared values, matching CropModal above. The previous version
  // combined `useNativeDriver: true` animations with `setValue()` from a JS
  // PanResponder on the same Animated.Value: the node lives on the native side
  // once a native-driven animation touches it, so the per-frame JS writes did
  // not track the finger and the opening animation stuttered against them.
  // A shared value is written and read entirely on the UI thread, so the drag
  // and the spring drive the same value without crossing threads.
  const sheetY = useSharedValue(SHEET_CLOSED_OFFSET);
  const sheetH = useSharedValue(SHEET_CLOSED_OFFSET);
  const sheetClosing = useSharedValue(false);
  // Guard the post-mount animation against duplicate development effects.
  const sheetOpenStartedRef = useRef(false);
  const sheetClosingRef = useRef(false);

  // Work deferred until the sheet has finished closing. Launching an image
  // picker while the modal is still tearing down loses the result on Android,
  // so the picker waits for the dismissal instead of racing it.
  const afterCloseRef = useRef<null | (() => void)>(null);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, 1 - sheetY.value / sheetH.value)),
  }));

  const closeMediaAction = useCallback((next?: unknown) => {
    // A second press or backdrop event must not replace the selected action.
    if (sheetClosingRef.current) return;
    sheetClosingRef.current = true;
    sheetClosing.value = true;
    // Also used directly as an onPress handler, which would pass the press
    // event in as `next`.
    afterCloseRef.current = typeof next === 'function' ? (next as () => void) : null;
    if (!afterCloseRef.current) replacementPhoto.current = null;
    sheetY.value = withTiming(sheetH.value, { duration: 220 }, (finished) => {
      'worklet';
      if (finished) runOnJS(setMediaActionVisible)(false);
    });
  }, [sheetY, sheetH, sheetClosing]);

  // Keep this sheet in the screen's native window. Creating a separate Modal
  // window delayed the first frame on Android and could display an intermediate
  // sheet position while that window attached.
  useEffect(() => {
    if (!mediaActionVisible || sheetOpenStartedRef.current) return;
    const frame = requestAnimationFrame(() => {
      if (sheetClosingRef.current) return;
      sheetOpenStartedRef.current = true;
      sheetY.value = withTiming(0, {
        duration: 180,
        easing: Easing.out(Easing.cubic),
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [mediaActionVisible, sheetY]);

  useEffect(() => {
    if (!mediaActionVisible) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closeMediaAction();
      return true;
    });
    return () => subscription.remove();
  }, [mediaActionVisible, closeMediaAction]);

  useEffect(() => {
    if (mediaActionVisible) return;
    const next = afterCloseRef.current;
    if (!next) return;
    afterCloseRef.current = null;
    const task = InteractionManager.runAfterInteractions(next);
    return () => task.cancel();
  }, [mediaActionVisible]);

  // overshootClamping matters here: the sheet is anchored to the bottom edge, so
  // any overshoot past 0 lifts it clear of the edge and flashes a strip of
  // backdrop underneath it. Clamping settles it exactly on the anchor.
  const SHEET_SPRING = { damping: 18, stiffness: 190, mass: 0.7, overshootClamping: true };

  // `changeY` is relative to the previous frame, so the sheet keeps following
  // the finger even when the grab happens mid-animation - no need to stop a
  // running animation first.
  const sheetPanGesture = Gesture.Pan()
    .onChange((e) => {
      'worklet';
      if (sheetClosing.value) return;
      const next = sheetY.value + e.changeY;
      // Downwards tracks the finger exactly; upwards gets rubber-band damping
      // so the sheet cannot be dragged above its resting position.
      sheetY.value = next > 0 ? next : Math.max(next * 0.25, -50);
    })
    .onEnd((e) => {
      'worklet';
      if (sheetClosing.value) return;
      if (sheetY.value > 80 || e.velocityY > 600) {
        runOnJS(closeMediaAction)();
      } else {
        sheetY.value = withSpring(0, SHEET_SPRING);
      }
    });

  const [currentPhotos, setCurrentPhotos] = useState<any[]>(initialProfile.photos || []);
  const faceIssues = useFaceMediaIssues();
  // A photo is uploaded and checked for nudity the moment it is picked
  // (docs/NUDITY_CHECK.md), so the answer comes before Save. By local address:
  // the tile's state, the running check, and the uploaded file Save reuses.
  const [photoChecks, setPhotoChecks] = useState<Record<string, 'checking' | 'unsure'>>({});
  const checkTasks = useRef(new Map<string, Promise<void>>());
  const checkedUploads = useRef(new Map<string, { fileUrl: string; review: boolean }>());
  const checkingPhotos = Object.values(photoChecks).includes('checking');
  const tileIssues = React.useMemo(() => ({ ...faceIssues, ...photoChecks }), [faceIssues, photoChecks]);
  const setPhotoCheck = (uri: string, state: 'checking' | 'unsure' | null) => setPhotoChecks((prev) => {
    const next = { ...prev };
    if (state) next[uri] = state; else delete next[uri];
    return next;
  });
  const precheck = (photo: { uri: string; mimeType?: string | null }, replaced: any | null) => {
    setPhotoCheck(photo.uri, 'checking');
    const task = precheckPhoto(photo.uri, photo.mimeType).then((result) => {
      checkedUploads.current.set(photo.uri, result);
      setPhotoCheck(photo.uri, result.review ? 'unsure' : null);
      if (result.review) tellBeingChecked('photo');
    }).catch((err: any) => {
      setPhotoCheck(photo.uri, null);
      const refused = explicitUploadMessage(err);
      // Anything else (no connection): Save uploads it the usual way.
      if (!refused) return;
      // Off the grid at once; a photo it replaced comes back.
      setCurrentPhotos((prev) => replaced
        ? prev.map((item) => item.uri === photo.uri ? replaced : item)
        : prev.filter((item) => item.uri !== photo.uri));
      Alert.alert("This photo can't be used", refused);
    }).finally(() => { checkTasks.current.delete(photo.uri); });
    checkTasks.current.set(photo.uri, task);
  };
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const photoScrollRef = useRef<GestureScrollView>(null);
  const sectionOffsets = useRef<Partial<Record<ProfileEditorSection, number>>>({});
  const scrollContentReady = useRef(false);
  const scrollViewportReady = useRef(false);
  const sectionEntry = useRef<{ section?: ProfileEditorSection; handled: boolean }>({ section: entrySection, handled: false });
  const scrollToEntrySection = useCallback(() => {
    if (sectionEntry.current.section !== entrySection) sectionEntry.current = { section: entrySection, handled: false };
    const offset = entrySection ? sectionOffsets.current[entrySection] : undefined;
    if (!entrySection || sectionEntry.current.handled || !navigation.isFocused() ||
        !scrollContentReady.current || !scrollViewportReady.current || offset === undefined || !photoScrollRef.current) return;
    photoScrollRef.current.scrollTo({ y: Math.max(0, offset - 8), animated: false });
    sectionEntry.current.handled = true;
  }, [entrySection, navigation]);
  const measureSection = useCallback((section: ProfileEditorSection, event: LayoutChangeEvent) => {
    sectionOffsets.current[section] = event.nativeEvent.layout.y;
    scrollToEntrySection();
  }, [scrollToEntrySection]);
  // A preloaded editor already has its measurements. A new editor waits for layout.
  useFocusEffect(useCallback(() => { scrollToEntrySection(); }, [scrollToEntrySection]));
  useFocusEffect(useCallback(() => {
    if (Platform.OS === 'web') return;
    return afterScreenTransition(navigation, () => {
      navigation.preload('EditBirthday', {currentBirthday: profile.birthday});
      navigation.preload('EditInterests', {currentInterests: profile.preferences?.interests});
    });
  }, [navigation, profile.birthday, profile.preferences?.interests]));
  
  const [cropModalVisible, setCropModalVisible] = useState(false);
  const [photoToCrop, setPhotoToCrop] = useState<string | null>(null);
  const [newPhotoToCrop, setNewPhotoToCrop] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialProfile.avatarUrl || null);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  // Photos and a video the nudity check sent to the team: not on the profile yet.
  const [pendingMedia, setPendingMedia] = useState<{ id: string; kind: string; mediaUrl: string | null }[]>(initialProfile.pendingMedia ?? []);

  const withdrawPending = (id: string) => {
    Alert.alert('Remove this?', "It won't be added to your profile.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          try {
            await api.delete(`/profile/pending-media/${id}`);
            setPendingMedia((items) => items.filter((item) => item.id !== id));
          } catch (err: any) {
            Alert.alert("Couldn't remove it", err?.response?.data?.message ?? 'Check your connection and try again.');
          }
        },
      },
    ]);
  };

  // Refetch profile when screen gains focus (after editing a sub-screen).
  //
  // Deliberately deferred until the navigation transition has finished. Focus
  // fires as the push *starts*, so the response used to land while the screen
  // was still sliding in, and applying it re-renders this whole tree - the grid
  // with its six animated slots plus every list section. That commit blocks the
  // UI thread, which is what made the last frames of the slide stutter.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      const task = InteractionManager.runAfterInteractions(async () => {
        try {
          const response = await api.get('/profile');
          // The screen can be left before the request settles.
          if (cancelled) return;
          if (response.data?.success && response.data.data) {
            const freshProfile = response.data.data;
            // Bail out when the server returns what is already on screen, which
            // is the common case on entry. Returning the previous reference from
            // an updater makes React skip the re-render entirely; committing an
            // identical copy instead cost ~220ms of display-list recording and
            // showed up as a hitch just after the screen settled.
            const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
            setProfile((prev: any) => {
              const next = { ...freshProfile };
              for (const field of toggleRequests.current) next[field] = prev[field];
              return same(prev, next) ? prev : next;
            });
            setCurrentPhotos((prev) => {
              if (photoDraft.current) return prev;
              const next = freshProfile.photos || [];
              return same(prev, next) ? prev : next;
            });
            setAvatarUrl((prev) => {
              const next = freshProfile.avatarUrl || null;
              return prev === next ? prev : next;
            });
            setPendingMedia((prev) => {
              const next = freshProfile.pendingMedia ?? [];
              return same(prev, next) ? prev : next;
            });
          }
        } catch (err) {
          // A background refresh: the profile on screen stays, so a warning, not an error screen.
          if (!cancelled) console.warn('[EditProfile] Could not refresh the profile:', (err as Error)?.message ?? err);
        }
      });

      return () => {
        cancelled = true;
        task.cancel();
      };
    }, [])
  );

  const handleToggle = async (field: string, value: boolean) => {
    if (toggleRequests.current.has(field)) return;
    const previous = profile[field] ?? true;
    toggleRequests.current.add(field);
    setToggleSaving(new Set(toggleRequests.current));
    setProfile((prev: any) => ({ ...prev, [field]: value }));
    try {
      const response = await api.put('/profile', { [field]: value });
      if (response.data?.success) {
        dispatch(updateUser({ [field]: value }));
      } else {
        throw new Error('Could not update visibility');
      }
    } catch (err: any) {
      setProfile((prev: any) => ({ ...prev, [field]: previous }));
      Alert.alert('Error', err.response?.data?.message || 'Failed to update');
    } finally {
      toggleRequests.current.delete(field);
      setToggleSaving(new Set(toggleRequests.current));
    }
  };

  // Stable callbacks keep the photo grid separate from unrelated screen updates.
  const handleScrollLock = useCallback((locked: boolean) => setScrollEnabled(!locked), []);
  const handleCropProfile = useCallback((url: string) => {
    setPhotoToCrop(url);
    setCropModalVisible(true);
  }, []);

  const openPhotoChooser = useCallback((replacing?: any) => {
    if (mediaActionVisible) return;
    if (!replacing && currentPhotos.length >= 6) {
      Alert.alert('Limit Reached', 'You can only upload up to 6 photos.');
      return;
    }
    replacementPhoto.current = replacing ?? null;
    afterCloseRef.current = null;
    sheetClosingRef.current = false;
    sheetClosing.value = false;
    sheetOpenStartedRef.current = false;
    // Mount the overlay at its closed position. Its effect starts the opening
    // animation on the frame after React commits the view.
    sheetY.value = sheetH.value;
    setMediaActionVisible(true);
  }, [currentPhotos.length, mediaActionVisible, sheetY, sheetH, sheetClosing]);
  const handleAddMediaPress = useCallback(() => openPhotoChooser(), [openPhotoChooser]);
  const handleReplacePhoto = useCallback((photo: any) => openPhotoChooser(photo), [openPhotoChooser]);

  const handleTakePhoto = () => closeMediaAction(takePhoto);
  const handlePickImage = () => closeMediaAction(pickImage);

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      replacementPhoto.current = null;
      Alert.alert('Permission needed', 'Camera permission is required to take photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      setNewPhotoToCrop(result.assets[0]);
    } else replacementPhoto.current = null;
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      replacementPhoto.current = null;
      Alert.alert('Permission needed', 'Gallery permission is required to choose photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      setNewPhotoToCrop(result.assets[0]);
    } else replacementPhoto.current = null;
  };

  const handleSavePhotos = async () => {
    if (!currentPhotos.some(photo => photo.photoUrl || photo.uri)) {
      Alert.alert('Add a profile photo', 'Your profile needs at least one photo. Add a photo before saving.');
      return;
    }
    setSaving(true);
    let heldPhotos = 0;
    try {
      // Checks still running finish first; a refused photo leaves the grid.
      if (checkTasks.current.size) {
        await Promise.all(checkTasks.current.values());
        setSaving(false);
        return;
      }
      const photoUrls: string[] = [];
      const newPhotoPayloads: { id: string, type: 'photo', ext: string, uri: string }[] = [];

      currentPhotos.forEach((photo, i) => {
        if (photo.photoUrl) {
          photoUrls[i] = photo.photoUrl;
        } else if (photo.uri && checkedUploads.current.has(photo.uri)) {
          // Uploaded and checked when it was picked.
          photoUrls[i] = checkedUploads.current.get(photo.uri)!.fileUrl;
        } else if (photo.uri) {
          const ext = photoExtFromAsset(photo.uri, photo.mimeType);
          const id = `new_${i}`;
          newPhotoPayloads.push({ id, type: 'photo', ext, uri: photo.uri });
          photoUrls[i] = `UPLOAD_PENDING_${id}`;
        }
      });

      if (newPhotoPayloads.length > 0) {
        const presignRes = await api.post('/upload/presigned-urls', {
          files: newPhotoPayloads.map(f => ({ type: f.type, ext: f.ext }))
        });
        const uploadTickets = presignRes.data.data;

        await Promise.all(newPhotoPayloads.map(async (file, index) => {
          const ticket = uploadTickets[index];
          const response = await fetch(Platform.OS === 'ios' ? file.uri.replace('file://', '') : file.uri);
          const blob = await response.blob();

          const uploadResponse = await fetch(ticket.uploadUrl, {
            method: 'PUT',
            body: blob,
            headers: { 'Content-Type': ticket.contentType }
          });
          if (!uploadResponse.ok) throw new Error('Photo upload failed');
          if ((await completeProfileUpload(ticket.assetId)).review) heldPhotos += 1;

          const placeholder = `UPLOAD_PENDING_${file.id}`;
          const finalIdx = photoUrls.indexOf(placeholder);
          if (finalIdx !== -1) photoUrls[finalIdx] = ticket.fileUrl;
        }));
      }

      const data: any = {
        name: profile.name,
        photos: photoUrls.filter(url => url && !url.startsWith('UPLOAD_PENDING_')),
      };
      if (!data.photos.length) throw new Error('Your profile needs at least one photo. Add a photo before saving.');

      const response = await api.put('/profile', data);
      
      if (response.data?.success) {
        dispatch(updateUser(response.data.data));
        setProfile(response.data.data);
        setCurrentPhotos(response.data.data.photos || []);
        setAvatarUrl(response.data.data.avatarUrl || null);
        setPendingMedia(response.data.data.pendingMedia ?? []);
        checkedUploads.current.clear();
        setPhotoChecks({});
        if (heldPhotos) tellBeingChecked('photo', heldPhotos);
        else setSuccessVisible(true);
      }
    } catch (err: any) {
      if (!explicitUploadMessage(err)) console.error('[EditProfile] Error Saving:', err);
      // The real-person check refuses a main photo that isn't them (PHOTO_VERIFICATION_PLAN.md 5).
      Alert.alert(err.response?.data?.code === 'MAIN_PHOTO_NOT_YOU' ? 'Use a photo of yourself' : explicitUploadMessage(err) ? "This photo can't be used" : 'Error', err.response?.data?.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleInstantProfileCropSave = async (croppedUri: string) => {
    setCropModalVisible(false);
    setSaving(true);
    try {
      const ext = photoExtFromAsset(croppedUri);
      const filePayloads = [{ id: 'profile_crop', type: 'photo', ext, uri: croppedUri }];
      
      const presignRes = await api.post('/upload/presigned-urls', {
        files: filePayloads.map(f => ({ type: f.type, ext: f.ext }))
      });
      const uploadTicket = presignRes.data.data[0];

      const response = await fetch(Platform.OS === 'ios' ? croppedUri.replace('file://', '') : croppedUri);
      const blob = await response.blob();

      const uploadResponse = await fetch(uploadTicket.uploadUrl, {
        method: 'PUT',
        body: blob,
        headers: { 'Content-Type': uploadTicket.contentType }
      });
      if (!uploadResponse.ok) throw new Error('Photo upload failed');
      if ((await completeProfileUpload(uploadTicket.assetId)).review) { tellBeingChecked('photo'); return; }

      const data: any = {
        name: profile.name,
        avatarUrl: uploadTicket.fileUrl,
      };

      const profileResponse = await api.put('/profile', data);
      
      if (profileResponse.data?.success) {
        dispatch(updateUser(profileResponse.data.data));
        setAvatarUrl(profileResponse.data.data.avatarUrl);
        Alert.alert("Success", "Profile Avatar updated successfully!");
      }
    } catch (err: any) {
      console.error('[EditProfile] Error Saving Crop:', err);
      Alert.alert('Error', err.response?.data?.message || 'Failed to update cropped photo');
    } finally {
      setSaving(false);
    }
  };

  const hasUnsavedPhotos = JSON.stringify(currentPhotos.map(p => p.photoUrl || p.uri)) !== JSON.stringify((profile.photos || []).map((p: any) => p.photoUrl || p.uri));
  photoDraft.current = hasUnsavedPhotos;
  usePreventRemove(hasUnsavedPhotos || saving, ({ data }) => {
    // Do not exit while the current save is still running.
    if (saving) return;
    pendingExit.current = data.action;
    setDiscardVisible(true);
  });
  const keepEditing = () => {
    pendingExit.current = null;
    setDiscardVisible(false);
  };
  const discardAndExit = () => {
    const action = pendingExit.current;
    pendingExit.current = null;
    setDiscardVisible(false);
    // Replay the original action. Navigation marks it as already confirmed for this screen.
    if (action) navigation.dispatch(action);
  };
  const displayedAvatar = avatarUrl || currentPhotos[0]?.photoUrl || currentPhotos[0]?.uri;
  const cropSource = currentPhotos[0]?.photoUrl || currentPhotos[0]?.uri || avatarUrl;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <PhotoDiscardDialog visible={discardVisible} onKeepEditing={keepEditing} onDiscard={discardAndExit} />
      <SuccessModal 
        visible={successVisible} 
        onDone={() => {
          setSuccessVisible(false);
          navigation.goBack();
        }} 
      />

      {photoToCrop && cropModalVisible && (
        <AvatarCropModal
          visible={cropModalVisible}
          imageUri={photoToCrop}
          onCancel={() => {
            setCropModalVisible(false);
            setPhotoToCrop(null);
          }}
          onCropSave={handleInstantProfileCropSave}
        />
      )}
      {newPhotoToCrop && (
        <PhotoCropModal
          imageUri={newPhotoToCrop.uri}
          onCancel={() => { replacementPhoto.current = null; setNewPhotoToCrop(null); }}
          onSave={(cropped) => {
            const replacing = replacementPhoto.current;
            const nextPhoto = {
              ...newPhotoToCrop, ...cropped, mimeType: 'image/jpeg',
              fileName: newPhotoToCrop.fileName?.replace(/\.[^.]+$/, '.jpg'),
            };
            setCurrentPhotos(prev => {
              if (!replacing) return prev.length < 6 ? [...prev, nextPhoto] : prev;
              const index = prev.findIndex(photo => replacing.id ? photo.id === replacing.id : (photo.photoUrl || photo.uri) === (replacing.photoUrl || replacing.uri));
              if (index < 0) return prev;
              return prev.map((photo, position) => position === index ? nextPhoto : photo);
            });
            precheck(nextPhoto, replacing);
            replacementPhoto.current = null;
            setNewPhotoToCrop(null);
          }}
        />
      )}

      {/* Full Screen Image Viewer */}
      <Modal 
        visible={!!selectedImageUrl} 
        transparent 
        animationType="fade"
        onRequestClose={() => setSelectedImageUrl(null)}
      >
        <TouchableOpacity 
          style={styles.imageViewerOverlay} 
          activeOpacity={1} 
          onPress={() => setSelectedImageUrl(null)}
        >
          <TouchableOpacity 
            style={styles.closeViewerButton} 
            onPress={() => setSelectedImageUrl(null)}
          >
            <Ionicons name="close-circle" size={44} color="#fff" />
          </TouchableOpacity>
          <Image 
            source={{ uri: selectedImageUrl || '' }} 
            style={styles.fullScreenImage} 
            resizeMode="contain" 
          />
        </TouchableOpacity>
      </Modal>

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top, height: insets.top + 52 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={25} color="#FFFFFF" />
        </TouchableOpacity>
        <Text accessibilityRole="header" style={styles.headerTitle}>Edit profile</Text>
        <TouchableOpacity onPress={handleSavePhotos} disabled={saving || checkingPhotos || !hasUnsavedPhotos}
          style={[styles.headerSave, (saving || checkingPhotos || !hasUnsavedPhotos) && {opacity: 0.4}]}
          activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={checkingPhotos ? 'Save, waiting for the photo check' : 'Save photos'}
          accessibilityState={{disabled: saving || checkingPhotos || !hasUnsavedPhotos, busy: saving || checkingPhotos}}>
          {saving ? <ActivityIndicator size="small" color={palette.accentText}/> : <Text style={styles.headerSaveText}>Save</Text>}
        </TouchableOpacity>
      </View>

      <GestureScrollView
        ref={photoScrollRef}
        onLayout={() => { scrollViewportReady.current = true; scrollToEntrySection(); }}
        onContentSizeChange={() => { scrollContentReady.current = true; scrollToEntrySection(); }}
        removeClippedSubviews={false}
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 12) + 16 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollEnabled}
      >
        <Text accessibilityRole="header" style={styles.mediaSectionLabel}>Photos & video</Text>
        {/* Avatar */}
        <View style={styles.avatarCard}>
          <TouchableOpacity 
            activeOpacity={0.9}
            style={styles.avatarImage}
            accessibilityRole="button" accessibilityLabel={displayedAvatar ? 'View avatar' : 'Add a profile photo'}
            onPress={() => {
              const url = avatarUrl || currentPhotos[0]?.photoUrl || currentPhotos[0]?.uri;
              if (url) setSelectedImageUrl(url);
              else handleAddMediaPress();
            }}
          >
            {displayedAvatar ? <Image source={{ uri: displayedAvatar }} style={{ width: '100%', height: '100%' }} />
              : <Ionicons name="person-outline" size={28} color={palette.accent} />}
          </TouchableOpacity>
          <View style={styles.avatarCopy}>
            <Text style={styles.avatarTitle}>Profile photo</Text>
            <Text style={styles.avatarHint}>Your avatar in chats and previews.</Text>
            <TouchableOpacity onPress={() => cropSource ? handleCropProfile(cropSource) : handleAddMediaPress()} style={styles.avatarAdjust} activeOpacity={0.75} hitSlop={4} accessibilityRole="button">
              <Ionicons name={cropSource ? 'crop-outline' : 'add'} size={15} color={palette.accent} />
              <Text style={styles.avatarAdjustText}>{cropSource ? 'Adjust avatar' : 'Add a photo'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* The profile video: see it, play it, replace or remove it (saves at once). */}
        <ProfileVideoSection onLayout={event => measureSection('video', event)} />

        {/* Grid Photos */}
        <View style={styles.photosCard} onLayout={event => measureSection('photos', event)}>
        <View style={styles.photosHeading}>
          <Text style={styles.photosTitle}>Your photos</Text>
          <Text style={styles.photosCount}>{currentPhotos.length} / 6</Text>
        </View>
        <Text style={styles.photoHint}>Keep at least one photo.</Text>
        {pendingMedia.length > 0 && (
          <View style={styles.pendingBox}>
            <Text style={styles.pendingTitle}>Being checked</Text>
            <Text style={styles.pendingHint}>Our team is looking at these. They go on your profile once approved - usually within a day.</Text>
            <View style={styles.pendingRow}>
              {pendingMedia.map((item) => (
                <View key={item.id} style={styles.pendingItem}>
                  {item.kind === 'profile_video'
                    ? <View style={[styles.pendingThumb, styles.pendingVideo]}><Ionicons name="videocam-outline" size={22} color={palette.accent} /></View>
                    : <Image source={{ uri: item.mediaUrl ?? undefined }} style={styles.pendingThumb} blurRadius={18} />}
                  <TouchableOpacity style={styles.pendingRemove} onPress={() => withdrawPending(item.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={item.kind === 'profile_video' ? 'Remove video being checked' : 'Remove photo being checked'}>
                    <Ionicons name="close" size={13} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        )}
        <Text style={styles.photoInstruction}>Hold and drag to reorder. Your first photo leads your profile.</Text>
        {/* A photo the selfie check could not match is marked on its own tile. */}
        <FaceMediaNote />
        <PhotoReorderGrid
          embedded
          issues={tileIssues}
          photos={currentPhotos}
          onReplacePress={handleReplacePhoto}
          onPhotosChange={setCurrentPhotos}
          onAddPress={handleAddMediaPress}
          onScrollLock={handleScrollLock}
          onCropProfile={handleCropProfile}
          scrollRef={photoScrollRef}
        />
        </View>

        {/* ── My Basics ── */}
        <ListSection title="Personal details" onLayout={event => measureSection('about', event)}>
          <ListRow icon="person" label="Name" value={profile.name || ''} locked />
          <ListRow
            icon="calendar-outline"
            label="Birthday"
            value={profile.birthday ? new Date(profile.birthday).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
            onPress={() => navigation.navigate('EditBirthday', { currentBirthday: profile.birthday })}
          />
          <ListRow
            icon={ABOUT_ME_ICONS.gender}
            label="Gender"
            value={profile.gender || ''}
            onPress={() => navigation.navigate('EditGender', { currentGender: profile.gender, currentShowGender: profile.showGender })}
          />
          <ListRow
            icon={ABOUT_ME_ICONS.orientation}
            label="Orientation"
            value={Array.isArray(profile.orientation) ? profile.orientation.join(', ') : (profile.orientation || '')}
            onPress={() => navigation.navigate('EditOrientation', { currentOrientation: profile.orientation, currentShowOrientation: profile.showOrientation })}
          />
          <ListRow
            icon="search-outline"
            label="Looking for"
            value={profile.seeking || ''}
            onPress={() => navigation.navigate('EditSeeking', { currentSeeking: profile.seeking })}
          />
          <ListRow
            icon={ABOUT_ME_ICONS.height}
            label="Height"
            value={profile.height ? `${profile.height} cm` : ''}
            onPress={() => navigation.navigate('EditHeight', { currentHeight: profile.height })}
            isLast
          />
        </ListSection>

        {/* ── Bio ── */}
        <View style={styles.listSectionContainer}>
          <TouchableOpacity
            style={[styles.listBlock, styles.bioListRow]}
            onPress={() => navigation.navigate('EditBio', { currentBio: profile.preferences?.bio })}
            activeOpacity={0.6}
          >
            <View style={styles.bioListHeader}>
              <View style={styles.listRowIconContainer}>
                <Ionicons name="document-text-outline" size={19} color="#FFB8C7" />
              </View>
              <Text style={styles.bioListTitle}>Bio</Text>
              <Ionicons name="chevron-forward" size={17} color={palette.muted} />
            </View>
            <Text style={[styles.bioListText, !profile.preferences?.bio && styles.bioListTextEmpty]} numberOfLines={4}>
              {profile.preferences?.bio || 'Add a short introduction about yourself.'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Visibility ── */}
        <ListSection title="Visibility" onLayout={event => measureSection('visibility', event)}>
          <Text style={styles.visibilityHint}>Choose which details appear on your profile.</Text>
          <ListToggleRow
            icon="eye-outline"
            label="Show Gender"
            value={profile.showGender ?? true}
            onToggle={(val) => handleToggle('showGender', val)}
            saving={toggleSaving.has('showGender')}
          />
          <ListToggleRow
            icon="eye-outline"
            label="Show Orientation"
            value={profile.showOrientation ?? true}
            onToggle={(val) => handleToggle('showOrientation', val)}
            saving={toggleSaving.has('showOrientation')}
            isLast
          />
        </ListSection>

        {/* ── Campus Life ── */}
        <ListSection title="College & studies" onLayout={event => measureSection('campus', event)}>
          <ListRow icon={CAMPUS_ICONS.college} label="College" value={profile.college || ''} onPress={() => navigation.navigate('EditCollege', { currentCollege: profile.college })} />
          <ListRow icon={CAMPUS_ICONS.department} label="Department" value={profile.department || ''} onPress={() => navigation.navigate('EditDepartment', { currentDepartment: profile.department })} />
          <ListRow icon={CAMPUS_ICONS.degree} label="Studies" value={studiesSummary(profile)} onPress={() => navigation.navigate('EditStudies', {currentDegree: profile.degree, currentYearOfStudy: profile.yearOfStudy, currentGraduationYear: profile.graduationYear})}/>
          <ListRow icon={CAMPUS_ICONS.campus} label="Campus" value={profile.campus || ''} onPress={() => navigation.navigate('EditCampus', { currentCampus: profile.campus })} />
          <ListRow 
            icon={CAMPUS_ICONS.residency} 
            label="Residency" 
            value={profile.isHosteller === true ? 'Hosteller' : profile.isHosteller === false ? 'Day Scholar' : ''} 
            onPress={() => navigation.navigate('EditResidency', { currentResidency: profile.isHosteller })} 
          />
          <ListRow icon={CAMPUS_ICONS.attendanceMood} label="Attendance Mood" value={profile.attendanceMood || ''} onPress={() => navigation.navigate('EditAttendanceMood', { currentMood: profile.attendanceMood })} isLast />
        </ListSection>

        {/* ── More About Me ── */}
        <ListSection title="Interests & habits">
          <ListRow icon={CAMPUS_ICONS.clubs} label="Clubs" value={Array.isArray(profile.clubs) && profile.clubs.length > 0 ? profile.clubs.join(', ') : ''} onPress={() => navigation.navigate('EditSocial', { currentClubs: profile.clubs, currentAttendanceMood: profile.attendanceMood, currentHangoutSpot: Array.isArray(profile.hangoutSpots) ? profile.hangoutSpots[0] : '' })} />
          <ListRow icon={ABOUT_ME_ICONS.lifestyle} label="Lifestyle" value={profile.preferences?.lifestyle ? Object.values(profile.preferences.lifestyle).filter(Boolean).length + ' set' : ''} onPress={() => navigation.navigate('EditLifestyle', { currentLifestyle: profile.preferences?.lifestyle })} />
          <ListRow icon={ABOUT_ME_ICONS.personality} label="Personality" value={profile.preferences?.personality ? Object.entries(profile.preferences.personality).filter(([id, value]) => id !== 'education' && value).length + ' set' : ''} onPress={() => navigation.navigate('EditPersonality', { currentPersonality: profile.preferences?.personality })} />
          <ListRow icon={ABOUT_ME_ICONS.interests} label="Interests" value={Array.isArray(profile.preferences?.interests) && profile.preferences.interests.length > 0 ? `${profile.preferences.interests.length} selected` : ''} onPress={() => navigation.navigate('EditInterests', { currentInterests: profile.preferences?.interests })} isLast />
        </ListSection>


      </GestureScrollView>

      {/* Keep the sheet inside a gesture root while it shares this screen's
          native window. */}
      {mediaActionVisible && (
        <GestureHandlerRootView style={styles.actionSheetOverlay} pointerEvents="box-none">
          <Reanimated.View
            style={[StyleSheet.absoluteFill, styles.actionSheetBackdrop, backdropStyle]}
            pointerEvents="none"
          />
          <GesturePressable
            style={StyleSheet.absoluteFill}
            onPress={() => closeMediaAction()}
            accessibilityRole="button"
            accessibilityLabel="Close photo options"
          />
          <Reanimated.View
            onLayout={(e) => {
              const measured = e.nativeEvent.layout.height;
              if (measured > 0) sheetH.value = measured;
            }}
            style={[styles.actionSheetContainer, { paddingBottom: Math.max(insets.bottom, 12) + 12 }, sheetStyle]}
          >
            {/* Grab area: the bar and the header both drag the sheet. */}
            <GestureDetector gesture={sheetPanGesture}>
              <View>
                <View style={styles.actionSheetHandleContainer}>
                  <View style={styles.actionSheetHandleBar} />
                </View>

                <View style={styles.actionSheetHeader}>
                  <Text style={styles.actionSheetTitle}>{replacementPhoto.current ? 'Replace Photo' : 'Upload Photo'}</Text>
                  <Text style={styles.actionSheetSubtitle}>{replacementPhoto.current ? 'Choose a new photo. Your current photo stays until you save.' : 'Choose a photo or take a new one'}</Text>
                </View>
              </View>
            </GestureDetector>

            {/* Native gesture buttons follow the sheet's UI-thread transform on Android. */}
            <GesturePressable style={({ pressed }) => [styles.actionSheetPillButton, pressed && styles.actionSheetPressed]}
              onPress={handleTakePhoto} accessibilityRole="button" accessibilityLabel="Take photo">
              <Ionicons name="camera" size={20} color="#FFFFFF" />
              <Text style={styles.actionSheetPillText}>Take Photo</Text>
            </GesturePressable>

            <GesturePressable style={({ pressed }) => [styles.actionSheetPillButton, pressed && styles.actionSheetPressed]}
              onPress={handlePickImage} accessibilityRole="button" accessibilityLabel="Choose photo from gallery">
              <Ionicons name="images" size={20} color="#FFFFFF" />
              <Text style={styles.actionSheetPillText}>Choose from Gallery</Text>
            </GesturePressable>

            <GesturePressable style={({ pressed }) => [styles.actionSheetCancelPillButton, pressed && styles.actionSheetPressed]}
              onPress={() => closeMediaAction()} accessibilityRole="button" accessibilityLabel="Cancel photo selection">
              <Text style={styles.actionSheetCancelPillText}>Cancel</Text>
            </GesturePressable>
          </Reanimated.View>
        </GestureHandlerRootView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  pendingBox: { marginTop: 6, marginBottom: 12, padding: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)' },
  pendingTitle: { fontSize: 14, fontWeight: '700', color: palette.text },
  pendingHint: { marginTop: 2, fontSize: 12.5, lineHeight: 17, color: palette.secondary },
  pendingRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  pendingItem: { width: 64, height: 80 },
  pendingThumb: { width: 64, height: 80, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)' },
  pendingVideo: { alignItems: 'center', justifyContent: 'center' },
  pendingRemove: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: '#3A3A3C', alignItems: 'center', justifyContent: 'center' },
  mediaSectionLabel: {marginHorizontal: 18, marginTop: 8, marginBottom: 10, fontSize: 16, lineHeight: 22, fontFamily: 'DMSans_700Bold', color: editColors.text},
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, backgroundColor: colors.background },
  backButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: editColors.surface, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontFamily: 'DMSans_700Bold',
    color: editColors.text,
  },
  scrollView: { flex: 1 },
  scrollContent: { width: '100%', maxWidth: 600, alignSelf: 'center', paddingTop: 8 },
  headerSave: { minWidth: 76, minHeight: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' },
  headerSaveText: { color: palette.accentText, fontFamily: 'DMSans_700Bold', fontSize: 13 },
  avatarCard: { marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, backgroundColor: palette.card, borderRadius: 18 },
  avatarImage: { width: 64, height: 64, borderRadius: 32, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#393339' },
  avatarCopy: { flex: 1, minWidth: 0 },
  avatarTitle: { color: '#FFB8C7', fontFamily: 'DMSans_500Medium', fontSize: 14, lineHeight: 20 },
  avatarHint: { color: '#DDD0D5', fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 17, marginTop: 3 },
  avatarAdjust: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: '#3B2933' },
  avatarAdjustText: { color: palette.accent, fontFamily: 'DMSans_700Bold', fontSize: 12 },
  photosCard: { marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: 18, backgroundColor: '#222222' },
  photosHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 },
  photoHint: { fontSize: 12, lineHeight: 18, fontFamily: 'DMSans_400Regular', color: '#F0DEE3', marginBottom: 6 },
  photoInstruction: { fontSize: 11, lineHeight: 16, fontFamily: 'DMSans_400Regular', color: '#C7BEC1', marginBottom: 12 },
  photosTitle: { color: '#FFB8C7', fontFamily: 'DMSans_500Medium', fontSize: 14, lineHeight: 20 },
  photosCount: { color: palette.accent, fontFamily: 'DMSans_700Bold', fontSize: 12 },
  sectionLabel: { fontSize: 16, lineHeight: 22, fontFamily: 'DMSans_700Bold', color: editColors.text, marginBottom: 8, marginHorizontal: 2 },

  // ── List Option D Styles ──
  visibilityHint: { marginHorizontal: 16, marginTop: 12, marginBottom: 4, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, color: palette.muted },
  listSectionContainer: { marginHorizontal: 16, marginTop: 18 },
  listBlock: {
    backgroundColor: palette.card,
    borderRadius: 18,
    overflow: 'hidden',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  listRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.separator,
  },
  listRowIconContainer: {
    width: 26,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  listRowContent: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  listRowLabel: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: 'DMSans_400Regular',
    color: editColors.muted,
    marginBottom: 2,
  },
  listRowValue: {
    fontSize: 15,
    lineHeight: 21,
    fontFamily: 'DMSans_500Medium',
    color: '#FFFFFF',
  },
  listRowValueEmpty: {
    color: palette.accent,
  },
  listRowRight: {
    paddingLeft: 12,
  },

  // ── Bio List Row ──
  bioListRow: {
    padding: 14,
  },
  bioListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  bioListTitle: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'DMSans_500Medium',
    color: '#FFB8C7',
  },
  bioListText: {
    fontSize: 13,
    fontFamily: 'DMSans_400Regular',
    color: '#FFFFFF',
    lineHeight: 19,
  },
  bioListTextEmpty: {
    color: palette.accent,
  },

  // ── Media Grid ──
  mediaHint: { fontSize: 11, lineHeight: 16, fontFamily: 'DMSans_400Regular', color: '#DDD0D5', marginHorizontal: 16, marginBottom: 10 },

  // ── Action Sheet ──
  actionSheetOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'transparent', justifyContent: 'flex-end', zIndex: 100, elevation: 100 },
  actionSheetBackdrop: { backgroundColor: 'rgba(0, 0, 0, 0.55)' },
  actionSheetContainer: {
    // Start off-screen. useAnimatedStyle applies on the UI thread and is not
    // guaranteed to have run for the first frame after mount, which otherwise
    // paints the sheet at its resting position before it snaps down to slide
    // up - read as a flicker on open. The animated style overrides this.
    transform: [{ translateY: SHEET_CLOSED_OFFSET }],
    backgroundColor: palette.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
  },
  actionSheetHandleContainer: { width: '100%', alignItems: 'center', paddingTop: 14, paddingBottom: 10 },
  actionSheetHandleBar: { width: 48, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255, 255, 255, 0.4)' },
  actionSheetHeader: { alignItems: 'center', marginBottom: 14, marginTop: 2 },
  actionSheetTitle: { fontSize: 18, fontFamily: 'DMSans_700Bold', color: '#FFFFFF', marginBottom: 4 },
  actionSheetSubtitle: { fontSize: 12, fontFamily: 'DMSans_400Regular', color: palette.secondary },
  actionSheetPillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: 24,
    backgroundColor: '#353135',
    marginBottom: 10,
    gap: 10,
  },
  actionSheetPillText: { fontSize: 15, color: '#FFFFFF', fontWeight: '600' },
  actionSheetPressed: { opacity: 0.8 },
  actionSheetCancelPillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 46,
    borderRadius: 23,
    backgroundColor: palette.dangerSurface,
    marginTop: 4,
  },
  actionSheetCancelPillText: { fontSize: 14, color: palette.danger, fontFamily: 'DMSans_700Bold' },

  // ── Success Modal ──
  successModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  successCard: { width: '100%', maxWidth: 320, backgroundColor: palette.card, borderRadius: 22, padding: 24, alignItems: 'center' },
  successIconCircle: { width: 54, height: 54, borderRadius: 27, backgroundColor: palette.accent, justifyContent: 'center', alignItems: 'center', marginBottom: 14 },
  successTitle: { fontSize: 21, fontFamily: 'DMSans_700Bold', color: '#FFFFFF', marginBottom: 16, textAlign: 'center' },
  doneButton: { width: '100%', height: 46, borderRadius: 23, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' },
  doneButtonText: { color: palette.accentText, fontSize: 14, fontFamily: 'DMSans_700Bold' },

  // ── Image Viewer ──
  imageViewerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  fullScreenImage: { width: width, height: width * 1.5, maxHeight: '80%' },
  closeViewerButton: { position: 'absolute', top: 60, right: 20, zIndex: 10, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 10, elevation: 5 },

});
