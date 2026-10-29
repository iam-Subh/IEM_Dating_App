import { demoProfiles } from "../discovery/demo/demoProfiles";
import type { ExploreProfile } from "../discovery/components/ExploreProfileCard";
import { exactName, matchesName, searchTokens, type MyDatingState, type SearchPerson, type SearchResult } from "./searchTypes";

/**
 * Search demo (development builds only). Every state of SEARCH_SPEC.md on
 * local data, touching no server: token-prefix matching, the ordering rules,
 * the 30-result cap ("das"), Follow in each state, a dating layer that opens
 * for the deck's demo profiles, and the one uniform refusal for everyone else.
 *
 * Try: "sub" or "pat" (dating profile opens; verified, follows you, counts),
 * "rohan" (counts hidden by his own setting), "arjun" (the uniform
 * refusal), "das" (truncated), "ro" (a follow ranks first), "hank" (nothing).
 *
 * Your own decisions, in place of "View dating profile": "alex" (matched, with
 * Message), "ishita" (you liked her), "neha" (you sent a Rose), "kabir" (you
 * passed).
 */

type DemoPerson = SearchPerson & {
  /** For the ordering demo: they follow you, or you matched. */
  followsMe?: boolean;
  matched?: boolean;
  /** The deck card behind "View dating profile"; absent means the uniform refusal. */
  card?: ExploreProfile;
  /** Something you already decided about them, before this demo started. */
  decided?: MyDatingState;
};

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

/** One person per decision you can already have made. */
function decidedPerson(id: string, name: string, department: string, decided: MyDatingState, extra: Partial<DemoPerson> = {}): DemoPerson {
  return {
    id: `demo-${id}`,
    name,
    avatarUrl: null,
    department,
    year: 2027,
    degree: "B.Tech",
    yearOfStudy: 3,
    graduationYear: 2027,
    campus: "Salt Lake",
    clubs: [],
    isVerified: true,
    followStatus: null,
    followsYou: false,
    followersCount: null,
    followingCount: null,
    decided,
    ...extra,
  };
}

const cardOf = (id: string) => demoProfiles.find((profile) => profile.id === id);

/** The deck's demo profiles, given surnames so search by surname has something to find. */
const SURNAMES: Record<string, string> = {
  aanya: "Aanya Sen",
  rohan: "Rohan Mehta",
  maya: "Maya Iyer",
  rupsa: "Rupsa Das",
  subh: "Subhankar Patra",
  alexandria: "Alexandria-Rose With A Long Name",
};

function fromCard(id: string, extra: Partial<DemoPerson> = {}): DemoPerson | null {
  const card = cardOf(id);
  if (!card) return null;
  const name = SURNAMES[id] ?? card.name;
  return {
    id: `demo-${id}`,
    name,
    ...SOCIAL[id],
    avatarUrl: card.primaryPhoto ?? null,
    department: card.department ?? null,
    year: card.graduationYear ?? card.yearOfStudy ?? null,
    degree: card.degree ?? null,
    yearOfStudy: card.yearOfStudy ?? null,
    graduationYear: card.graduationYear ?? null,
    campus: card.campus ?? "Salt Lake",
    clubs: (card.clubs ?? []).slice(0, 3),
    // Everyone Search can reach holds a verified membership, as on the server.
    isVerified: true,
    followStatus: null,
    card: { ...card, id: `demo-${id}`, name: name.split(" ")[0] },
    ...extra,
  };
}

/**
 * Social layer counts for the demo. Null means none are shown: Rohan has
 * turned off "Show follower counts", and Alexandria has Stories off.
 */
const SOCIAL: Record<string, Pick<SearchPerson, "followersCount" | "followingCount">> = {
  aanya: { followersCount: 214, followingCount: 180 },
  rohan: { followersCount: null, followingCount: null },
  maya: { followersCount: 342, followingCount: 290 },
  rupsa: { followersCount: 158, followingCount: 173 },
  subh: { followersCount: 127, followingCount: 149 },
  alexandria: { followersCount: null, followingCount: null },
};

const DEPARTMENTS = ["Computer Science", "Electronics", "Mechanical", "Information Technology", "Civil", "BBA"];
const FIRST = [
  "Ankit", "Arpita", "Debjit", "Riya", "Sayan", "Tanisha", "Aritra", "Sneha", "Kaushik", "Moumita",
  "Rahul", "Priyanka", "Sourav", "Ananya", "Abhishek", "Payel", "Sagnik", "Srijita", "Arnab", "Trisha",
  "Soham", "Ishani", "Rajdeep", "Poulami", "Nilanjan", "Oindrila", "Subham", "Rimjhim", "Anirban", "Koyel",
  "Dipanjan", "Shreya", "Pritam", "Madhurima", "Arijit",
];

/** Demo Story rings, lasting ten hours from whenever the demo is searched. */
function demoRing(kind: "unseen" | "close" | "seen"): SearchPerson["story"] {
  return {
    unseen: kind !== "seen",
    closeFriends: kind === "close",
    until: new Date(Date.now() + 10 * 60 * 60_000).toISOString(),
  };
}
const DEMO_RINGS: Record<string, SearchPerson["story"]> = {
  "demo-maya": demoRing("unseen"),
  "demo-aanya": demoRing("close"),
  "demo-rohan": demoRing("seen"),
};

/** What the live demo changes on Subhankar's open profile: a Story, then a new photo. */
export const DEMO_LIVE = {
  id: "demo-subh",
  newPhoto: cardOf("subh")?.photos?.[1] ?? null,
  ring: () => demoRing("unseen"),
  /** Maya's gradient ring turns green: a Close Friends Story, posted live. */
  closeFriendsId: "demo-maya",
  closeFriendsRing: () => demoRing("close"),
};

/** A cohort that shares a surname, so "das" hits the 30-result cap. */
const cohort: DemoPerson[] = FIRST.map((first, index) => ({
  id: `demo-das-${index}`,
  name: `${first} Das`,
  avatarUrl: null,
  department: DEPARTMENTS[index % DEPARTMENTS.length],
  year: 2026 + (index % 4),
  isVerified: true,
  followStatus: null,
  degree: index % 4 === 3 ? "BBA" : "B.Tech",
  yearOfStudy: 1 + (index % 4),
  graduationYear: 2026 + (index % 4),
  campus: index % 2 ? "Gurukul" : "Salt Lake",
  clubs: [["Music"], ["Robotics", "Quiz"], [], ["Dance", "Photography"]][index % 4],
  followsYou: index % 7 === 0,
  // Some share people you follow: "You both follow N people".
  mutualFollows: index % 3 === 0 ? 0 : 1 + ((index * 5) % 9),
  // Every third has Stories off: no social profile, so no counts.
  followersCount: index % 3 === 2 ? null : 20 + ((index * 37) % 180),
  followingCount: index % 3 === 2 ? null : 30 + ((index * 53) % 160),
}));

export const DEMO_PEOPLE: DemoPerson[] = [
  fromCard("aanya"),
  // You follow each other: "Following", with "Follows you" beside it.
  fromCard("rohan", { followStatus: "accepted", followsMe: true, followsYou: true, mutualFollows: 4 }),
  fromCard("maya", { followsMe: true, followsYou: true }),
  fromCard("rupsa"),
  fromCard("subh", { isVerified: true, followsMe: true, followsYou: true }),
  // Matched already, so first in results - and the deck would not offer a Like again.
  fromCard("alexandria", { matched: true }),
  // Your own decisions, each shown in place of "View dating profile".
  decidedPerson("ishita", "Ishita Roy", "Computer Science", { kind: "liked", at: daysAgo(2) },
    { clubs: ["Photography"], followersCount: 64, followingCount: 71 }),
  decidedPerson("neha", "Neha Kapoor", "Information Technology", { kind: "rose", at: daysAgo(5) },
    { clubs: ["Dance"], followStatus: "accepted", followsYou: true, followersCount: 140, followingCount: 98 }),
  decidedPerson("kabir", "Kabir Malhotra", "Mechanical", { kind: "passed", at: daysAgo(9) }),
  // Findable, but a deck Like would not be allowed - the refusal demo.
  {
    id: "demo-arjun",
    name: "Arjun Banerjee",
    avatarUrl: null,
    department: "Electronics",
    year: 2027,
    degree: "B.Tech",
    yearOfStudy: 2,
    graduationYear: 2027,
    campus: "Salt Lake",
    clubs: ["Debate"],
    isVerified: true,
    followStatus: "pending",
    followsYou: false,
    followersCount: 88,
    followingCount: 102,
  },
  {
    id: "demo-rohit",
    name: "Rohit Sen",
    avatarUrl: null,
    department: "Mechanical",
    year: 3,
    degree: "B.Tech",
    yearOfStudy: 3,
    graduationYear: null,
    campus: null,
    clubs: [],
    isVerified: true,
    followStatus: null,
    followsYou: false,
    followersCount: null,
    followingCount: null,
  },
  ...cohort,
].filter((person): person is DemoPerson => !!person);

/** The server's query and ordering, run over the demo people. */
export function searchDemo(
  query: string,
  follows: Record<string, SearchPerson["followStatus"]>,
  decided: { get(id: string): SearchPerson["dating"] | undefined } = new Map(),
): SearchResult {
  const tokens = searchTokens(query.trim());
  if (query.trim().length < 2 || !tokens.length) return { people: [], truncated: false };
  const followOf = (person: DemoPerson) => (person.id in follows ? follows[person.id] : person.followStatus);
  const found = DEMO_PEOPLE.filter((person) => matchesName(person.name, tokens))
    .map((person) => ({ person, follow: followOf(person) }))
    .sort((a, b) => {
      const close = (entry: typeof a) => Number(entry.follow === "accepted" || !!entry.person.matched);
      return (
        close(b) - close(a) ||
        Number(!!b.person.followsMe) - Number(!!a.person.followsMe) ||
        Number(exactName(b.person.name, tokens)) - Number(exactName(a.person.name, tokens)) ||
        a.person.name.toLowerCase().localeCompare(b.person.name.toLowerCase())
      );
    });
  return {
    people: found.slice(0, 30).map(({ person, follow }) => ({
      id: person.id,
      name: person.name,
      avatarUrl: person.avatarUrl,
      department: person.department,
      year: person.year,
      isVerified: person.isVerified,
      blueBadge: person.blueBadge ?? person.isVerified,
      followStatus: follow ?? null,
      followsYou: !!person.followsYou,
      degree: person.degree ?? null,
      yearOfStudy: person.yearOfStudy ?? null,
      graduationYear: person.graduationYear ?? null,
      campus: person.campus ?? null,
      clubs: person.clubs ?? [],
      story: DEMO_RINGS[person.id] ?? null,
      followersCount: person.followersCount ?? null,
      followingCount: person.followingCount ?? null,
      // As the server: a match first, then what you decided in this demo.
      dating: person.matched
        ? { kind: "matched" as const, matchId: `demo-match-${person.id}`, at: new Date(Date.now() - 3 * 86_400_000).toISOString() }
        : decided.get(person.id) ?? person.decided ?? null,
    })),
    truncated: found.length > 30,
  };
}

/** The dating layer's answer in the demo: the card, or null for the uniform refusal. */
export function demoDatingProfile(id: string, liked: { has(id: string): boolean }): ExploreProfile | null {
  const person = DEMO_PEOPLE.find((entry) => entry.id === id);
  // Matched or already liked: exactly the cases the deck would not offer again.
  if (!person?.card || person.matched || liked.has(id)) return null;
  return person.card;
}
