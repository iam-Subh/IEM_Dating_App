import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store';
import { Text, View } from 'react-native';
import { Linking } from 'react-native';
import * as Notifications from 'expo-notifications';

const Stack = createNativeStackNavigator();

import { AuthNavigator } from './AuthNavigator';
import { MainTabNavigator } from './MainTabNavigator';
import { PhotoUploadScreen } from '../features/auth/screens/PhotoUploadScreen';
import { ChatScreen } from '../features/chat/screens/ChatScreen';
import { EditProfileScreen } from '../screens/main/EditProfileScreen';
import { SettingsScreen } from '../screens/main/SettingsScreen';
import { EditGenderScreen } from '../screens/main/edit/EditGenderScreen';
import { EditSeekingScreen } from '../screens/main/edit/EditSeekingScreen';
import { EditCollegeScreen } from '../screens/main/edit/EditCollegeScreen';
import { EditDepartmentScreen } from '../screens/main/edit/EditDepartmentScreen';
import { EditBatchScreen } from '../screens/main/edit/EditBatchScreen';
import { EditCampusScreen } from '../screens/main/edit/EditCampusScreen';
import { EditDistanceScreen } from '../screens/main/edit/EditDistanceScreen';
import { EditAttendanceMoodScreen } from '../screens/main/edit/EditAttendanceMoodScreen';
import { EditBirthdayScreen } from '../screens/main/edit/EditBirthdayScreen';
import { EditOrientationScreen } from '../screens/main/edit/EditOrientationScreen';
import { EditSocialScreen } from '../screens/main/edit/EditSocialScreen';
import { EditLifestyleScreen } from '../screens/main/edit/EditLifestyleScreen';
import { EditPersonalityScreen } from '../screens/main/edit/EditPersonalityScreen';
import { EditInterestsScreen } from '../screens/main/edit/EditInterestsScreen';
import { EditBioScreen } from '../screens/main/edit/EditBioScreen';
import { EditHeightScreen } from '../screens/main/edit/EditHeightScreen';
import { EditResidencyScreen } from '../screens/main/edit/EditResidencyScreen';
import { EditYearScreen } from '../screens/main/edit/EditYearScreen';
import { RequiredDiscoveryPreferencesScreen } from '../features/auth/screens/RequiredDiscoveryPreferencesScreen';
import { StudentVerificationScreen } from '../features/auth/screens/StudentVerificationScreen';
import { api } from '../services/api';
import { credentialStore } from '../services/credentialStore';
import { logout, setCredentials } from '../store/authSlice';
import { registerCurrentDeviceForPush } from '../services/notifications';
import { CreateStoryScreen } from '../screens/main/CreateStoryScreen';
import { StoryViewerScreen } from '../screens/main/StoryViewerScreen';
import { FollowRequestsScreen } from '../screens/main/FollowRequestsScreen';
import { ActiveSessionsScreen } from '../screens/main/ActiveSessionsScreen';
import { BlockedAccountsScreen } from '../screens/main/BlockedAccountsScreen';
import { MessageSearchScreen } from '../screens/main/MessageSearchScreen';

const linking = {
  prefixes: ['http://localhost:8081', 'iemdating://'],
  async getInitialURL() {
    const url = await Linking.getInitialURL();
    if (url) return url;
    const response = Notifications.getLastNotificationResponse();
    const notificationUrl = response?.notification.request.content.data?.url;
    return typeof notificationUrl === 'string' ? notificationUrl : null;
  },
  subscribe(listener: (url: string) => void) {
    const link = Linking.addEventListener('url', ({ url }) => listener(url));
    const notification = Notifications.addNotificationResponseReceivedListener((response) => {
      const url = response.notification.request.content.data?.url;
      if (typeof url === 'string') listener(url);
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
        }
      },
      Main: {
        path: 'main',
        screens: {
          Dashboard: 'Dashboard',
          Profile: 'Profile',
          Chats: 'Chats',
        }
      },
      PhotoUpload: 'PhotoUpload',
      ChatScreen: 'chat/:matchId',
      StoryViewer: 'stories/:storyId',
      FollowRequests: 'stories/follow-requests',
      EditProfile: 'EditProfile',
      EditGender: 'EditGender',
      EditSeeking: 'EditSeeking',
      EditCollege: 'EditCollege',
      EditDepartment: 'EditDepartment',
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
      ActiveSessions: 'settings/sessions',
      BlockedAccounts: 'settings/blocked',
      MessageSearch: 'messages/search',
    }
  }
};

export const RootNavigator = () => {
  const dispatch = useDispatch();
  const [bootstrapping, setBootstrapping] = useState(true);
  const isAuthenticated = useSelector((state: RootState) => state.auth.isAuthenticated);
  const token = useSelector((state: RootState) => state.auth.token);
  const nextRequiredStep = useSelector((state: RootState) => state.auth.nextRequiredStep);
  useEffect(() => {
    let active = true;
    (async () => {
      if (token) { if (active) setBootstrapping(false); return; }
      const refreshToken = await credentialStore.getRefreshToken();
      if (!refreshToken) { if (active) setBootstrapping(false); return; }
      try {
        const response = await api.post('/auth/refresh', { refreshToken });
        const data = response.data.data;
        await credentialStore.setRefreshToken(data.refreshToken);
        dispatch(setCredentials({ user: data.user, token: data.accessToken, nextRequiredStep: data.onboarding?.nextRequiredStep }));
      } catch {
        await credentialStore.clear();
        dispatch(logout());
      } finally {
        if (active) setBootstrapping(false);
      }
    })();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!isAuthenticated || !token) return;
    registerCurrentDeviceForPush().catch(() => undefined);
  }, [isAuthenticated, token]);
  if (bootstrapping) return <View />;
  const needsStudentVerification = !!token && nextRequiredStep === 'studentVerification';
  const needsProfile = !!token && nextRequiredStep === 'profile';
  const needsDiscoveryPreferences = useSelector((state: RootState) =>
    !!state.auth.token && (
      state.auth.nextRequiredStep === 'discoveryPreferences' ||
      (state.auth.isAuthenticated && !state.auth.user?.preferencesConfirmedAt)
    )
  );

  return (
    <NavigationContainer linking={linking}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {needsStudentVerification ? (
          <Stack.Screen name="StudentVerification" component={StudentVerificationScreen} />
        ) : needsDiscoveryPreferences ? (
          <Stack.Screen name="RequiredDiscoveryPreferences" component={RequiredDiscoveryPreferencesScreen} />
        ) : isAuthenticated ? (
          <Stack.Screen name="Main" component={MainTabNavigator} />
        ) : (
          <Stack.Screen name="Auth">
            {() => <AuthNavigator initialRouteName={needsProfile ? 'HouseRules' : 'Welcome'} />}
          </Stack.Screen>
        )}
        <Stack.Screen name="PhotoUpload" component={PhotoUploadScreen} />
        <Stack.Screen name="ChatScreen" component={ChatScreen} />
        <Stack.Screen name="EditProfile" component={EditProfileScreen} />
        <Stack.Screen name="EditGender" component={EditGenderScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditSeeking" component={EditSeekingScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditCollege" component={EditCollegeScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditDepartment" component={EditDepartmentScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditBatch" component={EditBatchScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditCampus" component={EditCampusScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditDistance" component={EditDistanceScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditAttendanceMood" component={EditAttendanceMoodScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditBirthday" component={EditBirthdayScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditOrientation" component={EditOrientationScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditSocial" component={EditSocialScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditLifestyle" component={EditLifestyleScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditPersonality" component={EditPersonalityScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditInterests" component={EditInterestsScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditBio" component={EditBioScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditHeight" component={EditHeightScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditResidency" component={EditResidencyScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="EditYear" component={EditYearScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="CreateStory" component={CreateStoryScreen} />
        <Stack.Screen name="StoryViewer" component={StoryViewerScreen} />
        <Stack.Screen name="FollowRequests" component={FollowRequestsScreen} />
        <Stack.Screen name="ActiveSessions" component={ActiveSessionsScreen} />
        <Stack.Screen name="BlockedAccounts" component={BlockedAccountsScreen} />
        <Stack.Screen name="MessageSearch" component={MessageSearchScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

