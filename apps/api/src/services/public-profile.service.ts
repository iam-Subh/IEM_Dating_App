import { Prisma } from "@prisma/client";
import { ageAt } from "./eligibility.service";
import { distanceLabel, haversineKm } from "../utils/geo";
import { compatibility, CompatibilityWeights } from "./compatibility.service";
import { transformToCdnUrl } from "../middlewares/upload.middleware";
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
  videoPreviewUrl: true,
  latitude: true,
  longitude: true,
  isVerified: true,
  studentMembership: {
    select: { status: true, verifiedAt: true, expiresAt: true, institution: { select: { isActive: true } } },
  },
  discoveryMode: true,
  storiesEnabled: true,
  allowFollowRequests: true,
  degree: true,
  yearOfStudy: true,
  attendanceMood: true,
  hangoutSpots: true,
  photos: {
    select: { photoUrl: true, isPrimary: true },
    orderBy: { order: "asc" as const },
  },
} satisfies Prisma.UserSelect;
type Profile = Prisma.UserGetPayload<{ select: typeof discoveryProfileSelect }>;
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
    isVerified: candidate.studentMembership?.status === "verified" &&
      !!candidate.studentMembership.verifiedAt &&
      candidate.studentMembership.institution.isActive &&
      (!candidate.studentMembership.expiresAt || candidate.studentMembership.expiresAt > new Date()),
    verifications: candidate.studentMembership?.status === "verified" &&
      !!candidate.studentMembership.verifiedAt &&
      candidate.studentMembership.institution.isActive &&
      (!candidate.studentMembership.expiresAt || candidate.studentMembership.expiresAt > new Date())
        ? ["College membership"]
        : [],
    primaryPhoto: media(
      candidate.avatarUrl ||
        candidate.photos.find((p) => p.isPrimary)?.photoUrl ||
        candidate.photos[0]?.photoUrl ||
        null,
    ),
    photos: candidate.photos
      .map((p) => media(p.photoUrl))
      .filter((url): url is string => url !== null),
    video: media(candidate.profileVideoUrl),
    videoPreview: media(candidate.videoPreviewUrl),
    distanceLabel:
      me.discoveryMode === "distance" &&
      candidate.discoveryMode === "distance" &&
      me.latitude !== null &&
      me.longitude !== null &&
      candidate.latitude !== null &&
      candidate.longitude !== null
        ? distanceLabel(
            haversineKm(
              {
                latitude: Number(me.latitude),
                longitude: Number(me.longitude),
              },
              {
                latitude: Number(candidate.latitude),
                longitude: Number(candidate.longitude),
              },
            ),
          )
        : null,
    matchPercentage: c.score,
    compatibilityScore: c.score,
    matchFactors: c.factors,
    evidenceCoverage: c.coverage,
    scoreVersion: c.version,
    canRequestFollow: candidate.storiesEnabled && candidate.allowFollowRequests,
  };
}
