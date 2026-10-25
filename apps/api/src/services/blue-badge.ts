/**
 * The blue badge: a valid college verification and a passed face check, both
 * current. Worked out on every read, so it goes when either lapses - college
 * verification expires, the face check is removed, or a changed photo no
 * longer matches. `isVerified` keeps meaning college verified: it unlocks
 * college-only features and the "Verified students only" preference.
 */
export function blueBadge(collegeVerified: boolean, realPersonVerifiedAt: Date | boolean | null | undefined) {
  return collegeVerified && !!realPersonVerifiedAt;
}

/** A valid college verification: verified, at a college still on the app, not expired. */
export function collegeVerifiedOf(membership: { status: string; verifiedAt: Date | null; expiresAt: Date | null; institution: { isActive: boolean } } | null | undefined) {
  return !!(membership?.status === 'verified' && membership.verifiedAt && membership.institution.isActive &&
    (!membership.expiresAt || membership.expiresAt > new Date()));
}

/** A person as Stories show them - name, photo and the blue badge - from one select. */
export const PERSON_WITH_BADGE = {
  id: true, name: true, avatarUrl: true, realPersonVerifiedAt: true,
  studentMembership: { select: { status: true, verifiedAt: true, expiresAt: true, institution: { select: { isActive: true } } } },
} as const;
export function personWithBadge(user: { id: string; name: string; avatarUrl: string | null; realPersonVerifiedAt: Date | null; studentMembership: Parameters<typeof collegeVerifiedOf>[0] }) {
  return { id: user.id, name: user.name, avatarUrl: user.avatarUrl, blueBadge: blueBadge(collegeVerifiedOf(user.studentMembership), user.realPersonVerifiedAt) };
}
