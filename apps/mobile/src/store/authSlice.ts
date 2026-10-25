import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type NextRequiredStep = 'studentVerification' | 'profile' | 'discoveryPreferences' | null;

/** Older servers can still return the college gate for a Google account. */
export function resolveOnboardingStep(user: any, reportedStep?: NextRequiredStep): NextRequiredStep {
  const inferredStep = !user?.department || !user?.graduationYear || (!!user?.googleSub && !user?.college)
    ? 'profile'
    : !user?.preferencesConfirmedAt ? 'discoveryPreferences' : null;
  return reportedStep === undefined || (reportedStep === 'studentVerification' && !!user?.googleSub)
    ? inferredStep : reportedStep;
}

interface AuthState {
  token: string | null;
  user: any | null;
  isAuthenticated: boolean;
  nextRequiredStep: NextRequiredStep;
  onboardingDraft: { step: string; fields: Record<string, any> } | null;
}

const initialState: AuthState = {
  token: null,
  user: null,
  isAuthenticated: false,
  nextRequiredStep: null,
  onboardingDraft: null,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials: (
      state,
      action: PayloadAction<{ user: any; token: string; nextRequiredStep?: NextRequiredStep; restoreCachedProfile?: boolean }>
    ) => {
      if (state.user?.id !== action.payload.user?.id) state.onboardingDraft = null;
      const cachedProfile = action.payload.restoreCachedProfile && state.user?.id &&
        state.user.id === action.payload.user?.id ? state.user : null;
      state.user = cachedProfile ? { ...cachedProfile, ...action.payload.user } : action.payload.user;
      // /auth/refresh returns the legacy user flag. /profile computes the badge
      // from college membership. Keep that saved result until /profile refreshes it.
      if (cachedProfile && typeof cachedProfile.isVerified === 'boolean') {
        state.user.isVerified = cachedProfile.isVerified;
      }
      state.token = action.payload.token;
      state.isAuthenticated = false;
      
      state.nextRequiredStep = resolveOnboardingStep(state.user, action.payload.nextRequiredStep);
      if (state.nextRequiredStep === null && !state.onboardingDraft) {
        state.isAuthenticated = true;
      }
    },
    updateUser: (state, action: PayloadAction<any>) => {
      state.user = { ...state.user, ...action.payload };
    },
    saveOnboardingDraft: (state, action: PayloadAction<{ step?: string; fields?: Record<string, any> }>) => {
      const previous = state.onboardingDraft ?? { step: 'HouseRules', fields: {} };
      // Explicit allowlist: never persist credentials, upload tickets, or face captures.
      const allowed = ['name', 'birthday', 'gender', 'showGender', 'orientation', 'showOrientation', 'college', 'institutionId', 'claimedInstitutionId', 'campus', 'isHosteller', 'attendanceMood', 'hangoutSpots', 'department', 'degree', 'graduationYear', 'yearOfStudy', 'seeking', 'clubs', 'preferences', 'discovery', 'mediaDraft'];
      const fields = { ...previous.fields };
      let changed = !state.onboardingDraft || (action.payload.step !== undefined && action.payload.step !== previous.step);
      for (const [key, value] of Object.entries(action.payload.fields ?? {})) {
        if (allowed.includes(key) && !Object.is(previous.fields[key], value)
          && JSON.stringify(previous.fields[key]) !== JSON.stringify(value)) {
          fields[key] = value;
          changed = true;
        }
      }
      if (changed) state.onboardingDraft = { step: action.payload.step ?? previous.step, fields };
    },
    setAccessToken: (state, action: PayloadAction<string>) => {
      state.token = action.payload;
    },
    setNextRequiredStep: (state, action: PayloadAction<NextRequiredStep>) => {
      state.nextRequiredStep = action.payload;
      state.isAuthenticated = action.payload === null && !state.onboardingDraft;
    },
    completeOnboarding: (state) => {
      state.onboardingDraft = null;
      if (!state.user?.preferencesConfirmedAt) {
        state.nextRequiredStep = 'discoveryPreferences';
        state.isAuthenticated = false;
      } else {
        state.nextRequiredStep = null;
        state.isAuthenticated = true;
      }
    },
    confirmDiscoveryPreferences: (state, action: PayloadAction<string>) => {
      state.user = { ...state.user, preferencesConfirmedAt: action.payload };
      state.nextRequiredStep = null;
      state.onboardingDraft = null;
      state.isAuthenticated = true;
    },
    logout: (state) => {
      state.onboardingDraft = null;
      state.user = null;
      state.token = null;
      state.isAuthenticated = false;
      state.nextRequiredStep = null;
    },
  },
});

export const { setCredentials, setAccessToken, setNextRequiredStep, logout, updateUser, completeOnboarding, confirmDiscoveryPreferences, saveOnboardingDraft } = authSlice.actions;
export default authSlice.reducer;
