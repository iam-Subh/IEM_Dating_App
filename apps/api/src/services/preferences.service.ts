import { Prisma, User } from '@prisma/client';
import { z } from 'zod';
import { toRadiusPreset } from '@iem-dating/shared/location';
import { PREFERENCE_AGE_MAX, PREFERENCE_AGE_MIN, clampAgePreference } from '@iem-dating/shared/age';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { ageAt, asViewer, eligibleSql, hasFreshLocation, setupComplete } from './eligibility.service';
import { ERASED_POSITION, LocationService, SAVE_PLACE_FIX_MINUTES } from './location.service';
import { CRITERIA, MAX_REQUIRED, cleanCriteria, criteriaOf, hasOwnAnswer, matchCriteriaSchema, requiredIds } from './match-criteria';
import { LikesService } from './likes.service';

/**
 * My preferences (PREFERENCES_SPEC.md): one read, one save on Done, and a
 * live estimate while editing. The basics are the same fields discovery
 * settings always had; "More criteria", flexible age and verified-only are
 * new. Every surface that shows people reads them through `eligibleSql`, so
 * one save changes the deck, Explore, Standouts, the map and Likes You alike.
 */

export const AREAS = ['campus', 'college', 'city', 'group', 'nearby'] as const;
/** What is saved: three choices (GOOGLE_SIGNUP_PLAN.md 2.1). Older apps' "campus" and "group" map onto them. */
const SIMPLE_AREA = { campus: 'campus', college: 'college', city: 'city', group: 'city', nearby: 'nearby' } as const;

export const preferencesSchema = z
  .object({
    show: z.array(z.enum(['man', 'woman', 'nonbinary'])).min(1).max(3),
    // 18-35 (@iem-dating/shared/age): the latest usual PhD finish, plus five.
    minimumAge: z.number().int().min(18).max(120).transform(clampAgePreference),
    maximumAge: z.number().int().min(18).max(120).transform(clampAgePreference),
    flexibleAge: z.boolean(),
    area: z.enum(AREAS).transform((area) => SIMPLE_AREA[area]),
    // Rounded up to a preset, as discovery settings always were.
    distance: z.number().int().min(1).max(100).transform((value) => toRadiusPreset(value)),
    flexibleArea: z.boolean(),
    verifiedOnly: z.boolean(),
    criteria: matchCriteriaSchema,
  })
  .strict()
  .refine((value) => value.minimumAge <= value.maximumAge, 'Minimum age exceeds maximum age');
export type PreferencesInput = z.infer<typeof preferencesSchema>;

type Fields = Pick<User,
  'showMeCategories' | 'minAgePref' | 'maxAgePref' | 'flexibleAge' | 'discoveryMode' | 'collegeScope'
  | 'distancePreference' | 'expandRadius' | 'verifiedOnly'> & { matchCriteria: Prisma.InputJsonValue };

/** The input as user columns. "Nearby" is distance mode; the rest are college scopes. */
function fieldsOf(input: PreferencesInput, current: User): Fields {
  return {
    showMeCategories: [...new Set(input.show)],
    minAgePref: input.minimumAge,
    maxAgePref: input.maximumAge,
    flexibleAge: input.flexibleAge,
    discoveryMode: input.area === 'nearby' ? 'distance' : 'college',
    // A college scope is kept while "nearby" is on, so switching back restores it.
    collegeScope: input.area === 'nearby' ? current.collegeScope : input.area,
    distancePreference: input.distance,
    expandRadius: input.flexibleArea,
    verifiedOnly: input.verifiedOnly,
    matchCriteria: cleanCriteria(input.criteria) as Prisma.InputJsonValue,
  };
}

export class PreferencesService {
  static async read(userId: string) {
    const me = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const areaOptions = await this.areaOptions(me);
    const shape = this.shape(me);
    return { ...shape, area: this.allowedArea(shape.area, areaOptions), areaOptions };
  }

  /** A locked choice reads (and saves) as what the person actually gets: their campus before verifying (2.1). */
  private static allowedArea(area: string, options: Awaited<ReturnType<typeof PreferencesService.areaOptions>>) {
    // One campus: "My campus" is the whole college.
    if (area === 'college' && !options.college) return options.campus ? 'campus' : area;
    const locked = (area === 'college' && options.college?.locked) || (area === 'city' && options.city.locked);
    if (!locked) return area;
    return options.campus ? 'campus' : 'college';
  }

  /**
   * "Who you see", in the person's own words (GOOGLE_SIGNUP_PLAN.md 2.1):
   * their college by its short name ("IEM", "UEM Newtown"), and the colleges
   * of their city ("IEM & UEM Newtown"). Before verifying, "your college"
   * is locked: a chosen college proves nothing.
   */
  static async areaOptions(me: User) {
    const membership = await prisma.studentMembership.findUnique({
      where: { userId: me.id },
      select: { status: true, verifiedAt: true, expiresAt: true, institutionId: true },
    });
    const verified = !!(membership?.status === 'verified' && membership.verifiedAt && (!membership.expiresAt || membership.expiresAt > new Date()));
    const institutionId = verified ? membership!.institutionId : me.claimedInstitutionId ?? membership?.institutionId ?? null;
    const mine = institutionId
      ? await prisma.institution.findUnique({
        where: { id: institutionId },
        select: { id: true, name: true, shortName: true, city: true, groupCode: true, campusList: { where: { isActive: true }, select: { name: true }, orderBy: { sortOrder: 'asc' } } },
      })
      : null;
    const short = (row: { name: string; shortName: string | null }) => row.shortName || row.name;
    const city = mine?.city && mine.groupCode
      ? await prisma.institution.findMany({ where: { isActive: true, city: mine.city, groupCode: mine.groupCode }, select: { id: true, name: true, shortName: true } })
      : [];
    const cityNames = [...city.filter((row) => row.id === mine?.id), ...city.filter((row) => row.id !== mine?.id)].map(short);
    const campuses = mine?.campusList.map((campus) => campus.name) ?? [];
    const myCampus = me.campusId
      ? await prisma.institutionCampus.findFirst({ where: { id: me.campusId, isActive: true, institutionId: mine?.id }, select: { name: true } })
      : null;
    const verifyFirst = verified ? null : 'Verify your college to choose this';
    return {
      // My campus: the one choice before verifying, with People near me (2.1).
      campus: myCampus
        ? { label: `My campus · ${myCampus.name}`, detail: `Students from ${mine ? short(mine) : 'your college'} ${myCampus.name}`, locked: false, lockedReason: null }
        : null,
      // A college with one campus: "My campus" says it all.
      college: campuses.length > 1 || !myCampus
        ? {
          label: `All ${mine ? short(mine) : 'college'} campuses`,
          detail: campuses.length ? campuses.join(', ') : 'Students from your college',
          // With no campus chosen, an unverified account's reach is its college.
          locked: !verified && !!myCampus,
          lockedReason: !verified && !!myCampus ? verifyFirst : null,
        }
        : null,
      city: {
        label: cityNames.length > 1 ? cityNames.join(' & ') : mine ? short(mine) : 'Both colleges',
        detail: cityNames.length === 2 ? 'Both colleges' : cityNames.length > 2 ? `All colleges in ${mine?.city}` : 'Colleges in your city',
        locked: !verified,
        lockedReason: verifyFirst,
      },
      nearby: { label: 'People near me', detail: 'Anyone within a distance you choose', locked: false, lockedReason: null },
    };
  }

  private static shape(me: User) {
    return {
      show: me.showMeCategories,
      minimumAge: clampAgePreference(me.minAgePref ?? PREFERENCE_AGE_MIN),
      maximumAge: clampAgePreference(me.maxAgePref ?? 30),
      ageLimits: { minimum: PREFERENCE_AGE_MIN, maximum: PREFERENCE_AGE_MAX },
      flexibleAge: me.flexibleAge,
      area: me.discoveryMode === 'distance' ? 'nearby' : SIMPLE_AREA[(me.collegeScope ?? 'college') as keyof typeof SIMPLE_AREA] ?? 'college',
      distance: me.distancePreference ?? 25,
      flexibleArea: me.expandRadius,
      verifiedOnly: me.verifiedOnly,
      criteria: criteriaOf(me),
      // Which questions you have answered yourself: "Must match" needs one.
      ownAnswers: Object.fromEntries(CRITERIA.map((criterion) => [criterion.id, hasOwnAnswer(me, criterion.id)])),
      maxRequired: MAX_REQUIRED,
      confirmedAt: me.preferencesConfirmedAt,
    };
  }

  /** The rules a save must pass, whether saving or only estimating. */
  private static check(me: User, input: PreferencesInput) {
    const required = requiredIds(cleanCriteria(input.criteria));
    if (required.length > MAX_REQUIRED) {
      throw new HttpError(400, `You can make up to ${MAX_REQUIRED} preferences "Must match"`, 'TOO_MANY_REQUIRED');
    }
    if (input.area === 'campus' && !me.campusId) {
      throw new HttpError(400, 'Choose your campus in your profile first', 'CAMPUS_REQUIRED');
    }
    const unanswered = required.find((id) => !hasOwnAnswer(me, id));
    if (unanswered) {
      throw new HttpError(400, 'Answer this on your own profile before making it "Must match"', 'CRITERION_NEEDS_OWN_ANSWER');
    }

  }

  /**
   * Only the area changes - Location settings' "Use People nearby" and "Use
   * college mode". Everything else is saved as it is, through the same save,
   * so its checks (a fresh or just-shared location for nearby) still hold.
   */
  static async switchArea(userId: string, area: 'nearby' | 'college') {
    const me = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const current = this.shape(me);
    const input = preferencesSchema.parse({
      show: current.show.filter((value) => ['man', 'woman', 'nonbinary'].includes(value)),
      minimumAge: current.minimumAge,
      maximumAge: current.maximumAge,
      flexibleAge: current.flexibleAge,
      // Back to college mode: the scope they had before nearby.
      area: area === 'nearby' ? 'nearby' : (AREAS as readonly string[]).includes(me.collegeScope) ? me.collegeScope : 'college',
      distance: current.distance,
      flexibleArea: current.flexibleArea,
      verifiedOnly: current.verifiedOnly,
      criteria: current.criteria,
    });
    return this.save(userId, input);
  }

  /** Done: everything in one save. */
  static async save(userId: string, input: PreferencesInput) {
    const me = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const age = ageAt(me.birthday);
    if (age === null || age < 18 || age > 120) throw new HttpError(400, 'Set a valid adult birthday in your profile');
    if (!me.discoveryCategory) throw new HttpError(400, 'Finish your profile first', 'PROFILE_INCOMPLETE');
    this.check(me, input);
    // A locked choice is saved as what they actually get (2.1).
    if (input.area !== 'nearby') input = { ...input, area: this.allowedArea(input.area, await this.areaOptions(me)) as PreferencesInput['area'] };
    const fields = fieldsOf(input, me);
    if (fields.discoveryMode === 'college' && !me.college?.trim()) throw new HttpError(400, 'Set your college first');

    // Nearby needs a location recent enough to use; a fix shared moments ago
    // is promoted, exactly as discovery settings do (LOCATION_SPEC.md 6.8).
    const justShared = me.liveLatitude !== null && me.liveLongitude !== null && !!me.liveUpdatedAt
      && Date.now() - me.liveUpdatedAt.getTime() <= SAVE_PLACE_FIX_MINUTES * 60_000;
    const promote = fields.discoveryMode === 'distance' && !hasFreshLocation(me) && justShared && !!me.locationConsentAt;
    if (fields.discoveryMode === 'distance' && !hasFreshLocation(me) && !promote) {
      throw new HttpError(400, 'Share your location first, or choose an area at your college', 'LOCATION_REQUIRED');
    }
    // Only a real change to the radius counts against the daily budget.
    const radiusChanged = await LocationService.assertRadiusChangeAllowed(userId, me.distancePreference, fields.distancePreference ?? undefined);

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.user.update({
        where: { id: userId },
        data: {
          ...fields,
          preferencesConfirmedAt: new Date(),
          // Every open deck and cursor is stale now.
          eligibilityVersion: { increment: 1 },
          // College mode keeps no coordinates (LOCATION_SPEC.md 6.6).
          ...(fields.discoveryMode === 'college' ? ERASED_POSITION : {}),
          ...(promote
            ? { latitude: me.liveLatitude, longitude: me.liveLongitude, locationUpdatedAt: new Date(), locationSource: 'live', activePlaceId: null }
            : {}),
        },
      });
      // The first completed setup creates one inbox welcome, including when
      // two confirmation requests arrive together. Later saves do not recreate it.
      if (!me.preferencesConfirmedAt) {
        await tx.notification.createMany({
          data: [{
            userId,
            type: 'system',
            title: 'Welcome to IEM Connect',
            body: 'Meet people from your college. Start by exploring profiles.',
            deliveryKey: `account-welcome:${userId}`,
            actionUrl: '/main',
          }],
          skipDuplicates: true,
        });
      }
      return saved;
    });
    if (radiusChanged) await LocationService.recordRadiusChange(userId);
    // Likes You follows the new filters on every device.
    LikesService.nudge([userId]);
    return this.shape(updated);
  }

  /**
   * About how many people these choices would show - before saving. Coarse on
   * purpose: an exact count of classmates who fit a filter is a way to
   * identify them, so it is a band, never a number.
   */
  static async estimate(userId: string, input: PreferencesInput) {
    const me = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    try {
      this.check(me, input);
    } catch (error) {
      if (error instanceof HttpError) return { band: 'blocked' as const, reason: error.code ?? null, message: error.message };
      throw error;
    }
    const draft = asViewer({ ...me, ...fieldsOf(input, me), matchCriteria: cleanCriteria(input.criteria) } as User);
    if (!setupComplete(draft)) {
      return {
        band: 'unknown' as const,
        reason: draft.discoveryMode === 'distance' ? 'LOCATION_REQUIRED' : 'PROFILE_INCOMPLETE',
        message: draft.discoveryMode === 'distance' ? 'Share your location to see people nearby.' : 'Finish your profile first.',
      };
    }
    const [row] = await prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM (
        SELECT 1 FROM users u WHERE ${eligibleSql(draft)} LIMIT 60
      ) pool`;
    const count = row?.count ?? 0;
    return {
      band: count === 0 ? ('none' as const) : count < 10 ? ('few' as const) : count < 50 ? ('some' as const) : ('many' as const),
      reason: null,
      message: null,
    };
  }
}
