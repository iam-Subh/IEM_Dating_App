import {PhotoMediaSheet} from '../features/auth/onboarding/PhotoIntroduction';
import {MatchingOptionsSheet} from '../features/discovery/components/MatchingIntroduction';
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { WelcomeScreen } from '../features/auth/screens/WelcomeScreen';
import { LoginScreen } from '../features/auth/screens/LoginScreen';
import { OTPScreen } from '../features/auth/screens/OTPScreen';
import { SignUpScreen } from '../features/auth/screens/SignUpScreen';
import { SignUpOTPScreen } from '../features/auth/screens/SignUpOTPScreen';
import { HouseRulesScreen } from '../features/auth/screens/HouseRulesScreen';
import { NameSelectionScreen } from '../features/auth/screens/NameSelectionScreen';
import { BirthdaySelectionScreen } from '../features/auth/screens/BirthdaySelectionScreen';
import { GenderSelectionScreen } from '../features/auth/screens/GenderSelectionScreen';
import { GenderLabelsSheet } from '../features/auth/onboarding/GenderIntroduction';
import { AcademicOptionsSheet } from '../features/auth/onboarding/AcademicIntroduction';
import {OrientationDefinitionsSheet} from '../features/auth/onboarding/OrientationIntroduction';
import {InterestSelectionReviewSheet} from '../features/auth/onboarding/InterestIntroduction';
import {LifestyleOptionsSheet} from '../features/auth/onboarding/LifestyleIntroduction';
import {SocialPlacesSheet} from '../features/auth/onboarding/SocialIntroduction';
import {PersonalityOptionsSheet} from '../features/auth/onboarding/PersonalityIntroduction';
import { OrientationSelectionScreen } from '../features/auth/screens/OrientationSelectionScreen';
import { DistancePreferenceScreen } from '../features/auth/screens/DistancePreferenceScreen';
import { SeekingSelectionScreen } from '../features/auth/screens/SeekingSelectionScreen';
import { CollegeSelectionScreen } from '../features/auth/screens/CollegeSelectionScreen';
import { LifestyleHabitsScreen } from '../features/auth/screens/LifestyleHabitsScreen';
import { PersonalityTraitsScreen } from "../features/auth/screens/PersonalityTraitsScreen";
import { InterestsScreen } from "../features/auth/screens/InterestsScreen";
import { ShareMoreScreen } from "../features/auth/screens/ShareMoreScreen";
import { AcademicSelectionScreen } from '../features/auth/screens/AcademicSelectionScreen';
import { BatchSelectionScreen } from '../features/auth/screens/BatchSelectionScreen';
import { CampusSelectionScreen } from '../features/auth/screens/CampusSelectionScreen';
import { SocialSelectionScreen } from '../features/auth/screens/SocialSelectionScreen';
import { FaceVerificationInfoScreen } from '../features/auth/screens/FaceVerificationInfoScreen';
import { PhotoUploadScreen } from '../features/auth/screens/PhotoUploadScreen';
import { PasswordRecoveryScreen } from '../features/auth/screens/PasswordRecoveryScreen';

import { MatchingPreferencesScreen, OnboardingReviewScreen } from '../features/auth/onboarding/ProfileScreens';
import { RealPersonCheckScreen } from '../features/verification/RealPersonCheckScreen';
const Stack = createNativeStackNavigator();

export const AuthNavigator = ({ initialRouteName = 'Welcome', previewScreens }: { initialRouteName?: string; previewScreens?: Record<string, React.ComponentType<any>> }) => {
  return (
    <Stack.Navigator initialRouteName={initialRouteName} screenOptions={{ headerShown: false, freezeOnBlur:true, contentStyle: { backgroundColor: '#F2F3EE' } }}>
      <Stack.Screen name="PhotoMediaOptions" component={PhotoMediaSheet} options={{
        presentation: 'formSheet', sheetAllowedDetents: 'fitToContents', sheetInitialDetentIndex: 0,
        sheetGrabberVisible: true, sheetCornerRadius: 28, sheetShouldOverflowTopInset: false,
        contentStyle: {backgroundColor: '#F2F3EE'},
      }}/>
      <Stack.Screen name="MatchingPreferences" component={MatchingPreferencesScreen} />
      <Stack.Screen name="OnboardingReview" component={OnboardingReviewScreen} options={{freezeOnBlur: true, contentStyle: {backgroundColor: '#F2F3EE'}}} />
      <Stack.Screen name="RealPersonCheck" component={__DEV__ ? previewScreens?.RealPersonCheck ?? RealPersonCheckScreen : RealPersonCheckScreen} />
      {__DEV__ && Object.entries(previewScreens ?? {}).filter(([name]) => name !== 'RealPersonCheck').map(([name, component]) => <Stack.Screen key={name} name={name} component={component}/>)}
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="PasswordRecovery" component={PasswordRecoveryScreen} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen
        name="OTPVerification"
        component={OTPScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="SignUp"
        component={SignUpScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="SignUpOTP"
        component={SignUpOTPScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="HouseRules"
        component={HouseRulesScreen}
        options={{ animation: 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="NameSelection"
        component={NameSelectionScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="BirthdaySelection"
        component={BirthdaySelectionScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="GenderSelection"
        component={GenderSelectionScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen name="GenderLabels" component={GenderLabelsSheet} options={{
        presentation: 'formSheet', sheetAllowedDetents: [0.65, 0.9], sheetInitialDetentIndex: 1, sheetGrabberVisible: true,
        sheetCornerRadius: 28, sheetShouldOverflowTopInset: false,
        contentStyle: { backgroundColor: '#F2F3EE' },
      }} />
      <Stack.Screen
        name="OrientationSelection"
        component={OrientationSelectionScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen name="OrientationDefinitions" component={OrientationDefinitionsSheet} options={{
        presentation: 'formSheet', sheetAllowedDetents: [0.65, 0.9], sheetInitialDetentIndex: 1, sheetGrabberVisible: true,
        sheetCornerRadius: 28, sheetShouldOverflowTopInset: false,
        contentStyle: {backgroundColor: '#F2F3EE'},
      }} />
      <Stack.Screen name="InterestSelectionReview" component={InterestSelectionReviewSheet} options={{
        presentation: 'formSheet', sheetAllowedDetents: [0.65, 0.9], sheetInitialDetentIndex: 0, sheetGrabberVisible: true,
        sheetCornerRadius: 28, sheetShouldOverflowTopInset: false,
        contentStyle: {backgroundColor: '#F2F3EE'},
      }} />
      <Stack.Screen name="LifestyleOptions" component={LifestyleOptionsSheet} options={({route}) => ({
        presentation: 'formSheet', sheetAllowedDetents: (route.params as {id?: string} | undefined)?.id === 'pets' ? [0.7] : 'fitToContents', sheetInitialDetentIndex: 0, sheetGrabberVisible: true,
        sheetCornerRadius: 28, sheetShouldOverflowTopInset: false,
        contentStyle: {backgroundColor: '#F2F3EE'},
      })} />
      <Stack.Screen name="MatchingOptions" component={MatchingOptionsSheet} options={{
        presentation: 'formSheet', sheetAllowedDetents: [0.55], sheetInitialDetentIndex: 0,
        sheetGrabberVisible: true, sheetCornerRadius: 28, sheetShouldOverflowTopInset: false,
        contentStyle: {backgroundColor: '#F2F3EE'},
      }} />
      <Stack.Screen name="SocialPlaces" component={SocialPlacesSheet} options={{
        presentation: 'formSheet', sheetAllowedDetents: [0.5], sheetInitialDetentIndex: 0,
        sheetGrabberVisible: true, sheetCornerRadius: 28, sheetShouldOverflowTopInset: false,
        contentStyle: {backgroundColor: '#F2F3EE'},
      }} />
      <Stack.Screen name="PersonalityOptions" component={PersonalityOptionsSheet} options={({route}) => ({
        presentation: 'formSheet', sheetAllowedDetents: (route.params as {id?: string} | undefined)?.id === 'communication' ? [0.78] : (route.params as {id?: string} | undefined)?.id === 'star_sign' ? [0.72] : 'fitToContents', sheetInitialDetentIndex: 0, sheetGrabberVisible: true,
        sheetCornerRadius: 28, sheetShouldOverflowTopInset: false,
        contentStyle: {backgroundColor: '#F2F3EE'},
      })} />
      <Stack.Screen
        name="AcademicSelection"
        component={AcademicSelectionScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="BatchSelection"
        component={BatchSelectionScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen name="AcademicOptions" component={AcademicOptionsSheet} options={{
        presentation: 'formSheet', sheetAllowedDetents: [0.65, 0.9], sheetInitialDetentIndex: 1, sheetGrabberVisible: true,
        sheetCornerRadius: 28, sheetShouldOverflowTopInset: false,
        contentStyle: { backgroundColor: '#F2F3EE' },
      }} />
      <Stack.Screen
        name="CampusSelection"
        component={CampusSelectionScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="SocialSelection"
        component={SocialSelectionScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="DistancePreference"
        component={DistancePreferenceScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="SeekingSelection"
        component={SeekingSelectionScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="CollegeSelection"
        component={CollegeSelectionScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="LifestyleHabits"
        component={LifestyleHabitsScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="PersonalityTraits"
        component={PersonalityTraitsScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Interests"
        component={InterestsScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="ShareMore"
        component={ShareMoreScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="FaceVerificationInfo"
        component={FaceVerificationInfoScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="PhotoUpload"
        component={PhotoUploadScreen}
        options={{ animation: 'slide_from_right' }}
      />
    </Stack.Navigator>
  );
};
