import { Prisma, User } from '@prisma/client';
import { z } from 'zod';
import { normalizeInterests } from '@iem-dating/shared/interest-catalog';

/**
 * "More criteria" in My preferences (PREFERENCES_SPEC.md).
 *
 * Every criterion is a question people answer on their profile. A choice is
 * soft by default - people who match come first, nobody is hidden. Marked
 * "Must match" it becomes a dealbreaker, and dealbreakers are two-sided, as
 * Hinge's are: you are only shown to each other when you both meet each
 * other's. That symmetry is what keeps it fair - nobody can see people who
 * could never see them.
 *
 * The rules live here twice, on purpose and side by side, like the rest of
 * eligibility: as SQL for retrieval, and as plain functions for the swipe
 * gate. Change one, change the other.
 */

export const MAX_REQUIRED = 3;
export const AGE_FLEX_YEARS = 2;

type Criterion =
  | { id: string; kind: 'set'; sql: Prisma.Sql; values: (user: User) => string[] }
  | { id: string; kind: 'range'; sql: Prisma.Sql; value: (user: User) => number | null };

/** A JSON value that is a string or a list of strings, as text[]. */
function jsonTextArray(path: Prisma.Sql) {
  return Prisma.sql`(CASE jsonb_typeof(${path})
    WHEN 'array' THEN ARRAY(SELECT jsonb_array_elements_text(${path}))
    WHEN 'string' THEN ARRAY[${path} #>> '{}']
    ELSE ARRAY[]::text[] END)`;
}
const strings = (value: unknown): string[] =>
  typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const one = (value: string | number | null | undefined) => (value === null || value === undefined || value === '' ? [] : [String(value)]);

const LIFESTYLE = ['drink', 'smoke', 'exercise', 'pets'];
const PERSONALITY = ['communication', 'love_reception', 'education', 'star_sign', 'personality'];

/** Each criterion: the candidate's answers as SQL over `u`, and the same read from a user row. */
export const CRITERIA: Criterion[] = [
  { id: 'gender', kind: 'set', sql: Prisma.sql`ARRAY_REMOVE(ARRAY[u.gender], NULL)`, values: (u) => one(u.gender) },
  { id: 'intention', kind: 'set', sql: Prisma.sql`ARRAY_REMOVE(ARRAY[u.seeking], NULL)`, values: (u) => one(u.seeking) },
  { id: 'interests', kind: 'set', sql: jsonTextArray(Prisma.sql`(u.preferences->'interests')`), values: (u) => normalizeInterests(object(u.preferences).interests) },
  { id: 'orientation', kind: 'set', sql: Prisma.sql`u.orientation`, values: (u) => u.orientation ?? [] },
  { id: 'height', kind: 'range', sql: Prisma.sql`u.height`, value: (u) => (typeof u.height === 'number' ? u.height : null) },
  ...LIFESTYLE.map((id): Criterion => ({
    id, kind: 'set',
    sql: jsonTextArray(Prisma.sql`(u.preferences->'lifestyle'->${id})`),
    values: (u) => strings(object(object(u.preferences).lifestyle)[id]),
  })),
  ...PERSONALITY.map((id): Criterion => ({
    id, kind: 'set',
    sql: jsonTextArray(Prisma.sql`(u.preferences->'personality'->${id})`),
    values: (u) => strings(object(object(u.preferences).personality)[id]),
  })),
  { id: 'degree', kind: 'set', sql: Prisma.sql`ARRAY_REMOVE(ARRAY[u.degree], NULL)`, values: (u) => one(u.degree) },
  { id: 'department', kind: 'set', sql: Prisma.sql`ARRAY_REMOVE(ARRAY[u.department], NULL)`, values: (u) => one(u.department) },
  { id: 'year', kind: 'set', sql: Prisma.sql`ARRAY_REMOVE(ARRAY[u.year_of_study::text], NULL)`, values: (u) => one(u.yearOfStudy) },
  { id: 'graduation', kind: 'set', sql: Prisma.sql`ARRAY_REMOVE(ARRAY[u.graduation_year::text], NULL)`, values: (u) => one(u.graduationYear) },
  {
    id: 'residency', kind: 'set',
    sql: Prisma.sql`(CASE u.is_hosteller WHEN true THEN ARRAY['hosteller'] WHEN false THEN ARRAY['day_scholar'] ELSE ARRAY[]::text[] END)`,
    values: (u) => (u.isHosteller === true ? ['hosteller'] : u.isHosteller === false ? ['day_scholar'] : []),
  },
  { id: 'clubs', kind: 'set', sql: Prisma.sql`u.clubs`, values: (u) => u.clubs ?? [] },
  { id: 'attendance', kind: 'set', sql: Prisma.sql`ARRAY_REMOVE(ARRAY[u.attendance_mood], NULL)`, values: (u) => one(u.attendanceMood) },
];
const BY_ID = new Map(CRITERIA.map((criterion) => [criterion.id, criterion]));

export type Selection = { values: string[]; required: boolean };
export type MatchCriteria = Record<string, Selection>;

export const matchCriteriaSchema = z
  .record(
    z.string(),
    z.object({
      values: z.array(z.string().trim().min(1).max(80)).max(60),
      required: z.boolean(),
    }),
  )
  .refine((value) => Object.keys(value).every((id) => BY_ID.has(id)), 'Unknown preference')
  .refine(
    (value) => Object.entries(value).every(([id, entry]) => {
      const criterion = BY_ID.get(id)!;
      if (criterion.kind !== 'range' || !entry.values.length) return true;
      const [low, high] = entry.values.map(Number);
      return entry.values.length === 2 && Number.isInteger(low) && Number.isInteger(high) && low >= 91 && high <= 244 && low <= high;
    }),
    'Height must be a range between 91 and 244 cm',
  );

/** What is stored: only choices that choose something, "required" only where it can apply. */
export function cleanCriteria(input: MatchCriteria): MatchCriteria {
  const out: MatchCriteria = {};
  for (const [id, entry] of Object.entries(input)) {
    const values = [...new Set(entry.values)];
    if (!values.length) continue;
    out[id] = { values, required: entry.required };
  }
  return out;
}

export function criteriaOf(user: Pick<User, 'matchCriteria'>): MatchCriteria {
  const raw = object(user.matchCriteria);
  const out: MatchCriteria = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (!BY_ID.has(id)) continue;
    const values = strings(object(entry).values);
    if (values.length) out[id] = { values, required: object(entry).required === true };
  }
  return out;
}

export const requiredIds = (criteria: MatchCriteria) =>
  Object.entries(criteria).filter(([, entry]) => entry.required).map(([id]) => id);

/** Your own answer to a criterion's question - a dealbreaker needs one (Bumble's rule). */
export function hasOwnAnswer(user: User, id: string) {
  const criterion = BY_ID.get(id);
  if (!criterion) return false;
  return criterion.kind === 'range' ? criterion.value(user) !== null : criterion.values(user).length > 0;
}

/** Does `candidate` answer one criterion the way `selection` asks? Unanswered never does. */
function satisfies(criterion: Criterion, selection: Selection, candidate: User) {
  if (criterion.kind === 'range') {
    const height = criterion.value(candidate);
    const [low, high] = selection.values.map(Number);
    return height !== null && height >= low && height <= high;
  }
  const theirs = criterion.values(candidate);
  return theirs.some((value) => selection.values.includes(value));
}

/** Every dealbreaker of `owner` holds for `candidate`. */
export function meetsRequired(owner: User, candidate: User) {
  const criteria = criteriaOf(owner);
  return requiredIds(criteria).every((id) => satisfies(BY_ID.get(id)!, criteria[id], candidate));
}

/** How many of `owner`'s soft choices `candidate` matches, and out of how many. */
export function softMatches(owner: User, candidate: User) {
  const criteria = criteriaOf(owner);
  const soft = Object.entries(criteria).filter(([, entry]) => !entry.required);
  let matched = 0;
  for (const [id, entry] of soft) if (satisfies(BY_ID.get(id)!, entry, candidate)) matched += 1;
  return { matched, of: soft.length };
}

/**
 * Soft preferences in the deck: a stable reorder of an already-ranked list.
 * Inside the strict age range before anyone let in only by "keep age
 * flexible", then those who match all your soft choices, then some, then
 * none. Within each group the ranking is untouched, and nobody is dropped.
 */
export function preferenceFirst(me: User, ranked: string[], people: Map<string, User>, ageOf: (user: User) => number | null) {
  const soft = Object.values(criteriaOf(me)).some((entry) => !entry.required);
  if (!soft && !me.flexibleAge) return ranked;
  const bucket = (id: string) => {
    const person = people.get(id);
    if (!person) return 9;
    const age = ageOf(person);
    const outsideStrict = age !== null && (age < (me.minAgePref ?? 18) || age > (me.maxAgePref ?? 120)) ? 3 : 0;
    if (!soft) return outsideStrict;
    const { matched, of } = softMatches(me, person);
    return outsideStrict + (matched === of ? 0 : matched > 0 ? 1 : 2);
  };
  return ranked
    .map((id, index) => ({ id, index, bucket: bucket(id) }))
    .sort((a, b) => a.bucket - b.bucket || a.index - b.index)
    .map((entry) => entry.id);
}

/** `meetsRequired(me, u)` as SQL over `u`. */
export function candidateMeetsMySql(me: User): Prisma.Sql {
  const criteria = criteriaOf(me);
  const clauses = requiredIds(criteria).map((id) => {
    const criterion = BY_ID.get(id)!;
    const selection = criteria[id];
    if (criterion.kind === 'range') {
      const [low, high] = selection.values.map(Number);
      return Prisma.sql`(${criterion.sql} BETWEEN ${low} AND ${high})`;
    }
    return Prisma.sql`(${criterion.sql} && ${selection.values}::text[])`;
  });
  return clauses.length ? Prisma.sql`(${Prisma.join(clauses, ' AND ')})` : Prisma.sql`TRUE`;
}

/**
 * `meetsRequired(u, me)` as SQL over `u`: for every criterion the candidate
 * made a dealbreaker, my own answer must be one they chose. My answers are
 * known here, so each becomes a plain array to compare against theirs.
 */
export function iMeetCandidateSql(me: User): Prisma.Sql {
  const clauses = CRITERIA.map((criterion) => {
    const entry = Prisma.sql`(u.match_criteria -> ${criterion.id})`;
    const isRequired = Prisma.sql`(COALESCE((${entry} ->> 'required')::boolean, false)
      AND jsonb_typeof(${entry} -> 'values') = 'array' AND jsonb_array_length(${entry} -> 'values') > 0)`;
    if (criterion.kind === 'range') {
      const mine = criterion.value(me);
      if (mine === null) return Prisma.sql`NOT ${isRequired}`;
      return Prisma.sql`(NOT ${isRequired} OR ${mine} BETWEEN ((${entry} -> 'values' ->> 0))::int AND ((${entry} -> 'values' ->> 1))::int)`;
    }
    const mine = criterion.values(me);
    if (!mine.length) return Prisma.sql`NOT ${isRequired}`;
    return Prisma.sql`(NOT ${isRequired} OR (${entry} -> 'values') ?| ${mine}::text[])`;
  });
  // Nobody has set a dealbreaker: skip the per-criterion work entirely.
  return Prisma.sql`(u.match_criteria = '{}'::jsonb OR (${Prisma.join(clauses, ' AND ')}))`;
}
