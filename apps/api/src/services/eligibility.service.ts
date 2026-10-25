import { Prisma, PrismaClient, User } from "@prisma/client";
import { z } from "zod";
import {
  EXPANDED_RADIUS_KM,
  LOCATION_STALE_DAYS,
  toRadiusPreset,
} from "@iem-dating/shared/location";
import { Coords, haversineKm } from "../utils/geo";
import { AGE_FLEX_YEARS, candidateMeetsMySql, iMeetCandidateSql, meetsRequired } from "./match-criteria";
import { clampAgePreference } from "@iem-dating/shared/age";

/**
 * Who may see whom. The rules live here twice, on purpose and side by side:
 * `eligibleSql` for retrieval (the deck, Explore, Standouts, delivery-time
 * revalidation) and `mutuallyEligible` for the swipe and follow gates. They
 * previously disagreed about college mode and a card could be shown and then
 * refused, so `npm run test:location` cross-checks the two on a matrix of
 * users. Change one, change the other.
 *
 * The rules (LOCATION_SPEC.md sections 6 and 8):
 *
 * 1. Both people's gender categories and age ranges include each other.
 * 2. Geography, by the pair's discovery modes:
 *    - college + college: each person's *college scope* reaches the other.
 *    - distance + distance: both have a fresh location, and the distance
 *      between their cells is within both people's radius.
 *    - college + distance: the college-mode person's scope reaches the other,
 *      and the college-mode person's *campus anchor* (their campus's public
 *      coordinates; they share no personal location) is within the
 *      distance-mode person's radius.
 * 3. A scope reaches someone when:
 *    - campus:  same institution and same campus;
 *    - college: same institution (the default, and the old behaviour);
 *    - city:    same institution, or same group and same city;
 *    - group:   same institution, or same group.
 *    Reaching beyond your own institution needs *both* memberships to have a
 *    confirmed campus, so an unconfirmed member of a shared email domain stays
 *    inside their own institution (section 8.2).
 * 4. "Fresh" means updated within LOCATION_STALE_DAYS. A radius is the
 *    person's preset, or EXPANDED_RADIUS_KM when they asked to see people
 *    further away once they run out; ranking puts the people inside the real
 *    radius first.
 *
 * 5. Unverified accounts (GOOGLE_SIGNUP_PLAN.md 2.1, 7.3). Someone without a
 *    valid verification - a Google sign-up that chose Later, or a
 *    verification that expired - is an *unverified party*: the college they
 *    chose in onboarding (or were once verified at) and the campus they chose.
 *    - Their own reach is always "My campus" - the campus they chose -
 *      whatever scope is saved; with no campus chosen, their college.
 *      "All campuses" and "both colleges" wait for verifying.
 *    - A verified person reaches them as anyone else at that campus/college,
 *      by their own scope.
 *    - "Verified profiles only" means a valid verification - both ways.
 *
 * Invisible hours and "hide me while I'm here" are visibility rules, not
 * eligibility rules: they keep someone out of retrieval but do not unmake a
 * pair, so they appear only in `eligibleSql`.
 */

export const COLLEGE_SCOPES = ["campus", "college", "city", "group"] as const;
export type CollegeScope = (typeof COLLEGE_SCOPES)[number];

/** "Who you see": my campus, all my college's campuses, both colleges in my city - or people near me. */
export function simpleScope(scope: CollegeScope): "campus" | "college" | "city" {
  return scope === "city" || scope === "group" ? "city" : scope === "campus" ? "campus" : "college";
}

export const discoverySettingsSchema = z
  .object({
    discoveryCategory: z.enum(["man", "woman", "nonbinary"]),
    showMeCategories: z
      .array(z.enum(["man", "woman", "nonbinary"]))
      .min(1)
      .max(3),
    // Brought inside 18-35 (@iem-dating/shared/age) rather than refused, so
    // an older app sending 60 still saves - as 35.
    minAgePref: z.number().int().min(18).max(120).transform(clampAgePreference),
    maxAgePref: z.number().int().min(18).max(120).transform(clampAgePreference),
    discoveryMode: z.enum(["distance", "college"]),
    // Older clients send any whole number; it is rounded *up* to a preset so
    // nobody's audience shrinks behind their back (section 6.5).
    distancePreference: z
      .number()
      .int()
      .min(1)
      .max(100)
      .transform((value) => toRadiusPreset(value)),
    // "Who you see" (GOOGLE_SIGNUP_PLAN.md 2.1); older apps' "group" is saved as "city".
    collegeScope: z.enum(COLLEGE_SCOPES).transform(simpleScope).optional(),
    expandRadius: z.boolean().optional(),
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

export function staleCutoff(now = new Date()) {
  return new Date(now.getTime() - LOCATION_STALE_DAYS * 24 * 60 * 60_000);
}

/** A distance-mode location that is present, consented to, and recent enough to use. */
export function hasFreshLocation(u: User, now = new Date()) {
  return (
    u.latitude !== null &&
    u.longitude !== null &&
    !!u.locationConsentAt &&
    !!u.locationUpdatedAt &&
    u.locationUpdatedAt >= staleCutoff(now)
  );
}

/**
 * A person as they *browse* - their own deck, map, Explore, and the yes/no
 * of a like or follow they are part of.
 *
 * While hidden at a place ("hide me while I'm here") a person's shown cell
 * is cleared, which is what keeps them out of everyone else's discovery - a
 * candidate is found by its stored columns and `u.location_hidden_at IS NULL`.
 * Hiding is invisibility, not a pause: they still browse, measured from where
 * their phone last was (the private live baseline, never shown to anyone).
 * Everything that finds or shows *others* keeps reading the stored columns,
 * so this never makes the hidden person visible.
 */
export function asViewer<T extends User>(u: T): T {
  if (u.discoveryMode !== "distance" || !u.locationHiddenAt) return u;
  if (u.latitude !== null && u.longitude !== null) return u;
  if (u.liveLatitude === null || u.liveLongitude === null || !u.liveUpdatedAt) return u;
  return { ...u, latitude: u.liveLatitude, longitude: u.liveLongitude, locationUpdatedAt: u.liveUpdatedAt };
}

export function setupComplete(u: User, now = new Date()): boolean {
  const age = ageAt(u.birthday, now);
  return (
    u.accountStatus === "active" &&
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
      : // A stale location is not a location: distance mode asks for a
        // refresh rather than matching someone where they were weeks ago.
        u.discoveryMode === "distance" && hasFreshLocation(u, now))
  );
}

export function scopeOf(u: Pick<User, "collegeScope">): CollegeScope {
  return (COLLEGE_SCOPES as readonly string[]).includes(u.collegeScope)
    ? (u.collegeScope as CollegeScope)
    : "college";
}

/** The next scope out, for "show people further away" in college mode. */
const WIDER_SCOPE: Record<CollegeScope, CollegeScope> = { campus: "college", college: "city", city: "group", group: "group" };

/** The scope that binds: your own, one step wider when you asked to see further. */
export function reachScopeOf(u: Pick<User, "collegeScope" | "expandRadius">): CollegeScope {
  const scope = scopeOf(u);
  return u.expandRadius ? WIDER_SCOPE[scope] : scope;
}

export function effectiveRadiusKm(
  u: Pick<User, "distancePreference" | "expandRadius">,
) {
  return u.expandRadius ? EXPANDED_RADIUS_KM : (u.distancePreference ?? 100);
}

/** Minutes after midnight in India, which is the only time zone invisible hours are set in. */
export function istMinuteOfDay(now = new Date()) {
  return (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440;
}

export function isInvisibleNow(
  u: Pick<User, "invisibleStart" | "invisibleEnd">,
  now = new Date(),
) {
  if (u.invisibleStart === null || u.invisibleEnd === null) return false;
  const m = istMinuteOfDay(now);
  return u.invisibleStart < u.invisibleEnd
    ? m >= u.invisibleStart && m < u.invisibleEnd
    : m >= u.invisibleStart || m < u.invisibleEnd;
}

/** What `mutuallyEligible` needs to know about each person beyond their user row. */
export type EligibilityParty = {
  userId: string;
  /** A valid college verification; false for an unverified party (rule 5). */
  verified: boolean;
  /** Null for an unverified party: a chosen college proves nothing. */
  institutionId: string | null;
  groupCode: string | null;
  city: string | null;
  campusConfirmed: boolean;
  /** Only set when the campus belongs to the person's own institution. */
  campusId: string | null;
  /** The campus's public coordinates, when an admin has set them. */
  anchor: Coords | null;
};

/**
 * Loads each person's party: their verified membership, institution and
 * campus anchor - or, without a valid verification, the group of the college
 * they chose or were once verified at (rule 5). Someone with neither is
 * absent from the map, and `mutuallyEligible` then refuses the pair.
 */
export async function loadEligibilityParties(
  db: PrismaClient | Prisma.TransactionClient,
  userIds: string[],
  now = new Date(),
) {
  const [allMemberships, users] = await Promise.all([
    db.studentMembership.findMany({
      where: { userId: { in: userIds } },
      select: {
        userId: true,
        status: true,
        verifiedAt: true,
        expiresAt: true,
        institutionId: true,
        campusConfirmed: true,
        institution: { select: { groupCode: true, city: true, isActive: true } },
      },
    }),
    db.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        campusId: true,
        campusRef: {
          select: { institutionId: true, isActive: true, latitude: true, longitude: true },
        },
        claimedInstitutionId: true,
        claimedInstitution: { select: { groupCode: true, city: true, isActive: true } },
      },
    }),
  ]);
  const memberships = allMemberships.filter(
    (membership) =>
      membership.status === "verified" &&
      !!membership.verifiedAt &&
      (!membership.expiresAt || membership.expiresAt > now) &&
      membership.institution.isActive,
  );
  const parties = new Map<string, EligibilityParty>();
  for (const user of users) {
    if (memberships.some((membership) => membership.userId === user.id)) continue;
    const institution =
      user.claimedInstitution ?? allMemberships.find((membership) => membership.userId === user.id)?.institution;
    const institutionId = user.claimedInstitutionId ?? allMemberships.find((membership) => membership.userId === user.id)?.institutionId ?? null;
    if (!institution?.isActive || !institutionId) continue;
    const campus = user.campusRef;
    const ownCampus = campus && campus.isActive && campus.institutionId === institutionId ? campus : null;
    parties.set(user.id, {
      userId: user.id,
      verified: false,
      institutionId,
      groupCode: institution.groupCode,
      city: institution.city,
      campusConfirmed: false,
      campusId: ownCampus ? user.campusId : null,
      anchor:
        ownCampus && ownCampus.latitude !== null && ownCampus.longitude !== null
          ? { latitude: Number(ownCampus.latitude), longitude: Number(ownCampus.longitude) }
          : null,
    });
  }
  for (const membership of memberships) {
    const user = users.find((entry) => entry.id === membership.userId);
    const campus = user?.campusRef;
    // A campus from an institution the person no longer belongs to (they
    // re-verified elsewhere) is ignored rather than trusted.
    const ownCampus =
      campus && campus.isActive && campus.institutionId === membership.institutionId
        ? campus
        : null;
    parties.set(membership.userId, {
      userId: membership.userId,
      verified: true,
      institutionId: membership.institutionId,
      groupCode: membership.institution.groupCode,
      city: membership.institution.city,
      campusConfirmed: membership.campusConfirmed,
      campusId: ownCampus ? user!.campusId : null,
      anchor:
        ownCampus && ownCampus.latitude !== null && ownCampus.longitude !== null
          ? { latitude: Number(ownCampus.latitude), longitude: Number(ownCampus.longitude) }
          : null,
    });
  }
  return parties;
}

/** Does `owner`'s college scope reach `other`? Rules 3 and 5 above. */
export function scopeReaches(
  scope: CollegeScope,
  owner: EligibilityParty,
  other: EligibilityParty,
) {
  const sameInstitution = !!owner.institutionId && owner.institutionId === other.institutionId;
  // Beyond your own institution: a verified party needs a confirmed campus;
  // an unverified one has no institution to stay inside.
  const groupReady = (party: EligibilityParty) => !party.verified || party.campusConfirmed;
  const sameGroup =
    groupReady(owner) &&
    groupReady(other) &&
    !!owner.groupCode &&
    owner.groupCode === other.groupCode;
  const sameCity = sameGroup && !!owner.city && owner.city === other.city;
  // An unverified party reaches its own campus only - its college when it
  // chose no campus (rule 5).
  if (!owner.verified) return sameInstitution && (!owner.campusId || owner.campusId === other.campusId);
  switch (scope) {
    case "campus":
      return sameInstitution && !!owner.campusId && owner.campusId === other.campusId;
    case "city":
      return sameInstitution || sameCity;
    case "group":
      return sameInstitution || sameGroup;
    default:
      return sameInstitution;
  }
}

function cellOf(u: User): Coords {
  return { latitude: Number(u.latitude), longitude: Number(u.longitude) };
}

/** Is `age` inside `owner`'s range - widened by AGE_FLEX_YEARS when they keep age flexible? */
export function withinAgePreference(owner: Pick<User, "minAgePref" | "maxAgePref" | "flexibleAge">, age: number) {
  const flex = owner.flexibleAge ? AGE_FLEX_YEARS : 0;
  return age >= Math.max(18, owner.minAgePref! - flex) && age <= owner.maxAgePref! + flex;
}

export function mutuallyEligible(
  a: User,
  b: User,
  parties: { a: EligibilityParty | undefined; b: EligibilityParty | undefined },
  now = new Date(),
): boolean {
  if (a.id === b.id || !setupComplete(a, now) || !setupComplete(b, now))
    return false;
  const A = parties.a;
  const B = parties.b;
  // Both must be a party (verified or not, rule 5), and the parties must be these two.
  if (!A || !B || A.userId !== a.id || B.userId !== b.id) return false;
  const aa = ageAt(a.birthday, now)!;
  const ba = ageAt(b.birthday, now)!;
  if (
    !a.showMeCategories.includes(b.discoveryCategory!) ||
    !b.showMeCategories.includes(a.discoveryCategory!)
  )
    return false;
  if (!withinAgePreference(a, ba) || !withinAgePreference(b, aa)) return false;
  // Verified only, both ways, like "show me" - a valid verification, not the old flag.
  if ((a.verifiedOnly && !B.verified) || (b.verifiedOnly && !A.verified)) return false;
  // Dealbreakers, both ways (PREFERENCES_SPEC.md).
  if (!meetsRequired(a, b) || !meetsRequired(b, a)) return false;

  if (a.discoveryMode === "college" && b.discoveryMode === "college") {
    return scopeReaches(reachScopeOf(a), A, B) && scopeReaches(reachScopeOf(b), B, A);
  }
  if (a.discoveryMode === "distance" && b.discoveryMode === "distance") {
    return (
      haversineKm(cellOf(a), cellOf(b)) <=
      Math.min(effectiveRadiusKm(a), effectiveRadiusKm(b))
    );
  }
  // One of each: the college-mode person's scope, and their campus anchor
  // inside the distance-mode person's radius.
  const [collegeUser, distanceUser, College, Distance] =
    a.discoveryMode === "college" ? [a, b, A, B] : [b, a, B, A];
  return (
    scopeReaches(reachScopeOf(collegeUser), College, Distance) &&
    !!College.anchor &&
    haversineKm(College.anchor, cellOf(distanceUser)) <= effectiveRadiusKm(distanceUser)
  );
}

/** Is this person a party at all - verified, or unverified with a college (rule 5)? */
export async function isEligibilityParty(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
  now = new Date(),
) {
  return (await loadEligibilityParties(db, [userId], now)).has(userId);
}

/** Likes from someone quiet for longer than this are hidden, not deleted (STANDOUTS_LIKES_SPEC.md 4.1). */
export const LIKE_INACTIVE_DAYS = 30;

/**
 * A dating profile that is set up, apart from geography: `setupComplete`
 * without the location-freshness part. Answering a Like someone already sent
 * does not need your own location to be fresh.
 */
export function datingProfileReady(u: User, now = new Date()): boolean {
  const age = ageAt(u.birthday, now);
  return (
    u.accountStatus === "active" &&
    age !== null &&
    age >= 18 &&
    age <= 120 &&
    !!u.preferencesConfirmedAt &&
    !!u.discoveryCategory &&
    u.showMeCategories.length > 0 &&
    u.minAgePref !== null &&
    u.maxAgePref !== null
  );
}

/**
 * The Like-back rule (STANDOUTS_LIKES_SPEC.md 4.1): may `recipient` answer
 * `sender`'s Like with a Like? One rule for both what Likes You lists
 * (`likeBackSql`) and what the swipe accepts, so a listed Like can always be
 * answered.
 *
 * The sender was eligible when they liked - every surface that offers a Like
 * checks that - so geography and freshness are not asked again: people move
 * every day, and a Like already given must not evaporate overnight. Nor are
 * the sender's later preferences: re-reading them would silently withdraw
 * Likes. What is asked again is everything that must hold *now*: both
 * accounts active and verified inside one institution group, no block
 * (checked by the caller, as for every swipe), the recipient's own current
 * dealbreakers, and a sender who has not gone quiet.
 */
export function likeBackAllowed(
  recipient: User,
  sender: User,
  parties: { recipient: EligibilityParty | undefined; sender: EligibilityParty | undefined },
  now = new Date(),
): boolean {
  if (recipient.id === sender.id) return false;
  if (!datingProfileReady(recipient, now) || !datingProfileReady(sender, now)) return false;
  const R = parties.recipient;
  const S = parties.sender;
  if (!R || !S || R.userId !== recipient.id || S.userId !== sender.id) return false;
  // Never across the widest boundary any scope can reach.
  if (!scopeReaches("group", R, S)) return false;
  if (!recipient.showMeCategories.includes(sender.discoveryCategory!)) return false;
  const senderAge = ageAt(sender.birthday, now)!;
  if (!withinAgePreference(recipient, senderAge)) return false;
  // The recipient's own current filters, as for "show me": verified only, dealbreakers.
  if (recipient.verifiedOnly && !S.verified) return false;
  if (!meetsRequired(recipient, sender)) return false;
  const lastSeen = (sender.lastActiveAt ?? sender.createdAt).getTime();
  return lastSeen >= now.getTime() - LIKE_INACTIVE_DAYS * 24 * 60 * 60_000;
}

/**
 * An open "Under 18" report (GOOGLE_SIGNUP_PLAN.md 6.3; the only reason a
 * moderation case is "urgent"): out of every deck, Explore, Standouts, Likes
 * You and the map until the team has looked. Visibility, not eligibility -
 * like a pause - so the person's own browsing is untouched.
 */
export const UNDER_AGE_HOLD_SQL = Prisma.sql`NOT EXISTS (SELECT 1 FROM moderation_cases mc
  WHERE mc.subject_user_id = u.id AND mc.priority = 'urgent' AND mc.status IN ('open', 'reviewing') OFFSET 0)`;

const validMembershipSql = (alias: string, now: Date) =>
  Prisma.sql`${Prisma.raw(alias)}.status = 'verified'
    AND ${Prisma.raw(alias)}.verified_at IS NOT NULL
    AND (${Prisma.raw(alias)}.expires_at IS NULL OR ${Prisma.raw(alias)}.expires_at > ${now})`;

/**
 * `loadEligibilityParties` as SQL: one row for the person - their valid
 * verification, else the group of the college they chose or were once
 * verified at (rule 5) - with columns institution_id, group_code, city,
 * campus_confirmed and verified. No row: not a party.
 */
function partySql(id: Prisma.Sql, now: Date) {
  return Prisma.sql`(
    SELECT pm.institution_id, pi.group_code, pi.city, pm.campus_confirmed, TRUE AS verified
    FROM student_memberships pm JOIN institutions pi ON pi.id = pm.institution_id
    WHERE pm.user_id = ${id} AND ${validMembershipSql("pm", now)} AND pi.is_active
    UNION ALL
    SELECT pi.id, pi.group_code, pi.city, FALSE, FALSE
    FROM users pu JOIN institutions pi ON pi.id = COALESCE(pu.claimed_institution_id,
      (SELECT xm.institution_id FROM student_memberships xm WHERE xm.user_id = pu.id))
    WHERE pu.id = ${id} AND pi.is_active
      AND NOT EXISTS (SELECT 1 FROM student_memberships vm JOIN institutions vi ON vi.id = vm.institution_id
        WHERE vm.user_id = pu.id AND ${validMembershipSql("vm", now)} AND vi.is_active)
  )`;
}

/** Same group, across institutions: rule 3's confirmed campus for a verified party; rule 5 for an unverified one. */
function sameGroupSql(a: string, b: string) {
  const ready = (alias: string) => Prisma.sql`(NOT ${Prisma.raw(alias)}.verified OR ${Prisma.raw(alias)}.campus_confirmed)`;
  return Prisma.sql`(${ready(a)} AND ${ready(b)}
    AND ${Prisma.raw(a)}.group_code IS NOT NULL AND ${Prisma.raw(a)}.group_code = ${Prisma.raw(b)}.group_code)`;
}

/**
 * `likeBackAllowed` as SQL over `u`, the sender, for `me`, the recipient.
 * The caller joins the incoming Like; answered Likes and matches are the
 * caller's to exclude. Change one, change the other.
 */
export function likeBackSql(me: User, now = new Date()): Prisma.Sql {
  if (!datingProfileReady(me, now)) return Prisma.sql`FALSE`;
  const senderAge = Prisma.sql`EXTRACT(YEAR FROM age(${now.toISOString().slice(0, 10)}::date, u.birthday::date))`;
  const quietSince = new Date(now.getTime() - LIKE_INACTIVE_DAYS * 24 * 60 * 60_000);
  return Prisma.sql`u.id <> ${me.id}::uuid AND u.account_status = 'active' AND u.paused_at IS NULL
    AND u.preferences_confirmed_at IS NOT NULL AND u.discovery_category IS NOT NULL
    AND cardinality(u.show_me_categories) > 0 AND u.min_age_pref IS NOT NULL AND u.max_age_pref IS NOT NULL
    AND ${senderAge} BETWEEN 18 AND 120
    AND ${senderAge} BETWEEN ${Math.max(18, (me.minAgePref ?? 18) - (me.flexibleAge ? AGE_FLEX_YEARS : 0))}
      AND ${(me.maxAgePref ?? 120) + (me.flexibleAge ? AGE_FLEX_YEARS : 0)}
    AND ${candidateMeetsMySql(me)}
    AND u.discovery_category = ANY(${me.showMeCategories}::text[])
    AND COALESCE(u.last_active_at, u.created_at) >= ${quietSince}
    AND ${UNDER_AGE_HOLD_SQL}
    AND EXISTS (
      SELECT 1 FROM ${partySql(Prisma.sql`u.id`, now)} sender_party, ${partySql(Prisma.sql`${me.id}::uuid`, now)} my_party
      WHERE ((sender_party.verified AND my_party.verified AND sender_party.institution_id = my_party.institution_id)
          OR ${sameGroupSql("my_party", "sender_party")})
        AND (${!me.verifiedOnly} OR sender_party.verified)
    )
    AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
      (b.blocker_id = ${me.id}::uuid AND b.blocked_id = u.id) OR (b.blocked_id = ${me.id}::uuid AND b.blocker_id = u.id))`;
}

/** Great-circle distance in km, the same formula as `haversineKm`. */
function havSql(lat1: Prisma.Sql, lng1: Prisma.Sql, lat2: Prisma.Sql, lng2: Prisma.Sql) {
  return Prisma.sql`(12742 * asin(sqrt(LEAST(1.0, GREATEST(0.0,
    power(sin(radians((${lat2})::float8 - (${lat1})::float8) / 2), 2) +
    cos(radians((${lat1})::float8)) * cos(radians((${lat2})::float8)) *
    power(sin(radians((${lng2})::float8 - (${lng1})::float8) / 2), 2)
  )))))`;
}

// Use this predicate for retrieval and page revalidation. No rollout flag can remove it.
export function eligibleSql(
  me: User,
  now = new Date(),
  excludeSwipes = true,
): Prisma.Sql {
  // A viewer who is not set up - including one whose distance-mode location
  // has gone stale - is eligible for nobody, exactly as `mutuallyEligible`
  // says. Callers check this too, but the predicate must not depend on it.
  if (!setupComplete(me, now)) return Prisma.sql`FALSE`;
  const age = ageAt(me.birthday, now) ?? -1;
  const myFlex = me.flexibleAge ? AGE_FLEX_YEARS : 0;
  const candidateAge = Prisma.sql`EXTRACT(YEAR FROM age(${now.toISOString().slice(0, 10)}::date, u.birthday::date))`;

  // Scope reach, rules 3 and 5. The viewer's scope is known here; the
  // candidate's is read per row. campus_id comparisons against a NULL are
  // NULL, i.e. false. An unverified party has no institution, so it is never
  // "same institution" - only "same group".
  const sameInstitution = Prisma.sql`(viewer_party.institution_id = candidate_party.institution_id)`;
  const sameCampus = Prisma.sql`(${sameInstitution} AND u.campus_id IS NOT NULL AND u.campus_id = ${me.campusId}::uuid)`;
  const sameGroup = sameGroupSql("viewer_party", "candidate_party");
  const sameCity = Prisma.sql`(${sameGroup} AND viewer_party.city IS NOT NULL AND viewer_party.city = candidate_party.city)`;
  const reachFor = (scope: CollegeScope) =>
    scope === "campus"
      ? sameCampus
      : scope === "city"
        ? Prisma.sql`(${sameInstitution} OR ${sameCity})`
        : scope === "group"
          ? Prisma.sql`(${sameInstitution} OR ${sameGroup})`
          : sameInstitution;
  // An unverified party reaches its own campus only - its college with no
  // campus chosen (rule 5). Its campus counts only inside its college.
  const viewerCampusIn = Prisma.sql`(SELECT c.id FROM institution_campuses c
    WHERE c.id = ${me.campusId}::uuid AND c.is_active AND c.institution_id = viewer_party.institution_id)`;
  const viewerReach = Prisma.sql`(CASE WHEN viewer_party.verified THEN ${reachFor(reachScopeOf(me))}
    ELSE (${sameInstitution} AND (${viewerCampusIn} IS NULL OR u.campus_id = ${viewerCampusIn})) END)`;
  const candidateCampusIn = Prisma.sql`(SELECT c.id FROM institution_campuses c
    WHERE c.id = u.campus_id AND c.is_active AND c.institution_id = candidate_party.institution_id)`;
  // reachScopeOf(u) in SQL: one step wider when they asked to see further.
  const candidateReach = Prisma.sql`(CASE WHEN NOT candidate_party.verified
    THEN (${sameInstitution} AND (${candidateCampusIn} IS NULL OR ${candidateCampusIn} = ${me.campusId}::uuid))
    ELSE (CASE (CASE WHEN u.expand_radius THEN (CASE u.college_scope
      WHEN 'campus' THEN 'college' WHEN 'college' THEN 'city' WHEN 'city' THEN 'group' ELSE u.college_scope END)
    ELSE u.college_scope END)
    WHEN 'campus' THEN ${sameCampus}
    WHEN 'city' THEN (${sameInstitution} OR ${sameCity})
    WHEN 'group' THEN (${sameInstitution} OR ${sameGroup})
    ELSE ${sameInstitution} END) END)`;

  // A campus anchor counts only for a campus of the person's own institution.
  const candidateAnchorLat = Prisma.sql`(SELECT c.latitude FROM institution_campuses c
    WHERE c.id = u.campus_id AND c.is_active AND c.institution_id = candidate_party.institution_id)`;
  const candidateAnchorLng = Prisma.sql`(SELECT c.longitude FROM institution_campuses c
    WHERE c.id = u.campus_id AND c.is_active AND c.institution_id = candidate_party.institution_id)`;
  const viewerAnchorLat = Prisma.sql`(SELECT c.latitude FROM institution_campuses c
    WHERE c.id = ${me.campusId}::uuid AND c.is_active AND c.institution_id = viewer_party.institution_id)`;
  const viewerAnchorLng = Prisma.sql`(SELECT c.longitude FROM institution_campuses c
    WHERE c.id = ${me.campusId}::uuid AND c.is_active AND c.institution_id = viewer_party.institution_id)`;

  // A missing anchor must be tested for explicitly. Postgres's GREATEST()
  // ignores NULLs, so a NULL coordinate inside havSql() collapses to a
  // distance of 0 - "no campus pin" would read as "always in range".
  const viewerHasAnchor = Prisma.sql`(${viewerAnchorLat} IS NOT NULL AND ${viewerAnchorLng} IS NOT NULL)`;
  const candidateHasAnchor = Prisma.sql`(${candidateAnchorLat} IS NOT NULL AND ${candidateAnchorLng} IS NOT NULL)`;

  const candidateFresh = Prisma.sql`(u.latitude IS NOT NULL AND u.longitude IS NOT NULL
    AND u.location_consent_at IS NOT NULL AND u.location_updated_at >= ${staleCutoff(now)})`;
  const minute = istMinuteOfDay(now);
  // Visibility, not eligibility: invisible hours, and "hide me while I'm
  // here" while the phone is inside such a place (LOCATION_SPEC.md 7, 9.4).
  const candidateVisible = Prisma.sql`u.location_hidden_at IS NULL
    AND NOT (u.invisible_start IS NOT NULL AND u.invisible_end IS NOT NULL AND (CASE
    WHEN u.invisible_start < u.invisible_end THEN ${minute} >= u.invisible_start AND ${minute} < u.invisible_end
    ELSE ${minute} >= u.invisible_start OR ${minute} < u.invisible_end END))`;
  const candidateRadius = Prisma.sql`(CASE WHEN u.expand_radius THEN ${EXPANDED_RADIUS_KM} ELSE COALESCE(u.distance_preference, 100) END)`;

  const geography =
    me.discoveryMode === "college"
      ? Prisma.sql`(
          (u.discovery_mode = 'college' AND ${viewerReach} AND ${candidateReach})
          OR (u.discovery_mode = 'distance' AND ${viewerReach} AND ${candidateFresh} AND ${candidateVisible}
            AND ${viewerHasAnchor}
            AND ${havSql(viewerAnchorLat, viewerAnchorLng, Prisma.sql`u.latitude`, Prisma.sql`u.longitude`)} <= ${candidateRadius})
        )`
      : Prisma.sql`(
          (u.discovery_mode = 'distance' AND ${candidateFresh} AND ${candidateVisible}
            AND ${havSql(Prisma.sql`${Number(me.latitude)}`, Prisma.sql`${Number(me.longitude)}`, Prisma.sql`u.latitude`, Prisma.sql`u.longitude`)}
              <= LEAST(${effectiveRadiusKm(me)}, ${candidateRadius}))
          OR (u.discovery_mode = 'college' AND ${candidateReach}
            AND ${candidateHasAnchor}
            AND ${havSql(Prisma.sql`${Number(me.latitude)}`, Prisma.sql`${Number(me.longitude)}`, candidateAnchorLat, candidateAnchorLng)}
              <= ${effectiveRadiusKm(me)})
        )`;

  return Prisma.sql`u.id <> ${me.id}::uuid AND u.account_status = 'active' AND u.preferences_confirmed_at IS NOT NULL
    -- Paused after 14 days unverified: out of everyone's decks (GOOGLE_SIGNUP_PLAN.md 2.6). Visibility, not eligibility.
    AND u.paused_at IS NULL
    AND ${UNDER_AGE_HOLD_SQL}
    AND EXISTS (
      SELECT 1 FROM ${partySql(Prisma.sql`u.id`, now)} candidate_party, ${partySql(Prisma.sql`${me.id}::uuid`, now)} viewer_party
      WHERE ${geography}
        -- Verified only, both ways: a valid verification (rule 5).
        AND (${!me.verifiedOnly} OR candidate_party.verified)
        AND (NOT u.verified_only OR viewer_party.verified)
    )
    AND ${candidateAge} BETWEEN 18 AND 120
    AND ${candidateAge} BETWEEN ${Math.max(18, (me.minAgePref ?? 18) - myFlex)} AND ${(me.maxAgePref ?? 120) + myFlex}
    AND ${age} BETWEEN u.min_age_pref - (CASE WHEN u.flexible_age THEN ${AGE_FLEX_YEARS} ELSE 0 END)
      AND u.max_age_pref + (CASE WHEN u.flexible_age THEN ${AGE_FLEX_YEARS} ELSE 0 END)
    AND ${candidateMeetsMySql(me)}
    AND ${iMeetCandidateSql(me)}
    AND u.discovery_category = ANY(${me.showMeCategories}::text[])
    AND u.show_me_categories @> ARRAY[${me.discoveryCategory}]::text[]
    AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = ${me.id}::uuid AND b.blocked_id = u.id OFFSET 0)
    AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocked_id = ${me.id}::uuid AND b.blocker_id = u.id OFFSET 0)
    AND NOT EXISTS (SELECT 1 FROM swipes s WHERE s.swiper_id=u.id AND s.target_id=${me.id}::uuid AND s.action='pass' OFFSET 0)
    AND NOT EXISTS (SELECT 1 FROM matches m WHERE
      (m.user1_id = ${me.id}::uuid AND m.user2_id = u.id) OR (m.user2_id = ${me.id}::uuid AND m.user1_id = u.id) OFFSET 0)
    ${excludeSwipes ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM swipes s WHERE s.swiper_id = ${me.id}::uuid AND s.target_id = u.id OFFSET 0)` : Prisma.empty}`;
}
