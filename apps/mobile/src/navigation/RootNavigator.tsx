import {PhotoMediaSheet} from '../features/auth/onboarding/PhotoIntroduction';
import { RealPersonCheckScreen } from '../features/verification/RealPersonCheckScreen';
import { onShared, takeSharedContent } from '../../modules/chat-notify';
import { SharePickerScreen } from '../features/chat/screens/SharePickerScreen';
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import {getDiscoveryArrival, subscribeDiscoveryArrival} from '../features/discovery/discoveryArrival';
import {getNewcomerTeachingActive, subscribeNewcomerTeaching} from '../features/teaching/tipsSeen';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, store } from '../store';
import { Alert, AppState, Platform, Text, View } from 'react-native';
import { Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useReducedMotion } from 'react-native-reanimated';

const Stack = createNativeStackNavigator();
const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#100F0D',
    card: '#100F0D',
    primary: '#FF5A5F',
  },
};

import { AuthNavigator } from './AuthNavigator';
import { MainTabNavigator } from './MainTabNavigator';
import { PhotoUploadScreen } from '../features/auth/screens/PhotoUploadScreen';
import { ChatScreen } from '../features/chat/screens/ChatScreen';
import { MatchCelebrationScreen } from '../features/discovery/screens/MatchCelebrationScreen';
import { ChatAttachmentsScreen } from '../features/chat/components/AttachmentPickerSheet';
import { EditProfileScreen } from '../screens/main/EditProfileScreen';
import { ProfilePreviewScreen } from '../screens/main/ProfilePreviewScreen';
import { SettingsScreen } from '../screens/main/SettingsScreen';
import { EditGenderScreen } from '../screens/main/edit/EditGenderScreen';
import { ProfileGenderLabelsSheet } from '../features/auth/onboarding/GenderIntroduction';
import { EditSeekingScreen } from '../screens/main/edit/EditSeekingScreen';
import { EditCollegeScreen } from '../screens/main/edit/EditCollegeScreen';
import { EditDepartmentScreen } from '../screens/main/edit/EditDepartmentScreen';
import { EditStudiesScreen } from '../screens/main/edit/EditStudiesScreen';
import { ProfileDegreeOptionsSheet } from '../screens/main/edit/ProfileDegreeOptionsSheet';
import { EditCampusScreen } from '../screens/main/edit/EditCampusScreen';
import { EditDistanceScreen } from '../screens/main/edit/EditDistanceScreen';
import { EditAttendanceMoodScreen } from '../screens/main/edit/EditAttendanceMoodScreen';
import { EditBirthdayScreen } from '../screens/main/edit/EditBirthdayScreen';
import { EditOrientationScreen } from '../screens/main/edit/EditOrientationScreen';
import { EditSocialScreen } from '../screens/main/edit/EditSocialScreen';
import { ProfileClubSelectionSheet } from '../screens/main/edit/ProfileClubSelectionSheet';
import { ProfileTopicOptionsSheet } from '../screens/main/edit/ProfileTopicOptionsSheet';
import { EditLifestyleScreen } from '../screens/main/edit/EditLifestyleScreen';
import { EditPersonalityScreen } from '../screens/main/edit/EditPersonalityScreen';
import { EditInterestsScreen } from '../screens/main/edit/EditInterestsScreen';
import {ProfileInterestSelectionReviewSheet} from '../features/auth/onboarding/InterestIntroduction';
import { EditBioScreen } from '../screens/main/edit/EditBioScreen';
import { EditHeightScreen } from '../screens/main/edit/EditHeightScreen';
import { DiscardChangesSheet } from '../components/DiscardChangesSheet';
import { LogoutSheet } from '../screens/main/LogoutSheet';
import { DeleteAccountScreen } from '../screens/main/DeleteAccountScreen';
import { DataExportScreen } from '../screens/main/DataExportScreen';
import { ChangePasswordScreen } from '../screens/main/ChangePasswordScreen';
import { AccountDeletionPendingScreen } from '../screens/main/AccountDeletionPendingScreen';
import { AccountGoodbyeScreen } from '../features/auth/screens/AccountGoodbyeScreen';
import { useAccountGoodbye } from '../features/auth/accountGoodbye';
import { LegalScreen } from '../features/legal/LegalScreen';
import { TermsUpdateScreen } from '../features/legal/TermsUpdateScreen';
import { LEGAL_VERSION } from '../features/legal/legal';
import { ReportSomeoneScreen } from '../features/safety/ReportSomeoneScreen';
import { ReportHost } from '../features/safety/ReportSheet';
import { ReportProblemScreen } from '../features/feedback/ReportProblemScreen';
import { MyReportsScreen } from '../features/feedback/MyReportsScreen';
import { ShakeToReportHost } from '../features/feedback/ShakeToReport';
import { RatingPromptHost } from '../features/feedback/RatingPrompt';
import { AppErrorBoundary } from '../features/feedback/AppErrorBoundary';
import { installErrorMemory } from '../features/feedback/diagnostics';
import { startQueue } from '../features/feedback/reportQueue';
import { startEngagementTracking } from '../features/feedback/engagement';

import { HiddenWordsScreen } from '../features/safety/HiddenWordsScreen';
import { HowItWorksScreen, SwipeLessonScreen } from '../features/teaching/TeachingScreens';
import { ShareDateScreen } from '../features/safety/ShareDateScreen';
import { NomineeScreen } from '../features/safety/NomineeScreen';
import { ProfileVideoSourceSheet } from '../screens/main/profile/ProfileVideoSourceSheet';
import { ProfilePhotoOptionsSheet } from '../screens/main/profile/ProfilePhotoOptionsSheet';
import { ProfileProgressSheet } from '../screens/main/profile/ProfileProgressSheet';
import { EditResidencyScreen } from '../screens/main/edit/EditResidencyScreen';
import { RequiredDiscoveryPreferencesScreen } from '../features/auth/screens/RequiredDiscoveryPreferencesScreen';
import { StudentVerificationScreen } from '../features/auth/screens/StudentVerificationScreen';
import { VerifyRulesScreen } from '../features/verification/VerifyRulesScreen';
import { navigationRef } from './navigationRef';
import { api, refreshAtStart, renewSession } from '../services/api';
import { credentialStore } from '../services/credentialStore';
import { logout, setCredentials, setNextRequiredStep, resolveOnboardingStep } from '../store/authSlice';
import { registerCurrentDeviceForPush, setUpNotifications, watchPushToken, watchScreenForChatNotifications } from '../services/notifications';
import { openPendingPushUrl, recordOpenFromUrl, urlForResponse } from '../features/notifications/push/responses';
import { askAtMoment } from '../features/notifications/push/permission';
import { PermissionPrimer } from '../features/notifications/push/PermissionPrimer';
import { NotificationHelpScreen } from '../features/notifications/push/NotificationHelpScreen';
import { markFixOffered, shouldOfferFix } from '../features/notifications/push/lateDelivery';
import { useUnreadNotifications } from '../features/notifications/useUnreadNotifications';
import { StoryCreatorScreen } from '../features/stories/create/StoryCreator';
import { StoryViewerScreen } from '../features/stories/StoryViewerScreen';
import { FollowRequestsScreen } from '../screens/main/FollowRequestsScreen';
import { LikesYouScreen } from '../screens/main/LikesYouScreen';
import { StandoutsScreen } from '../screens/main/StandoutsScreen';
import { StandoutsInfoScreen } from '../screens/main/StandoutsInfoScreen';
import { PreferencesScreen } from '../features/discovery/screens/PreferencesScreen';
import { NotificationsScreen } from '../features/notifications/NotificationsScreen';
import { LocationSettingsScreen } from '../features/location/LocationSettingsScreen';
import { MapScreen } from '../features/location/MapScreen';
import { StorySettingsScreen } from '../features/stories/settings/StorySettingsScreen';
import { AudienceListScreen } from '../features/stories/settings/AudienceListScreen';
import { MutedAccountsScreen } from '../features/stories/settings/MutedAccountsScreen';
import { FollowListScreen } from '../features/stories/settings/FollowListScreen';
import { ArchiveScreen } from '../features/stories/archive/ArchiveScreen';
import { ArchiveCalendar } from '../features/stories/archive/ArchiveCalendar';
import { ActiveSessionsScreen } from '../screens/main/ActiveSessionsScreen';
import { AccountScreen } from '../screens/main/AccountScreen';
import { AppSettingsScreen } from '../screens/main/AppSettingsScreen';
import { ActivityStatusScreen } from '../screens/main/ActivityStatusScreen';
import { BlockedAccountsScreen } from '../screens/main/BlockedAccountsScreen';
import { MessageSearchScreen } from '../screens/main/MessageSearchScreen';
import { ChatProfileScreen } from '../features/chat/screens/ChatProfileScreen';
import { SharedMediaScreen } from '../features/chat/screens/SharedMediaScreen';
import { ChatDownloadsScreen } from '../features/chat/screens/ChatDownloadsScreen';
import { ChatListScreen } from '../screens/main/ChatListScreen';

const linking = {
  prefixes: ['http://localhost:8081', 'iemdating://'],
  async getInitialURL() {
    const url = await Linking.getInitialURL();
    if (url?.startsWith('iemdating://design-preview')) return null;
    if (url) {
      recordOpenFromUrl(url);
      return url;
    }
    // Opened by tapping a notification while the app was closed.
    const response = Notifications.getLastNotificationResponse();
    return response ? urlForResponse(response) : null;
  },
  subscribe(listener: (url: string) => void) {
    const link = Linking.addEventListener('url', ({ url }) => {
      if (url.startsWith('iemdating://design-preview')) return;
      recordOpenFromUrl(url);
      listener(url);
    });
    const notification = Notifications.addNotificationResponseReceivedListener((response) => {
      const url = urlForResponse(response);
      if (url) listener(url);
    });
    return () => { link.remove(); notification.remove(); };
  },
  config: {
    screens: {
      Auth: {
        path: '',
        screens: {
          Welcome: 'Welcome',
          Login: 'Login',
          SignUp: 'SignUp',
          LifestyleHabits: 'LifestyleHabits',
          CollegeSelection: 'CollegeSelection',
          BirthdaySelection: 'BirthdaySelection',
          GenderSelection: 'GenderSelection',
          OrientationSelection: 'OrientationSelection',
          NameSelection: 'NameSelection',
          SeekingSelection: 'SeekingSelection',
          DistancePreference: 'DistancePreference',
          HouseRules: 'HouseRules',
          PersonalityTraits: 'PersonalityTraits',
          Interests: 'Interests',
          ShareMore: 'ShareMore',
          FaceVerificationInfo: 'FaceVerificationInfo',
          MatchingPreferences: 'MatchingPreferences',
          OnboardingReview: 'OnboardingReview',
          AcademicSelection: 'AcademicSelection',
          CampusSelection: 'CampusSelection',
          BatchSelection: 'BatchSelection',
          SocialSelection: 'SocialSelection',
          SignUpOTP: 'SignUpOTP',
          OTPVerification: 'OTPVerification',
          PasswordRecovery: 'PasswordRecovery',
          PhotoUpload: 'onboarding/media',
          RealPersonCheck: 'onboarding/face-check',
        }
      },
      Main: {
        path: 'main',
        screens: {
          Dashboard: 'Dashboard',
          Profile: 'Profile',
          Chats: 'Chats',
          // iemdating://main/matches?tab=likes - the Likes and Roses pushes.
          Matches: 'matches',
        }
      },
      PhotoUpload: 'PhotoUpload',
      ChatScreen: 'chat/:matchId',
      StoryViewer: 'stories/:storyId',
      FollowRequests: 'stories/follow-requests',
      LikesYou: 'likes-you',
      Standouts: 'standouts',
      StandoutsInfo: 'standouts/about',
      Notifications: 'notifications',
      LocationSettings: 'settings/location',
      Map: 'map',
      EditProfile: 'EditProfile',
      EditGender: 'EditGender',
      EditSeeking: 'EditSeeking',
      EditCollege: 'EditCollege',
      EditDepartment: 'EditDepartment',
      EditDegree: 'EditDegree',
      EditStudies: 'EditStudies',
      EditBatch: 'EditBatch',
      EditCampus: 'EditCampus',
      EditDistance: 'EditDistance',
      EditAttendanceMood: 'EditAttendanceMood',
      EditBirthday: 'EditBirthday',
      EditOrientation: 'EditOrientation',
      EditSocial: 'EditSocial',
      EditLifestyle: 'EditLifestyle',
      EditPersonality: 'EditPersonality',
      EditInterests: 'EditInterests',
      EditBio: 'EditBio',
      EditHeight: 'EditHeight',
      EditResidency: 'EditResidency',
      EditYear: 'EditYear',
      Settings: 'Settings',
      Account: 'settings/account',
      VerifyCollege: 'verify',
      ...(__DEV__ ? {DiscoveryTransitionReplay: 'discovery-transition', MapIntroductionReplay: 'map-introduction-preview', ReminderPreview: 'reminders-preview', TeachingArtworkPreview: 'teaching-artwork', MatchCelebration: 'match-preview'} : {}),
      RealPersonCheck: 'verify/real-person',
      AppSettings: 'settings/app',
      ActivityStatus: 'settings/activity',
      ActiveSessions: 'settings/sessions',
      NotificationHelp: 'settings/notification-help',
      BlockedAccounts: 'settings/blocked',
      MessageSearch: 'messages/search',
      ChatProfile: 'chat/:matchId/info',
      SharedMedia: 'chat/:matchId/media',
      ChatDownloads: 'downloads',
    }
  }
};

// The last errors, for a bug report's technical details (docs/FEEDBACK.md).
installErrorMemory();

export const RootNavigator = () => {
  const arrival = useSyncExternalStore(subscribeDiscoveryArrival, getDiscoveryArrival);
  const newcomerTeaching = useSyncExternalStore(subscribeNewcomerTeaching, getNewcomerTeachingActive);
  const dispatch = useDispatch();
  const reducedMotion = useReducedMotion();
  const [bootstrapping, setBootstrapping] = useState(true);
  // Started offline with a saved session: renew it once the network is back.
  const [renewPending, setRenewPending] = useState(false);
  const isAuthenticated = useSelector((state: RootState) => state.auth.isAuthenticated);
  // Bug reports that waited for a signal, and when to ask for a rating (docs/FEEDBACK.md).
  useEffect(() => { if (isAuthenticated) { startQueue(); startEngagementTracking(); } }, [isAuthenticated]);
  const deletionPending = useSelector((state: RootState) => state.auth.user?.accountStatus === 'deletion_pending');
  const accountGoodbye = useAccountGoodbye();
  // An account that hasn't agreed to the current Terms agrees before the app opens (features/legal).
  const needsTerms = useSelector((state: RootState) => ((state.auth.user as { termsVersion?: number } | null)?.termsVersion ?? 0) < LEGAL_VERSION);
  const token = useSelector((state: RootState) => state.auth.token);
  const nextRequiredStep = useSelector((state: RootState) => state.auth.nextRequiredStep);
  const authUser = useSelector((state: RootState) => state.auth.user);
  useEffect(() => {
    if (token && authUser?.googleSub && nextRequiredStep === 'studentVerification') {
      dispatch(setNextRequiredStep(resolveOnboardingStep(authUser, nextRequiredStep)));
    }
  }, [token, authUser, nextRequiredStep, dispatch]);
  const onboardingStep = useSelector((state: RootState) => state.auth.onboardingDraft?.step);
  // A session on this phone: the token, or - started offline or with the
  // server down - a saved sign-in still waiting to renew (renewPending). The
  // token is never stored, so after the app was closed or swiped away it is
  // only back once /auth/refresh answers; till then someone mid sign-up must
  // still open on the page they left, not on Welcome.
  const hasSession = !!token || renewPending;
  const hasDraft = hasSession && onboardingStep !== undefined;
  const needsDiscoveryPreferences = useSelector((state: RootState) =>
    hasSession && (
      state.auth.nextRequiredStep === 'discoveryPreferences' ||
      (state.auth.isAuthenticated && !state.auth.user?.preferencesConfirmedAt)
    )
  );
  useEffect(() => {
    let active = true;
    (async () => {
      if (token) {
        // A signed-in state without its refresh token is a restored copy, not
        // a session: Android backs up app storage and puts it back after a
        // reinstall, but the refresh token lives in secure storage, which is
        // never backed up. Treat it as signed out.
        if (Platform.OS !== 'web' && !(await credentialStore.getRefreshToken())) {
          const { clearLocalSession } = await import('../services/sessionLogout');
          await clearLocalSession().catch(() => false);
        }
        if (active) setBootstrapping(false);
        return;
      }
      const refreshToken = await credentialStore.getRefreshToken();
      if (!refreshToken) { if (active) setBootstrapping(false); return; }
      try {
        // The shared single refresh (services/api.ts): never two at once.
        const data = await refreshAtStart();
        if (!data) return;
        dispatch(setCredentials({ user: data.user, token: data.accessToken, nextRequiredStep: data.onboarding?.nextRequiredStep, restoreCachedProfile: true }));
      } catch (error: any) {
        // Only the server saying the sign-in is invalid or revoked ends it.
        // No network, a timeout or a server error is not that: the saved
        // session stays, the app opens on what is on the phone (saved chats),
        // and the sign-in is renewed once the connection is back - as
        // WhatsApp and Telegram do. Logging out here used to erase the
        // session on every offline start.
        if ([401, 403].includes(error?.response?.status)) {
          await credentialStore.clear();
          const { resetLocationSession } = await import('../features/location/locationClient');
          resetLocationSession();
          dispatch(logout());
        } else if (active) {
          setRenewPending(true);
        }
      } finally {
        if (active) setBootstrapping(false);
      }
    })();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    void setUpNotifications();
    const stopScreen = watchScreenForChatNotifications();
    const stopToken = watchPushToken();
    return () => { stopScreen(); stopToken(); };
  }, []);
  useEffect(() => {
    if (!isAuthenticated || !token) return;
    // Registers only if notifications are already allowed; asking waits for
    // a good moment (NOTIFICATIONS_PLAN.md 12).
    registerCurrentDeviceForPush().catch(() => undefined);
    // A notification tapped while logged out opens now.
    openPendingPushUrl();
  }, [isAuthenticated, token]);
  // Onboarding done and the profile ready: the first good moment to ask.
  const readyForPrimer = isAuthenticated && !!token && !hasDraft && !needsDiscoveryPreferences && !nextRequiredStep && !arrival.active && !newcomerTeaching;
  useEffect(() => {
    if (!readyForPrimer) return;
    const timer = setTimeout(() => void askAtMoment({ kind: 'onboarding' }), 2500);
    return () => clearTimeout(timer);
  }, [readyForPrimer]);
  // Shared from another app (MESSAGE_NOTIFICATIONS_PLAN.md 12): straight to that
  // chat ("Share to Riya"), or pick one. At start, and while the app is open.
  useEffect(() => {
    if (!readyForPrimer) return;
    const open = () => {
      const share = takeSharedContent();
      if (!share || !navigationRef.isReady()) return;
      const navigate = (navigationRef as any).navigate;
      if (share.matchId) navigate('ChatScreen', { matchId: share.matchId, sharedText: share.text, sharedFile: share.file, sharedMimeType: share.mimeType });
      else navigate('SharePicker', { share });
    };
    const timer = setTimeout(open, 600);
    const subscription = onShared(open);
    return () => { clearTimeout(timer); subscription?.remove(); };
  }, [readyForPrimer]);
  // Pushes arriving late on a phone that holds them back: offer the fix (11).
  useEffect(() => {
    if (!readyForPrimer) return;
    const check = async () => {
      if (!await shouldOfferFix()) return;
      await markFixOffered();
      Alert.alert('Notifications may be late on this phone', 'Your phone is holding back notifications to save battery. Two settings fix it.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Fix it', onPress: () => navigationRef.isReady() && (navigationRef as any).navigate('NotificationHelp') },
      ]);
    };
    const timer = setTimeout(() => void check(), 8000);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void check(); });
    return () => { clearTimeout(timer); subscription.remove(); };
  }, [readyForPrimer]);
  // Renew the offline start's session every 15 s and whenever the app comes
  // back, until it works (or the server says the session is gone).
  useEffect(() => {
    if (!renewPending) return;
    let stopped = false;
    const attempt = async () => {
      if (stopped || store.getState().auth.token) {
        setRenewPending(false);
        return;
      }
      const result = await renewSession();
      if (stopped) return;
      if (result === 'ok') {
        setRenewPending(false);
        // Live again: the chat socket needs the new token to connect.
        const { initSocket } = await import('../services/socket');
        initSocket();
      }
      if (result === 'none') setRenewPending(false);
      if (result === 'invalid') {
        setRenewPending(false);
        await credentialStore.clear();
        const { resetLocationSession } = await import('../features/location/locationClient');
        resetLocationSession();
        dispatch(logout());
      }
    };
    const timer = setInterval(() => void attempt(), 15_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void attempt();
    });
    return () => {
      stopped = true;
      clearInterval(timer);
      subscription.remove();
    };
  }, [renewPending, dispatch]);
  if (bootstrapping) return <View />;
  const needsStudentVerification = hasSession && !authUser?.googleSub && nextRequiredStep === 'studentVerification';
  const needsProfile = hasSession && nextRequiredStep === 'profile';
  // Back in sign-up with no progress on this phone (logged out, reinstalled):
  // with studies and college already saved, only the photo and video are
  // left (OnboardingService), so open there instead of the very first page.
  const detailsDone = !!authUser?.department && !!authUser?.graduationYear && !(authUser?.googleSub && !authUser?.college);
  const profileStart = detailsDone ? 'PhotoUpload' : 'HouseRules';

  return (
    <NavigationContainer ref={navigationRef} linking={linking} theme={navigationTheme}>
      {/*
        A screen that is covered stops re-rendering until it is shown again.
        While a chat is open the whole tab tree behind it - the chat list, the
        deck, the stories tray - was still re-rendering on every store change
        the chat caused, and that work competed with the chat's own. React
        Navigation calls this freezing; it is why leaving a chat now gives the
        list back immediately.
      */}
      <AppErrorBoundary signedIn={isAuthenticated}>
      <Stack.Navigator screenOptions={{ headerShown: false, freezeOnBlur: true, contentStyle: { backgroundColor: '#100F0D' } }}>
        {needsStudentVerification ? (
          <Stack.Screen name="StudentVerification" component={StudentVerificationScreen} />
        ) : hasDraft ? (
          <Stack.Screen name="Auth">{() => <AuthNavigator initialRouteName={onboardingStep!} />}</Stack.Screen>
        ) : needsDiscoveryPreferences ? (
          <Stack.Screen name="RequiredDiscoveryPreferences" component={RequiredDiscoveryPreferencesScreen} />
        ) : isAuthenticated && deletionPending ? (
          // Signed in within the 30 days: keep the account, or leave it to be erased.
          <Stack.Screen name="AccountDeletionPending" component={AccountDeletionPendingScreen} />
        ) : isAuthenticated && needsTerms ? (
          <Stack.Screen name="TermsUpdate" component={TermsUpdateScreen} />
        ) : isAuthenticated ? (
          <Stack.Screen name="Main" component={MainTabNavigator} options={{animation: arrival.active ? 'none' : 'default'}} />
        ) : accountGoodbye ? (
          // Just deleted the account here: goodbye, then Welcome.
          <Stack.Screen name="AccountGoodbye" component={AccountGoodbyeScreen} options={{ animation: 'fade' }} />
        ) : (
          <Stack.Screen name="Auth">
            {() => <AuthNavigator initialRouteName={needsProfile ? profileStart : 'Welcome'} />}
          </Stack.Screen>
        )}
        {/* Screens reachable signed in and out. On logout (no token) the key
            changes, so any of them still open - Settings, Delete account - is
            dropped and the person lands on Welcome, not left on a dead screen. */}
        <Stack.Group navigationKey={token ? 'account' : 'guest'}>
        {__DEV__ && <Stack.Screen name="MapIntroductionReplay" component={require('../development/MapIntroductionReplay').MapIntroductionReplay} options={{animation: 'none'}} />}
        {__DEV__ && <Stack.Screen name="ReminderPreview" component={require('../development/ReminderPreview').ReminderPreview} options={{animation: 'none'}} />}
        {__DEV__ && <Stack.Screen name="TeachingArtworkPreview" component={require('../development/TeachingArtworkPreviewScreen').TeachingArtworkPreviewScreen} options={{animation: 'none'}} />}
        {__DEV__ && <Stack.Screen name="DiscoveryTransitionReplay" component={require('../development/DiscoveryTransitionReplay').DiscoveryTransitionReplay} options={{animation: 'none'}} />}
      <Stack.Screen name="PhotoMediaOptions" component={PhotoMediaSheet} options={{
        presentation: 'formSheet', sheetAllowedDetents: 'fitToContents', sheetInitialDetentIndex: 0,
        sheetGrabberVisible: true, sheetCornerRadius: 28, sheetShouldOverflowTopInset: false,
        contentStyle: {backgroundColor: '#F2F3EE'},
      }}/>
        <Stack.Screen name="PhotoUpload" component={PhotoUploadScreen} />
        {/* The published documents and the Safety Centre (docs/SAFETY_AND_LEGAL.md 6), and reporting after a chat ended. */}
        <Stack.Screen name="Legal" component={LegalScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="ReportSomeone" component={ReportSomeoneScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="HiddenWords" component={HiddenWordsScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="ShareDate" component={ShareDateScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="Nominee" component={NomineeScreen} options={{ animation: 'slide_from_right' }} />
        {/* Every other route here declares its animation; without one this
            screen fell back to the platform transition, which scales the
            incoming content - the message bubbles visibly grew and settled on
            every open. A slide has no scale. */}
        <Stack.Screen name="MatchCelebration" component={MatchCelebrationScreen} options={{ animation: reducedMotion ? 'none' : 'fade', contentStyle: {backgroundColor: '#100F0D'} }} />
        <Stack.Screen name="ChatScreen" component={ChatScreen} options={{ animation: 'none' }} />
        <Stack.Screen name="ChatAttachments" component={ChatAttachmentsScreen} options={{
          presentation: 'formSheet', sheetAllowedDetents: [0.75, 0.95], sheetInitialDetentIndex: 0,
          sheetGrabberVisible: true, sheetCornerRadius: 28, sheetShouldOverflowTopInset: false,
          contentStyle: { backgroundColor: '#242321' },
        }} />
        <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="ProfilePreview" component={ProfilePreviewScreen} options={{
          animation: reducedMotion ? 'none' : 'slide_from_bottom', animationDuration: 280,
          gestureDirection: 'vertical', fullScreenGestureEnabled: false,
          animationMatchesGesture: true, gestureEnabled: !reducedMotion,
        }} />
        <Stack.Screen name="EditGender" component={EditGenderScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="ProfileGenderLabels" component={ProfileGenderLabelsSheet} options={{
          presentation: 'formSheet', sheetAllowedDetents: [0.65, 0.9], sheetInitialDetentIndex: 1,
          sheetGrabberVisible: true, sheetCornerRadius: 28, sheetShouldOverflowTopInset: false,
          contentStyle: {backgroundColor: '#242321'},
        }}/>
        <Stack.Screen name="EditSeeking" component={EditSeekingScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditCollege" component={EditCollegeScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditDepartment" component={EditDepartmentScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditStudies" component={EditStudiesScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="ProfileDegreeOptions" component={ProfileDegreeOptionsSheet} options={{
          presentation: 'formSheet', sheetAllowedDetents: [0.65, 0.9], sheetInitialDetentIndex: 0,
          sheetGrabberVisible: true, sheetCornerRadius: 28, sheetShouldOverflowTopInset: false,
          contentStyle: {backgroundColor: '#242321'},
        }}/>
        <Stack.Screen name="EditDegree" component={EditStudiesScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditBatch" component={EditStudiesScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditCampus" component={EditCampusScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditDistance" component={EditDistanceScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditAttendanceMood" component={EditAttendanceMoodScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditBirthday" component={EditBirthdayScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditOrientation" component={EditOrientationScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditSocial" component={EditSocialScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="ProfileClubSelection" component={ProfileClubSelectionSheet} options={{
          presentation: 'formSheet', sheetAllowedDetents: [0.65, 0.9], sheetInitialDetentIndex: 0,
          sheetGrabberVisible: true, sheetCornerRadius: 28, sheetShouldOverflowTopInset: false,
          contentStyle: {backgroundColor: '#242321'},
        }}/>
        <Stack.Screen name="EditLifestyle" component={EditLifestyleScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditPersonality" component={EditPersonalityScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="ProfileTopicOptions" component={ProfileTopicOptionsSheet} options={({route}) => ({
          presentation: 'formSheet',
          sheetAllowedDetents: ['pets', 'star_sign', 'communication'].includes((route.params as {id?: string} | undefined)?.id || '') ? [0.65, 0.9] : 'fitToContents',
          sheetInitialDetentIndex: 0, sheetGrabberVisible: true, sheetCornerRadius: 28,
          sheetShouldOverflowTopInset: false, contentStyle: {backgroundColor: '#242321'},
        })}/>
        <Stack.Screen name="EditInterests" component={EditInterestsScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="ProfileInterestSelectionReview" component={ProfileInterestSelectionReviewSheet} options={{
          presentation: 'formSheet', sheetAllowedDetents: [0.65, 0.9], sheetInitialDetentIndex: 0,
          sheetGrabberVisible: true, sheetCornerRadius: 28, sheetShouldOverflowTopInset: false,
          contentStyle: {backgroundColor: '#242321'},
        }}/>
        <Stack.Screen name="EditBio" component={EditBioScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditHeight" component={EditHeightScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="LogoutSheet" component={LogoutSheet} options={{
          presentation: 'formSheet', sheetAllowedDetents: 'fitToContents', sheetGrabberVisible: true,
          sheetCornerRadius: 24, sheetElevation: 0, sheetShouldOverflowTopInset: false,
          contentStyle: { backgroundColor: '#232323' },
        }} />
        <Stack.Screen name="DiscardChanges" component={DiscardChangesSheet} options={{
          presentation: 'formSheet', sheetAllowedDetents: 'fitToContents', sheetGrabberVisible: true,
          sheetCornerRadius: 24, sheetElevation: 0, sheetShouldOverflowTopInset: false,
          contentStyle: { backgroundColor: '#232323' },
        }} />
        <Stack.Screen name="ProfilePhotoOptions" component={ProfilePhotoOptionsSheet} options={{
          presentation: 'formSheet', sheetAllowedDetents: 'fitToContents', sheetGrabberVisible: true,
          sheetCornerRadius: 24, sheetElevation: 0, sheetShouldOverflowTopInset: false,
          contentStyle: { backgroundColor: '#2D2B29' },
        }} />
        <Stack.Screen name="ProfileVideoSource" component={ProfileVideoSourceSheet} options={{
          presentation: 'formSheet', sheetAllowedDetents: 'fitToContents', sheetGrabberVisible: true,
          sheetCornerRadius: 24, sheetElevation: 0, sheetShouldOverflowTopInset: false,
          contentStyle: { backgroundColor: '#232323' },
        }} />
        <Stack.Screen name="ProfileProgress" component={ProfileProgressSheet} options={{
          presentation: 'formSheet', sheetAllowedDetents: 'fitToContents', sheetGrabberVisible: true,
          sheetCornerRadius: 24, sheetElevation: 0, sheetShouldOverflowTopInset: false,
          contentStyle: { backgroundColor: '#222222' },
        }} />
        <Stack.Screen name="EditResidency" component={EditResidencyScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditYear" component={EditStudiesScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="HowItWorks" component={HowItWorksScreen} options={{ animation: 'slide_from_right', contentStyle: { backgroundColor: '#100F0D' } }} />
        <Stack.Screen name="SwipeLesson" component={SwipeLessonScreen} options={{ animation: 'fade', contentStyle: { backgroundColor: '#100F0D' } }} />
        {/* Camera to editor in one screen; its own back handling asks before discarding edits. */}
        <Stack.Screen name="CreateStory" component={StoryCreatorScreen} options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
        {/* Transparent, so the screen underneath shows while a Story is swiped down to close. */}
        <Stack.Screen name="StoryViewer" component={StoryViewerScreen} options={{ presentation: 'transparentModal', animation: 'none', gestureEnabled: false }} />
        <Stack.Screen name="FollowRequests" component={FollowRequestsScreen} />
        <Stack.Screen name="LikesYou" component={LikesYouScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="Standouts" component={StandoutsScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="StandoutsInfo" component={StandoutsInfoScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="Preferences" component={PreferencesScreen} options={{
          // Android's ios_from_right uses the short native duration. The
          // animationDuration option applies only to iOS.
          animation: Platform.OS === 'android' ? 'ios_from_right' : 'simple_push',
          animationDuration: 250,
        }} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ animation: 'fade', animationDuration: 180 }} />
        <Stack.Screen name="LocationSettings" component={LocationSettingsScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="Map" component={MapScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="StorySettings" component={StorySettingsScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="StoryAudienceList" component={AudienceListScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="StoryMutedAccounts" component={MutedAccountsScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="StoryFollowList" component={FollowListScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="StoryArchive" component={ArchiveScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="StoryArchiveCalendar" component={ArchiveCalendar} options={{
          presentation: 'formSheet', sheetAllowedDetents: 'fitToContents', sheetGrabberVisible: true,
          sheetCornerRadius: 24, sheetElevation: 0, sheetShouldOverflowTopInset: false,
          contentStyle: { backgroundColor: '#232323' },
        }} />
        <Stack.Screen name="Account" component={AccountScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="DeleteAccount" component={DeleteAccountScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="DataExport" component={DataExportScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} options={{ animation: 'slide_from_right' }} />
        {/* Verify your college from anywhere: Settings, the profile, a reminder (GOOGLE_SIGNUP_PLAN.md 4). */}
        <Stack.Screen name="VerifyCollege" component={StudentVerificationScreen} options={{ animation: 'slide_from_bottom' }} />
        {/* A limit: a bottom sheet that draws its own slide (VerifyRulesScreen.tsx). */}
        <Stack.Screen name="VerifyRules" component={VerifyRulesScreen} options={{ presentation: 'transparentModal', animation: 'none' }} />
        {/* The real-person check: a live selfie matched with your photos (PHOTO_VERIFICATION_PLAN.md). */}
        <Stack.Screen name="RealPersonCheck" component={RealPersonCheckScreen} options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
        <Stack.Screen name="AppSettings" component={AppSettingsScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="ActivityStatus" component={ActivityStatusScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="ActiveSessions" component={ActiveSessionsScreen} />
        <Stack.Screen name="NotificationHelp" component={NotificationHelpScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="SharePicker" component={SharePickerScreen} options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="BlockedAccounts" component={BlockedAccountsScreen} />
        <Stack.Screen name="MessageSearch" component={MessageSearchScreen} />
        <Stack.Screen name="ChatProfile" component={ChatProfileScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="SharedMedia" component={SharedMediaScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="ChatDownloads" component={ChatDownloadsScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="ArchivedChats" component={ChatListScreen} initialParams={{ folder: 'archived' }} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="ReportProblem" component={ReportProblemScreen} options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="MyReports" component={MyReportsScreen} options={{ animation: 'slide_from_right' }} />
        </Stack.Group>
      </Stack.Navigator>
      </AppErrorBoundary>
      {/* Reporting, the same sheet from every screen (features/safety/ReportSheet.tsx). */}
      <ReportHost />
      <PermissionPrimer />
      {isAuthenticated && <BadgeSync />}
      {isAuthenticated && <ShakeToReportHost />}
      {isAuthenticated && <RatingPromptHost />}
    </NavigationContainer>
  );
};

/** The number on the app icon: unread notifications (NOTIFICATIONS_PLAN.md 7). */
function BadgeSync() {
  const { unread } = useUnreadNotifications();
  useEffect(() => {
    Notifications.setBadgeCountAsync(unread.total).catch(() => undefined);
  }, [unread.total]);
  return null;
}
