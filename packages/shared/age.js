/**
 * The age range people can choose in their preferences, shared by the app
 * and the server so the slider and the saved value can never disagree.
 *
 * Why 35: the highest degree in the IEM-UEM group is a PhD. Entry needs a
 * Master's, so the usual path is 18 (after Class 12) + 4 (B.Tech) + 2
 * (M.Tech) = 24 at the start of a PhD, and UGC's PhD Regulations 2022 allow
 * at most 6 years - 30 at the latest. Five years' margin on top gives 35.
 */

/** The youngest anyone on the app can be, and the lowest preference. */
const PREFERENCE_AGE_MIN = 18;

/** The oldest a preference can reach: 30 (the latest usual PhD finish) + 5. */
const PREFERENCE_AGE_MAX = 35;

/** Any stored or sent age preference, brought inside the range. */
function clampAgePreference(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return PREFERENCE_AGE_MIN;
  return Math.max(PREFERENCE_AGE_MIN, Math.min(PREFERENCE_AGE_MAX, number));
}

module.exports = { PREFERENCE_AGE_MIN, PREFERENCE_AGE_MAX, clampAgePreference };
