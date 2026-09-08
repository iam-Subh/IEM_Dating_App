import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { WelcomeScreen } from '../features/auth/screens/WelcomeScreen';
import { LoginScreen } from '../features/auth/screens/LoginScreen';
import { OTPScreen } from '../features/auth/screens/OTPScreen';
import { SignUpScreen } from '../features/auth/screens/SignUpScreen';
import { SignUpOTPScreen } from '../features/auth/screens/SignUpOTPScreen';
import { PhoneLoginScreen } from '../features/auth/screens/PhoneLoginScreen';
import { PhoneOTPScreen } from '../features/auth/screens/PhoneOTPScreen';
import { HouseRulesScreen } from '../features/auth/screens/HouseRulesScreen';
import { NameSelectionScreen } from '../features/auth/screens/NameSelectionScreen';
import { BirthdaySelectionScreen } from '../features/auth/screens/BirthdaySelectionScreen';
import { GenderSelectionScreen } from '../features/auth/screens/GenderSelectionScreen';
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

const Stack = createNativeStackNavigator();

export const AuthNavigator = ({ initialRouteName = 'Welcome' }: { initialRouteName?: string }) => {
  return (
    <Stack.Navigator initialRouteName={initialRouteName} screenOptions={{ headerShown: false }}>
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
        name="PhoneLogin"
        component={PhoneLoginScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="PhoneOTPVerification"
        component={PhoneOTPScreen}
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
      <Stack.Screen
        name="OrientationSelection"
        component={OrientationSelectionScreen}
        options={{ animation: 'slide_from_right' }}
      />
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
