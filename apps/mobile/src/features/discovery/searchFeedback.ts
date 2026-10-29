export type ProfileSearchReason = 'open' | 'preferences' | 'location' | 'nearby';
export const SEARCH_RING_DELAY = 600;
export const SEARCH_SLOW_DELAY = 8000;
export const FIRST_MEDIA_WAIT_LIMIT = 2000;

export function profileSearchMessage(reason: ProfileSearchReason, slow = false) {
  const title = reason === 'location' ? 'Getting your location…'
    : reason === 'nearby' ? 'Finding people nearby…'
    : reason === 'preferences' ? 'Updating your picks…' : 'Finding people for you…';
  const detail = slow ? 'This is taking longer than usual.'
    : reason === 'location' ? 'Preparing your nearby profiles.'
    : reason === 'nearby' ? 'Using your updated location.'
    : reason === 'preferences' ? 'Using your latest preferences.' : 'Based on your preferences.';
  return {title, detail};
}
