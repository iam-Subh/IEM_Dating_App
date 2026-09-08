import { Prisma, User } from "@prisma/client";
import { z } from "zod";
import { haversineKm } from "../utils/geo";

export const discoverySettingsSchema = z
  .object({
    discoveryCategory: z.enum(["man", "woman", "nonbinary"]),
    showMeCategories: z
      .array(z.enum(["man", "woman", "nonbinary"]))
      .min(1)
      .max(3),
    minAgePref: z.number().int().min(18).max(120),
    maxAgePref: z.number().int().min(18).max(120),
    discoveryMode: z.enum(["distance", "college"]),
    distancePreference: z.number().int().min(1).max(100),
  })
  .strict()
  .refine(
    (x) => x.minAgePref <= x.maxAgePref,
    "Minimum age exceeds maximum age",
  );

export function ageAt(birthday: Date | null, now = new Date()): number | null {
  if (!birthday || !Number.isFinite(birthday.getTime())) return null;
  let age = now.getUTCFullYear() - birthday.getUTCFullYear();
  if (
    now.getUTCMonth() < birthday.getUTCMonth() ||
    (now.getUTCMonth() === birthday.getUTCMonth() &&
      now.getUTCDate() < birthday.getUTCDate())
  )
    age--;
  return age;
}

export function setupComplete(u: User, now = new Date()): boolean {
  const age = ageAt(u.birthday, now);
  return (
    u.accountStatus === 'active' &&
    age !== null &&
    age >= 18 &&
    age <= 120 &&
    !!u.preferencesConfirmedAt &&
    !!u.discoveryCategory &&
    u.showMeCategories.length > 0 &&
    u.minAgePref !== null &&
    u.maxAgePref !== null &&
    (u.discoveryMode === "college"
      ? !!u.college?.trim()
      : u.discoveryMode === "distance" &&
        u.latitude !== null &&
        u.longitude !== null &&
        !!u.locationConsentAt)
  );
}

export function mutuallyEligible(a: User, b: User, now = new Date()): boolean {
  if (a.id === b.id || !setupComplete(a, now) || !setupComplete(b, now))
    return false;
  const aa = ageAt(a.birthday, now)!;
  const ba = ageAt(b.birthday, now)!;
  if (
    !a.showMeCategories.includes(b.discoveryCategory!) ||
    !b.showMeCategories.includes(a.discoveryCategory!)
  )
    return false;
  if (
    ba < a.minAgePref! ||
    ba > a.maxAgePref! ||
    aa < b.minAgePref! ||
    aa > b.maxAgePref!
  )
    return false;
  if (a.discoveryMode !== b.discoveryMode) return false;
  if (a.discoveryMode === "college")
    return a.college!.trim().toLowerCase() === b.college!.trim().toLowerCase();
  return (
    haversineKm(
      { latitude: Number(a.latitude), longitude: Number(a.longitude) },
      { latitude: Number(b.latitude), longitude: Number(b.longitude) },
    ) <= Math.min(a.distancePreference ?? 100, b.distancePreference ?? 100)
  );
}

// Use this predicate for retrieval and page revalidation. No rollout flag can remove it.
export function eligibleSql(
  me: User,
  now = new Date(),
  excludeSwipes = true,
): Prisma.Sql {
  const age = ageAt(me.birthday, now) ?? -1;
  const candidateAge = Prisma.sql`EXTRACT(YEAR FROM age(${now.toISOString().slice(0, 10)}::date, u.birthday::date))`;
  const geography =
    me.discoveryMode === "college"
      ? Prisma.sql`u.discovery_mode = 'college' AND EXISTS (
          SELECT 1 FROM student_memberships viewer_membership
          WHERE viewer_membership.user_id = ${me.id}::uuid
            AND viewer_membership.institution_id = candidate_membership.institution_id
        )`
      : Prisma.sql`u.discovery_mode = 'distance' AND u.latitude IS NOT NULL AND u.longitude IS NOT NULL
        AND u.location_consent_at IS NOT NULL AND
        12742 * asin(sqrt(LEAST(1.0, GREATEST(0.0,
          power(sin(radians(u.latitude::float8 - ${Number(me.latitude)}) / 2), 2) +
          cos(radians(${Number(me.latitude)}::float8)) * cos(radians(u.latitude::float8)) *
          power(sin(radians(u.longitude::float8 - ${Number(me.longitude)}) / 2), 2)
        )))) <= LEAST(${me.distancePreference ?? 100}, COALESCE(u.distance_preference, 100))`;
  return Prisma.sql`u.id <> ${me.id}::uuid AND u.account_status = 'active' AND u.preferences_confirmed_at IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM student_memberships candidate_membership
      JOIN institutions candidate_institution ON candidate_institution.id = candidate_membership.institution_id
      WHERE candidate_membership.user_id = u.id
        AND candidate_membership.status = 'verified'
        AND candidate_membership.verified_at IS NOT NULL
        AND (candidate_membership.expires_at IS NULL OR candidate_membership.expires_at > ${now})
        AND candidate_institution.is_active
        AND (${geography})
    )
    AND ${candidateAge} BETWEEN 18 AND 120
    AND ${candidateAge} BETWEEN ${me.minAgePref ?? 18} AND ${me.maxAgePref ?? 120}
    AND ${age} BETWEEN u.min_age_pref AND u.max_age_pref
    AND u.discovery_category = ANY(${me.showMeCategories}::text[])
    AND u.show_me_categories @> ARRAY[${me.discoveryCategory}]::text[]
    AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = ${me.id}::uuid AND b.blocked_id = u.id OFFSET 0)
    AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocked_id = ${me.id}::uuid AND b.blocker_id = u.id OFFSET 0)
    AND NOT EXISTS (SELECT 1 FROM swipes s WHERE s.swiper_id=u.id AND s.target_id=${me.id}::uuid AND s.action='pass' OFFSET 0)
    AND NOT EXISTS (SELECT 1 FROM matches m WHERE
      (m.user1_id = ${me.id}::uuid AND m.user2_id = u.id) OR (m.user2_id = ${me.id}::uuid AND m.user1_id = u.id) OFFSET 0)
    ${excludeSwipes ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM swipes s WHERE s.swiper_id = ${me.id}::uuid AND s.target_id = u.id OFFSET 0)` : Prisma.empty}`;
}
