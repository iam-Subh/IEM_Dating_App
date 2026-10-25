import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { isValidCoords } from '../utils/geo';

/** Campus ids the app used before campuses came from the server. */
const LEGACY_CAMPUS_IDS: Record<string, string> = {
  management: 'MANAGEMENT_HOUSE',
  uem_newtown: 'NEW_TOWN',
  uem_jaipur: 'JAIPUR',
};

/**
 * Campuses of an institution (LOCATION_SPEC.md 8.1). A campus is always
 * looked up *within the person's own institution*: IEM's Gurukul in Salt Lake
 * and UEM Jaipur's Gurukul share a name and must never be confused.
 */
export class CampusService {
  /**
   * The person's institution: their verified college, else the one they chose
   * in onboarding (GOOGLE_SIGNUP_PLAN.md 1.3) - the campus list follows it.
   */
  static async institutionOf(userId: string) {
    const [membership, me] = await Promise.all([
      prisma.studentMembership.findUnique({ where: { userId }, select: { institutionId: true, verifiedAt: true } }),
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { claimedInstitutionId: true } }),
    ]);
    if (membership?.verifiedAt) return membership.institutionId;
    return me.claimedInstitutionId ?? membership?.institutionId ?? null;
  }

  static async forInstitution(institutionId: string) {
    const rows = await prisma.institutionCampus.findMany({
      where: { institutionId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, latitude: true, longitude: true },
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      // Whether the campus can anchor distance matching and appear on the map.
      mapped: row.latitude !== null && row.longitude !== null,
    }));
  }

  /** The signed-in person's campuses, and which one is theirs. */
  static async mine(userId: string) {
    const [institutionId, me] = await Promise.all([
      this.institutionOf(userId),
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { campusId: true } }),
    ]);
    if (!institutionId) return { campuses: [], campusId: null };
    const campuses = await this.forInstitution(institutionId);
    return {
      campuses,
      campusId: campuses.some((campus) => campus.id === me.campusId) ? me.campusId : null,
    };
  }

  /**
   * Turns what the app sends (a campus name such as "Gurukul", or a campus id)
   * into a campus of the person's own institution. Empty clears it.
   */
  static async resolveForUser(userId: string, value: unknown) {
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
    if (typeof value !== 'string') throw new HttpError(400, 'Choose a campus from the list.', 'CAMPUS_UNKNOWN');
    const institutionId = await this.institutionOf(userId);
    if (!institutionId) throw new HttpError(409, 'Choose your college first.', 'COLLEGE_REQUIRED');
    const wanted = value.trim().toLowerCase();
    // Older app builds send these ids; they resolve only if the campus is the
    // person's own institution's, like any other value.
    const alias = LEGACY_CAMPUS_IDS[wanted];
    const campuses = await prisma.institutionCampus.findMany({
      where: { institutionId, isActive: true },
      select: { id: true, name: true, code: true },
    });
    const campus = campuses.find(
      (entry) =>
        entry.id === value ||
        entry.name.toLowerCase() === wanted ||
        entry.code.toLowerCase() === wanted ||
        (!!alias && entry.code === alias),
    );
    if (!campus) throw new HttpError(400, 'Choose a campus from the list.', 'CAMPUS_UNKNOWN');
    return campus;
  }

  /** Admin: every campus, including those still waiting for a map pin. */
  static async all() {
    const rows = await prisma.institutionCampus.findMany({
      orderBy: [{ institutionId: 'asc' }, { sortOrder: 'asc' }],
      include: { institution: { select: { code: true, name: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      institution: row.institution.code,
      code: row.code,
      name: row.name,
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      isActive: row.isActive,
    }));
  }

  /**
   * Admin: set (or clear) a campus's public coordinates from a map pin. These
   * are institutional, not personal, and are stored as given.
   */
  static async setAnchor(campusId: string, coords: { latitude: number; longitude: number } | null) {
    if (coords && !isValidCoords(coords)) throw new HttpError(400, 'Invalid coordinates', 'INVALID_COORDINATES');
    const campus = await prisma.institutionCampus.findUnique({ where: { id: campusId }, select: { id: true } });
    if (!campus) throw new HttpError(404, 'Campus not found', 'CAMPUS_NOT_FOUND');
    await prisma.institutionCampus.update({
      where: { id: campusId },
      data: { latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null },
    });
    return (await this.all()).find((row) => row.id === campusId);
  }
}
