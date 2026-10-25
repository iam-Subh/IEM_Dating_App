import { VerificationLimitsService } from './verification-limits.service';
import { IdentityBanService } from './identity-ban.service';
import bcrypt from 'bcryptjs';
import { prisma } from '../utils/prisma';
import { signAccountSwitch, verifyAccountSwitch } from '../utils/jwt';
import { AccountLifecycleService } from './account-lifecycle.service';
import { HttpError } from '../utils/httpError';
import { OTPService } from './otp.service';
import { EmailService } from './email.service';
import { haversineKm, isValidCoords } from '../utils/geo';

/** How close an approximate fix must be to a campus to confirm it. Kolkata to Jaipur is ~1,350 km. */
export const CONFIRM_RADIUS_KM = 300;

export class StudentMembershipService {
  static async listInstitutions() {
    const institutions = await prisma.institution.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, campuses: true, allowedDomains: true, city: true,
        campusList: {
          where: {isActive: true},
          orderBy: [{sortOrder: 'asc'}, {name: 'asc'}],
          select: {id: true, name: true},
        },
      },
    });
    // A domain listed by more than one institution cannot say which one a
    // student belongs to, so the app asks for one approximate location check
    // for those (LOCATION_SPEC.md 8.2).
    return institutions.map(({ allowedDomains, ...institution }) => ({
      ...institution,
      // The app writes it after what the student types: "firstname.lastname2024" + "@iem.edu.in".
      emailDomain: allowedDomains[0] ?? null,
      domainShared: allowedDomains.some((domain) =>
        institutions.some((other) => other.id !== institution.id && other.allowedDomains.includes(domain))),
    }));
  }

  /** Every active institution that accepts this email domain. */
  static async sharedDomainInstitutions(domain: string) {
    return prisma.institution.findMany({
      where: { isActive: true, allowedDomains: { has: domain } },
      select: { id: true, code: true },
    });
  }

  /**
   * Whether an approximate location confirms the chosen institution: it must
   * fall within CONFIRM_RADIUS_KM of one of that institution's mapped
   * campuses. An institution with no mapped campus cannot be confirmed this
   * way and goes to admin review instead, because being far from Kolkata is
   * not evidence of being in Jaipur.
   */
  static async locationConfirms(institutionId: string, location?: { latitude: number; longitude: number }) {
    if (!location || !isValidCoords(location)) return false;
    const campuses = await prisma.institutionCampus.findMany({
      where: { institutionId, isActive: true, latitude: { not: null }, longitude: { not: null } },
      select: { latitude: true, longitude: true },
    });
    return campuses.some((campus) =>
      haversineKm(location, { latitude: Number(campus.latitude), longitude: Number(campus.longitude) }) <= CONFIRM_RADIUS_KM);
  }

  static async requireInstitution(institutionCode: string, email: string) {
    const domain = email.trim().toLowerCase().split('@')[1];
    const institution = await prisma.institution.findFirst({
      where: { code: institutionCode, isActive: true, allowedDomains: { has: domain } },
    });
    if (!institution) {
      throw new HttpError(400, 'Email domain does not match the selected college', 'INSTITUTION_EMAIL_MISMATCH');
    }
    return institution;
  }

  static async sendChallenge(institutionCode: string, email: string) {
    await this.requireInstitution(institutionCode, email);
    const challenge = await OTPService.issue(email, 'student_membership');
    try {
      await EmailService.sendOTP(email, challenge.code);
    } catch (error) {
      await OTPService.cancel(challenge.challengeId);
      throw error;
    }
    return { challengeId: challenge.challengeId, expiresIn: challenge.expiresIn };
  }

  static async verify(
    userId: string,
    institutionCode: string,
    email: string,
    challengeId: string,
    code: string,
    location?: { latitude: number; longitude: number },
    password?: string,
  ) {
    const normalizedEmail = email.trim().toLowerCase();
    const institution = await this.requireInstitution(institutionCode, normalizedEmail);
    // An account without a password sets one here (1.4): asked before the
    // code is used, so a missing password never wastes a code.
    const me = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
    if (!me.passwordHash && !password) {
      throw new HttpError(400, 'Set a password for your college email.', 'PASSWORD_REQUIRED');
    }
    const result = await OTPService.verify(normalizedEmail, 'student_membership', challengeId, code);
    if (!result.valid) throw new HttpError(400, result.error, 'INVALID_OTP');
    // A banned student's college email never verifies another account (6.1).
    await IdentityBanService.assertNotBanned({ collegeEmail: normalizedEmail });
    // The college email already has its own account (1.4): the code proves the
    // inbox is theirs, so offer to switch to it - never merge the two.
    const other = await this.accountWithCollegeEmail(normalizedEmail, userId);
    if (other) {
      const [matches, chats] = await Promise.all([
        prisma.match.count({ where: { OR: [{ user1Id: userId }, { user2Id: userId }] } }),
        prisma.chatParticipant.count({ where: { userId } }),
      ]);
      throw new HttpError(409, 'You already have an account with this college email.', 'COLLEGE_EMAIL_HAS_ACCOUNT', {
        switchToken: signAccountSwitch(userId, other),
        // Lost with this account if they switch: the app warns first.
        hasMatchesOrChats: matches + chats > 0,
      });
    }
    // A shared domain proves the group, not the campus (8.2). The location is
    // used for this one comparison and never stored.
    const domain = normalizedEmail.split('@')[1];
    const shared = (await this.sharedDomainInstitutions(domain)).length > 1;
    const campusConfirmed = !shared || (await this.locationConfirms(institution.id, location));
    const previous = await prisma.studentMembership.findUnique({ where: { userId }, select: { institutionId: true } });
    const chosen = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { claimedInstitutionId: true } });
    const previousInstitution = previous?.institutionId ?? chosen.claimedInstitutionId;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.studentMembership.upsert({
          where: { userId },
          create: {
            userId,
            institutionId: institution.id,
            institutionalEmail: normalizedEmail,
            status: 'verified',
            verifiedAt: now,
            expiresAt,
            campusConfirmed,
          },
          update: {
            institutionId: institution.id,
            institutionalEmail: normalizedEmail,
            status: 'verified',
            verificationMethod: 'institution_email',
            verifiedAt: now,
            expiresAt,
            campusConfirmed,
          },
        });
        await tx.user.update({
          where: { id: userId },
          data: {
            ...(password && !me.passwordHash ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
            college: institution.name,
            emailVerifiedAt: now,
            eligibilityVersion: { increment: 1 },
            // The verified college replaces the one chosen in onboarding (1.3).
            claimedInstitutionId: null,
            // Expiry reminders start over for the new verification (5). The
            // pause lifts below - unless the real-person check is still owed.
            expiryReminderLevel: 0,
            // A campus belongs to one institution; moving institution clears it.
            ...(previousInstitution && previousInstitution !== institution.id ? { campusId: null, campus: null } : {}),
          },
        });
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new HttpError(409, 'College email is linked to another account', 'MEMBERSHIP_EMAIL_IN_USE');
      }
      throw error;
    }
    await VerificationLimitsService.refreshPause(userId);
    return {
      status: 'verified',
      institution: { code: institution.code, name: institution.name },
      verifiedAt: now,
      expiresAt,
      // False: you can use the app inside your own college while an admin
      // confirms the campus; wider college scopes wait for that.
      campusConfirmed,
    };
  }

  /** Another account's college email: its main email, or another account's verified college email. */
  private static async accountWithCollegeEmail(email: string, userId: string) {
    const [byEmail, byMembership] = await Promise.all([
      prisma.user.findUnique({ where: { email }, select: { id: true, accountStatus: true } }),
      prisma.studentMembership.findFirst({ where: { institutionalEmail: email, userId: { not: userId } }, select: { userId: true } }),
    ]);
    if (byEmail && byEmail.id !== userId && byEmail.accountStatus !== 'deleted') return byEmail.id;
    return byMembership?.userId ?? null;
  }

  /**
   * "Use that one?" (1.4): Google moves to the account the college email
   * already has, the new account is deleted, and that account is signed in.
   */
  static async switchAccount(userId: string, switchToken: string) {
    const claim = verifyAccountSwitch(switchToken);
    if (!claim || claim.from !== userId) throw new HttpError(400, 'This request has expired. Verify again.', 'SWITCH_EXPIRED');
    const [current, target] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { googleSub: true, googleEmail: true } }),
      prisma.user.findUnique({ where: { id: claim.to } }),
    ]);
    if (!target || !['active', 'deletion_pending'].includes(target.accountStatus)) {
      throw new HttpError(404, 'That account is no longer available.', 'ACCOUNT_UNAVAILABLE');
    }
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { googleSub: null, googleEmail: null, googleLinkedAt: null } });
      if (current.googleSub && !target.googleSub) {
        await tx.user.update({
          where: { id: target.id },
          data: { googleSub: current.googleSub, googleEmail: current.googleEmail, googleLinkedAt: new Date() },
        });
      }
    });
    await AccountLifecycleService.deleteNow(userId);
    return prisma.user.findUniqueOrThrow({ where: { id: target.id } });
  }

  /**
   * "Later" on Verify your college (GOOGLE_SIGNUP_PLAN.md reminder 1): only a
   * Google account may go on unverified - a college-email sign-up is verified
   * at sign-up.
   */
  static async verifyLater(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { googleSub: true } });
    if (!user.googleSub) throw new HttpError(409, 'Verify your college email to continue.', 'VERIFY_REQUIRED');
    await prisma.user.update({ where: { id: userId }, data: { verifyLaterAt: new Date() } });
  }

  static async hasValidMembership(userId: string, now = new Date()) {
    return !!(await prisma.studentMembership.findFirst({
      where: {
        userId,
        status: 'verified',
        verifiedAt: { not: null },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        institution: { isActive: true },
      },
      select: { id: true },
    }));
  }

  static async compatibleMemberships(userIds: [string, string], requireSameInstitution: boolean, now = new Date()) {
    const memberships = await prisma.studentMembership.findMany({
      where: {
        userId: { in: userIds },
        status: 'verified',
        verifiedAt: { not: null },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        institution: { isActive: true },
      },
      select: { userId: true, institutionId: true },
    });
    if (memberships.length !== 2) return false;
    return !requireSameInstitution || memberships[0].institutionId === memberships[1].institutionId;
  }
}
