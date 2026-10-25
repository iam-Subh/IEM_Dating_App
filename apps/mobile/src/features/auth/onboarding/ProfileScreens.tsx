import React from 'react';
import { View, Text, Pressable, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { completeOnboarding, updateUser } from '../../../store/authSlice';
import { DiscoverySettings } from '../../discovery/components/DiscoverySettings';
import { OnboardingFrame, Field, Choice, Visibility, SectionLabel, Note, ui } from './OnboardingFrame';
import { useOnboarding } from './useOnboarding';
import { profilePhotoUrls } from './profileValues';
import { useFaceStatus } from '../../verification/RealPerson';
import { useVerificationStatus } from '../../verification/useVerificationStatus';
import { rose } from './theme';
export {OrientationIntroduction as OrientationSelectionScreen} from './OrientationIntroduction';
export {InterestIntroduction as InterestsScreen} from './InterestIntroduction';

export function MatchingPreferencesScreen() {
  const o = useOnboarding();
  return <DiscoverySettings visible embedded required onClose={o.back} onSaved={timestamp => {
    o.dispatch(updateUser({ preferencesConfirmedAt: timestamp ?? new Date().toISOString() }));
    o.next('PhotoUpload');
  }} />;
}
export const DistancePreferenceScreen = MatchingPreferencesScreen;

export {ShareMoreIntroduction as ShareMoreScreen} from './ShareMoreIntroduction';
export {LifestyleIntroduction as LifestyleHabitsScreen} from './LifestyleIntroduction';
export {PersonalityIntroduction as PersonalityTraitsScreen} from './PersonalityIntroduction';
export {SocialIntroduction as SocialSelectionScreen} from './SocialIntroduction';
export function FaceVerificationInfoScreen() {
  const o = useOnboarding();
  return <OnboardingFrame stage={3} title={"A profile that\nlooks like you."} subtitle="Add your photos and profile video before the face check." onBack={o.back} onNext={() => o.next('PhotoUpload')}><Text style={ui.detail}>The face check compares a private live selfie with your public profile media.</Text></OnboardingFrame>;
}
export {ProfileReviewIntroduction as OnboardingReviewScreen} from './ProfileReviewIntroduction';

