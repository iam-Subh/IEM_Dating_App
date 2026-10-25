export type ProfileEditorSection = 'photos' | 'video' | 'about' | 'visibility' | 'campus';

type EditableProfile = {
  preferences?: { bio?: string; interests?: string[] };
  seeking?: string;
  degree?: string;
  yearOfStudy?: number | null;
  graduationYear?: number | null;
  gender?: string;
  showGender?: boolean;
  orientation?: string[];
  showOrientation?: boolean;
};

// Field editors receive the saved values instead of starting with empty answers.
export function profileEditorParams(route: string, profile: EditableProfile | null, section?: ProfileEditorSection) {
  switch (route) {
    case 'EditProfile': return { profile, section };
    case 'EditBio': return { currentBio: profile?.preferences?.bio ?? '' };
    case 'EditInterests': return { currentInterests: profile?.preferences?.interests ?? [] };
    case 'EditSeeking': return { currentSeeking: profile?.seeking };
    case 'EditDegree': return { currentDegree: profile?.degree };
    case 'EditStudies': return {currentDegree: profile?.degree, currentYearOfStudy: profile?.yearOfStudy, currentGraduationYear: profile?.graduationYear};
    case 'EditGender': return { currentGender: profile?.gender, currentShowGender: profile?.showGender };
    case 'EditOrientation': return { currentOrientation: profile?.orientation ?? [], currentShowOrientation: profile?.showOrientation };
    default: return undefined;
  }
}
