import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type NextRequiredStep = 'studentVerification' | 'profile' | 'discoveryPreferences' | null;

interface AuthState {
  token: string | null;
  user: any | null;
  isAuthenticated: boolean;
  nextRequiredStep: NextRequiredStep;
}

const initialState: AuthState = {
  token: null,
  user: null,
  isAuthenticated: false,
  nextRequiredStep: null,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials: (
      state,
      action: PayloadAction<{ user: any; token: string; nextRequiredStep?: NextRequiredStep }>
    ) => {
      state.user = action.payload.user;
      state.token = action.payload.token;
      state.isAuthenticated = false;
      
      const inferredStep = !state.user?.department || !state.user?.graduationYear
        ? 'profile'
        : !state.user?.preferencesConfirmedAt
          ? 'discoveryPreferences'
          : null;
      state.nextRequiredStep = action.payload.nextRequiredStep === undefined
        ? inferredStep
        : action.payload.nextRequiredStep;
      if (state.nextRequiredStep === null) {
        state.isAuthenticated = true;
      }
    },
    updateUser: (state, action: PayloadAction<any>) => {
      state.user = { ...state.user, ...action.payload };
    },
    setAccessToken: (state, action: PayloadAction<string>) => {
      state.token = action.payload;
    },
    setNextRequiredStep: (state, action: PayloadAction<NextRequiredStep>) => {
      state.nextRequiredStep = action.payload;
      state.isAuthenticated = action.payload === null;
    },
    completeOnboarding: (state) => {
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
      state.isAuthenticated = true;
    },
    logout: (state) => {
      state.user = null;
      state.token = null;
      state.isAuthenticated = false;
      state.nextRequiredStep = null;
    },
  },
});

export const { setCredentials, setAccessToken, setNextRequiredStep, logout, updateUser, completeOnboarding, confirmDiscoveryPreferences } = authSlice.actions;
export default authSlice.reducer;
