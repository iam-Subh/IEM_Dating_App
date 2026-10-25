import { blueBadge } from "./blue-badge";
import { Prisma } from "@prisma/client";
import { ageAt } from "./eligibility.service";
import { Coords, distanceLabel, haversineKm } from "../utils/geo";
import { compatibility, CompatibilityWeights } from "./compatibility.service";
import { transformToCdnUrl } from "../middlewares/upload.middleware";
import { activityOf } from "./presence.service";
export const discoveryProfileSelect = {
  id: true,
  name: true,
  birthday: true,
  gender: true,
  showGender: true,
  orientation: true,
  showOrientation: true,
  college: true,
  department: true,
  graduationYear: true,
  campus: true,
  isHosteller: true,
  height: true,
  clubs: true,
  seeking: true,
  preferences: true,
  avatarUrl: true,
  profileVideoUrl: true,
  videoPosterUrl: true,
  videoPlaybackUrl: true,
  latitude: true,
  longitude: true,
  isVerified: true,
  realPersonVerifiedAt: true,
  studentMembership: {
    select: {
      status: true,
      verifiedAt: true,
      expiresAt: true,
      institution: {
        select: {
          id: true,
          code: true,
          city: true,
          isActive: true,
          campusList: {
            where: { isActive: true },
            select: { id: true, latitude: true, longitude: true },
          },
        },
      },
    },
  },
  campusId: true,
  hideDistance: true,
  discoveryMode: true,
  storiesEnabled: true,
  allowFollowRequests: true,
  degree: true,
  yearOfStudy: true,
  attendanceMood: true,
  hangoutSpots: true,
  lastActiveAt: true,
  showRecentlyActive: true,
  distanceUnit: true,
  photos: {
    select: { photoUrl: true, cardUrl: true, isPrimary: true },
    orderBy: { order: "asc" as const },
  },
} satisfies Prisma.UserSelect;
type Profile = Prisma.UserGetPayload<{ select: typeof discoveryProfileSelect }>;

/** "UEM-JAIPUR" -> "UEM Jaipur": short enough for a card. */
function institutionShortName(code: string) {
  const [head, ...rest] = code.split(/[-_\s]+/);
  return [head.toUpperCase(), ...rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())].join(" ");
}

/** A distance-mode person this far from every campus of their own institution is visiting (8.6). */
const VISITING_KM = 150;

/**
 * Where a person is for display purposes: their snapped cell in distance
 * mode, their campus anchor in college mode (never a personal location).
 */
function positionOf(profile: Profile): Coords | null {
  if (profile.discoveryMode === "distance") {
    return profile.latitude !== null && profile.longitude !== null
      ? { latitude: Number(profile.latitude), longitude: Number(profile.longitude) }
      : null;
  }
  const campus = profile.studentMembership?.institution.campusList.find((entry) => entry.id === profile.campusId);
  return campus && campus.latitude !== null && campus.longitude !== null
    ? { latitude: Number(campus.latitude), longitude: Number(campus.longitude) }
    : null;
}

/**
 * The location labels a card may carry (LOCATION_SPEC.md 6.6, 8.6):
 * - a distance band, only for a viewer in distance mode - measured from their
 *   own (budgeted) cell, never from a fixed campus, which several college-mode
 *   viewers could otherwise use as trilateration anchors - and never for
 *   someone who chose to hide it;
 * - the other person's institution when it is not the viewer's, and their
 *   city when it is not the viewer's city;
 * - "visiting" when a distance-mode person is far from every campus of their
 *   own institution.
 */
function locationLabels(me: Profile, candidate: Profile) {
  const mine = positionOf(me);
  const theirs = positionOf(candidate);
  const distance =
    me.discoveryMode === "distance" && mine && theirs && !candidate.hideDistance
      ? distanceLabel(haversineKm(mine, theirs), me.distanceUnit)
      : null;
  const myInstitution = me.studentMembership?.institution;
  const theirInstitution = candidate.studentMembership?.institution;
  const otherInstitution =
    !!theirInstitution && !!myInstitution && theirInstitution.id !== myInstitution.id;
  const mapped = (theirInstitution?.campusList ?? []).filter(
    (campus) => campus.latitude !== null && campus.longitude !== null,
  );
  const visiting =
    candidate.discoveryMode === "distance" &&
    !!theirs &&
    mapped.length > 0 &&
    mapped.every(
      (campus) =>
        haversineKm(theirs, { latitude: Number(campus.latitude), longitude: Number(campus.longitude) }) > VISITING_KM,
    );
  return {
    distanceLabel: distance,
    institutionLabel: otherInstitution ? institutionShortName(theirInstitution!.code) : null,
    cityLabel:
      otherInstitution && theirInstitution?.city && theirInstitution.city !== myInstitution?.city
        ? theirInstitution.city
        : null,
    visitingLabel: visiting && theirInstitution ? `Visiting · ${institutionShortName(theirInstitution.code)}` : null,
  };
}
/** A valid college verification: verified, at a college still on the app, not expired. */
function collegeVerified(membership: Profile["studentMembership"]) {
  return !!(membership?.status === "verified" && membership.verifiedAt && membership.institution.isActive &&
    (!membership.expiresAt || membership.expiresAt > new Date()));
}

function publicPreferences(value: unknown) {
  const record = (x: unknown): Record<string, unknown> =>
    x && typeof x === "object" && !Array.isArray(x)
      ? (x as Record<string, unknown>)
      : {};
  const source = record(value);
  const selectStrings = (x: unknown, keys: string[]) =>
    Object.fromEntries(
      keys.flatMap((key) => {
        const field = record(x)[key];
        return typeof field === "string" ? [[key, field.slice(0, 200)]] : [];
      }),
    );
  return {
    bio: typeof source.bio === "string" ? source.bio.slice(0, 2000) : null,
    interests: Array.isArray(source.interests)
      ? source.interests
          .filter((x): x is string => typeof x === "string")
          .slice(0, 100)
      : [],
    lifestyle: selectStrings(source.lifestyle, [
      "drink",
      "smoke",
      "exercise",
      "pets",
    ]),
    personality: selectStrings(source.personality, [
      "personality",
      "love_reception",
      "star_sign",
      "communication",
      "education",
    ]),
  };
}
export function publicProfile(
  me: Profile,
  candidate: Profile,
  weights: CompatibilityWeights,
) {
  const c = compatibility(me, candidate, weights);
  const media = (value: string | null) =>
    value ? transformToCdnUrl(value) : null;
  // Discovery draws card renditions. Originals are up to 15 MB each; a photo
  // uploaded before renditions existed falls back to its original.
  const cardFor = (url: string | null) =>
    url ? (candidate.photos.find((p) => p.photoUrl === url)?.cardUrl ?? url) : null;
  return {
    id: candidate.id,
    name: candidate.name,
    age: ageAt(candidate.birthday),
    gender: candidate.showGender ? candidate.gender : null,
    showGender: candidate.showGender,
    showOrientation: candidate.showOrientation,
    orientation: candidate.showOrientation ? candidate.orientation : [],
    college: candidate.college,
    department: candidate.department,
    graduationYear: candidate.graduationYear,
    campus: candidate.campus,
    isHosteller: candidate.isHosteller,
    height: candidate.height,
    clubs: candidate.clubs,
    degree: candidate.degree,
    yearOfStudy: candidate.yearOfStudy,
    attendanceMood: candidate.attendanceMood,
    hangoutSpots: candidate.hangoutSpots,
    preferences: publicPreferences(candidate.preferences),
    seeking: candidate.seeking,
    isVerified: collegeVerified(candidate.studentMembership),
    verifications: collegeVerified(candidate.studentMembership) ? ["College membership"] : [],
    // Passed the real-person check and every photo and the video still match
    // (PHOTO_VERIFICATION_PLAN.md). Off while a changed photo needs fixing.
    realPerson: !!candidate.realPersonVerifiedAt,
    blueBadge: blueBadge(collegeVerified(candidate.studentMembership), candidate.realPersonVerifiedAt),
    primaryPhoto: media(
      cardFor(
        candidate.avatarUrl ||
          candidate.photos.find((p) => p.isPrimary)?.photoUrl ||
          candidate.photos[0]?.photoUrl ||
          null,
      ),
    ),
    photos: candidate.photos
      .map((p) => media(p.cardUrl ?? p.photoUrl))
      .filter((url): url is string => url !== null),
    // The playback rendition once processing finishes; the upload until then.
    video: media(candidate.videoPlaybackUrl ?? candidate.profileVideoUrl),
    videoPoster: media(candidate.videoPosterUrl),
    ...locationLabels(me, candidate),
    // "now" | "recent" | null - a band, never a time (presence.service.ts).
    activity: activityOf(me, candidate),
    matchPercentage: c.score,
    compatibilityScore: c.score,
    matchFactors: c.factors,
    evidenceCoverage: c.coverage,
    scoreVersion: c.version,
    canRequestFollow: candidate.storiesEnabled && candidate.allowFollowRequests,
  };
}
