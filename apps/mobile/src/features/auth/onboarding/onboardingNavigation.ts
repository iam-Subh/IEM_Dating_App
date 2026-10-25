import {StackActions, type NavigationProp, type ParamListBase} from '@react-navigation/native';

/** Close the face check in either the onboarding stack or the root stack. */
export function openOnboardingReview(navigation: Pick<NavigationProp<ParamListBase>, 'getState' | 'dispatch'>) {
  const state = navigation.getState();
  const action = state.routeNames.includes('OnboardingReview')
    ? StackActions.popTo('OnboardingReview')
    : StackActions.popTo('Auth', {screen: 'OnboardingReview'});
  navigation.dispatch({...action, target: state.key});
}
