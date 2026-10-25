// This runtime is activated only by the development preview link.
let active = false;
export const isOnboardingPreview = () => __DEV__ && active;
export function setOnboardingPreview(value: boolean) {active = __DEV__ && value;}

export const previewUser = {
  id: 'design-preview', name: 'Alex', email: 'firstname.lastname2024@iem.edu.in',
  college: 'Institute of Engineering and Management', institutionId: 'preview-iem',
  campus: 'Gurukul', department: 'Computer Science and Engineering', degree: 'B.Tech',
  graduationYear: 2028, yearOfStudy: 3, birthday: '2005-04-12', age: 21,
  gender: 'Man', orientation: ['Straight'], showGender: true, showOrientation: true,
  seeking: 'Long-term partner', isHosteller: false, googleSub: 'design-preview',
  photos: [], preferencesConfirmedAt: '2026-10-07T00:00:00Z',
  preferences: {bio: 'Coffee, music, and weekend walks.', interests: ['gaming', 'cooking']},
};
export const previewInstitutions = [
  {id: 'preview-iem', code: 'IEM-KOLKATA', name: 'Institute of Engineering and Management', emailDomain: 'iem.edu.in', campuses: ['Gurukul', 'Management'], campusList: [{id: 'preview-gurukul', name: 'Gurukul'}, {id: 'preview-management', name: 'Management'}]},
  {id: 'preview-uem', code: 'UEM-KOLKATA', name: 'University of Engineering and Management, Kolkata', emailDomain: 'uem.edu.in', campuses: ['New Town'], campusList: [{id: 'preview-newtown', name: 'New Town'}]},
];

export function onboardingPreviewResponse(url: string, method: string) {
  if (method.toLowerCase() !== 'get') throw new Error('Design preview: tap Next to view the next page.');
  if (url.includes('/verification/institutions')) return previewInstitutions;
  if (url.includes('/profile/campuses')) return {campuses: previewInstitutions[0].campusList, campusId: 'preview-gurukul'};
  if (url.includes('/auth/account')) return {hasPassword: false};
  if (url.includes('/verification/status')) return {verified: true, realPersonVerified: false, realPersonRequired: false, signedUpWithGoogle: true, campusName: 'Gurukul', limited: false};
  if (url.includes('/verification/face')) return {status: 'none', required: false, media: [], attemptsLeft: 3};
  if (url.includes('/profile/discovery')) return {discoveryCategory: 'man', showMeCategories: ['woman'], minAgePref: 18, maxAgePref: 30, discoveryMode: 'college', distancePreference: 25, collegeScope: 'college', expandRadius: true};
  if (url.includes('/profile/preferences')) return {distanceUnit: 'km', areaOptions: {
    campus: {label: 'My campus', detail: 'Students at Gurukul'},
    college: {label: 'All IEM campuses', detail: 'Students at every IEM campus'},
    city: {label: 'IEM and UEM New Town', detail: 'Students at both colleges'},
  }};
  if (url.includes('/profile/location')) return {consented: false};
  if (url === '/profile') return previewUser;
  return {};
}
