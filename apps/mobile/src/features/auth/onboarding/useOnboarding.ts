import { useSelector, useDispatch, useStore } from 'react-redux';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { RootState } from '../../../store';
import { saveOnboardingDraft, updateUser } from '../../../store/authSlice';
import { api } from '../../../services/api';
import { previousProfileStep } from './onboardingFlow';
import {afterScreenTransition} from './afterScreenTransition';
import {isOnboardingPreview} from '../../../development/onboardingPreviewRuntime';

export function useOnboarding() {
  const dispatch = useDispatch();
  const activeStore = useStore<RootState>();
  const navigation = useNavigation<any>();
  // Covered pages retain their last snapshot. Refresh it when the page returns.
  // Leaving needs no render: useIsFocused re-rendered the page being left,
  // which for the review page cost half a second on every Edit tap.
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  const left = useRef(false);
  useEffect(() => {
    const blur = navigation.addListener('blur', () => {left.current = true;});
    const focus = navigation.addListener('focus', () => {if (left.current) {left.current = false; refresh();}});
    return () => {blur(); focus();};
  }, [navigation]);
  const focused = navigation.isFocused();
  const selectedAuth = useSelector((state: RootState) => state.auth, (previous, next) => !navigation.isFocused() || (
    previous.user === next.user && previous.token === next.token
    && previous.isAuthenticated === next.isAuthenticated && previous.nextRequiredStep === next.nextRequiredStep
  ));
  // Local input state already contains draft edits. Read the current draft on
  // render without redrawing every page each time the draft is persisted.
  const auth = {...selectedAuth, onboardingDraft: focused ? activeStore.getState().auth.onboardingDraft : selectedAuth.onboardingDraft};
  const route = useRoute<any>();
  const data = { ...auth.user, ...auth.onboardingDraft?.fields, ...route.params };
  const editing = !!route.params?.reviewEdit;
  useFocusEffect(useCallback(() => {
    if (auth.token && !editing) return afterScreenTransition(navigation, () => dispatch(saveOnboardingDraft({ step: route.name })));
  }, [auth.token, editing, route.name, dispatch, navigation]));
  function back() {
    if (navigation.canGoBack()) { navigation.goBack(); return; }
    navigation.navigate(previousProfileStep(route.name) ?? 'OnboardingReview');
  }
  function draft(fields: Record<string, any>) { dispatch(saveOnboardingDraft({ fields })); }
  function next(screen: string, fields: Record<string, any> = {}) {
    if (editing) { draft(fields); navigation.goBack(); return; }
    // One store update for the answers and the step, not two.
    dispatch(saveOnboardingDraft({ fields, step: screen }));
    navigation.navigate(screen);
  }
  async function save(fields: Record<string, any>) {
    if (__DEV__ && isOnboardingPreview()) {dispatch(updateUser(fields)); draft(fields); return;}
    const unchanged = Object.entries(fields).every(([key, value]) =>
      Object.is(auth.user?.[key], value) || JSON.stringify(auth.user?.[key]) === JSON.stringify(value));
    if (unchanged) {draft(fields); return;}
    const response = await api.put('/profile', fields);
    dispatch(updateUser(response.data.data));
    draft(fields);
  }
  return { auth, data, dispatch, navigation, route, editing, draft, next, save, back };
}
