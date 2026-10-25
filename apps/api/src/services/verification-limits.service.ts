import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';

/**
 * What waits for a college verification (apps/mobile/src/features/auth/GOOGLE_SIGNUP_PLAN.md 2.2-2.7).
 *
 * "Limited" means never verified - a Google sign-up that has not verified its
 * college email yet. A verification that expired is not limited: those people
 * were checked once, and only lose the badge (section 5).
 *
 * Every refusal carries a code the app turns into the rules screen (2.4).
 */

/** Messages an unverified account may send, across all its chats (2.3). */
export const CHAT_MESSAGE_LIMIT = 30;
/** From here the chat shows "N messages left". */
export const CHAT_WARNING_FROM = 25;
/** Voice notes are allowed and counted; every other attachment waits (2.2). */
const VOICE_EXTENSIONS = new Set(['m4a', 'wav']);
/** Likes a day before verifying, resetting at midnight IST (2.2); the counter shows from 5 left. */
export const DAILY_LIKE_LIMIT = 25;
/** Follow requests a day before verifying (2.7). */
export const DAILY_FOLLOW_LIMIT = 10;
/** Days to verify before the profile pauses (2.6). */
export const GRACE_DAYS = 14;
const DAY_MS = 24 * 60 * 60_000;

type Db = Prisma.TransactionClient | typeof prisma;

/** The start of today in India: likes and follow requests reset at midnight IST. */
export function istMidnight(now = new Date()) {
  const shifted = new Date(now.getTime() + 5.5 * 60 * 60_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 5.5 * 60 * 60_000);
}

/**
 * The real-person check is required of Google accounts (PHOTO_VERIFICATION_PLAN.md D1)
 * once the app with the selfie camera is out - until then nobody could do it,
 * so it is switched on by REAL_PERSON_REQUIRED=true.
 */
export function realPersonEnforced() {
  return process.env.REAL_PERSON_REQUIRED === 'true';
}

/**
 * SQL over `u`: still owes the real-person check - made with Google and never
 * passed. A photo changed after passing only pauses the status, never the profile.
 */
export const OWES_REAL_PERSON_SQL = `(u.google_sub IS NOT NULL AND u.google_linked_at < u.created_at + interval '1 minute'
  AND u.real_person_passed_at IS NULL)`;

export class VerificationLimitsService {
  /** What still stands between this account and staying visible after 14 days. */
  static async owed(userId: string) {
    const [membership, user] = await Promise.all([
      prisma.studentMembership.findUnique({ where: { userId }, select: { verifiedAt: true } }),
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { googleSub: true, googleLinkedAt: true, createdAt: true, realPersonPassedAt: true } }),
    ]);
    const madeWithGoogle = !!(user.googleSub && user.googleLinkedAt && user.googleLinkedAt.getTime() - user.createdAt.getTime() < 60_000);
    return {
      college: !membership?.verifiedAt,
      // Never passed - not "a photo needs fixing", which never pauses the profile.
      realPerson: realPersonEnforced() && madeWithGoogle && !user.realPersonPassedAt,
      realPersonRequired: madeWithGoogle,
    };
  }

  /** Unpauses at once when nothing is owed any more (GOOGLE_SIGNUP_PLAN.md 2.6). */
  static async refreshPause(userId: string) {
    const owed = await this.owed(userId);
    if (owed.college || owed.realPerson) return false;
    const done = await prisma.user.updateMany({
      where: { id: userId, pausedAt: { not: null } },
      data: { pausedAt: null, graceWarningLevel: 0, eligibilityVersion: { increment: 1 } },
    });
    return done.count > 0;
  }

  /** Never verified: no membership has ever been verified. */
  static async isLimited(userId: string, db: Db = prisma) {
    const membership = await db.studentMembership.findUnique({ where: { userId }, select: { verifiedAt: true } });
    return !membership?.verifiedAt;
  }

  /**
   * Likes left today, for the counter (null: no limit). A Rose is a Like too.
   */
  static async likesLeft(userId: string, db: Db = prisma) {
    if (!(await this.isLimited(userId, db))) return null;
    const used = await db.swipe.count({ where: { swiperId: userId, action: 'like', createdAt: { gte: istMidnight() } } });
    return Math.max(0, DAILY_LIKE_LIMIT - used);
  }

  /**
   * The Like gate, inside the swipe's transaction: a paused profile cannot
   * like at all (2.6), and an unverified one 25 times a day.
   */
  static async requireCanLike(db: Db, viewer: { id: string; pausedAt: Date | null }) {
    if (viewer.pausedAt) {
      throw new HttpError(403, 'Your profile is paused. Verify your college to start liking again.', 'PROFILE_PAUSED');
    }
    const left = await this.likesLeft(viewer.id, db);
    if (left !== null && left <= 0) {
      throw new HttpError(429, "You've used today's 25 likes. Verify your college for unlimited likes.", 'LIKE_LIMIT_UNVERIFIED',
        { limit: DAILY_LIKE_LIMIT });
    }
  }

  /** Follow requests: 10 a day before verifying (2.7). */
  static async requireCanFollow(db: Db, userId: string) {
    if (!(await this.isLimited(userId, db))) return;
    const today = await db.follow.count({ where: { followerId: userId, requestedAt: { gte: istMidnight() } } });
    if (today >= DAILY_FOLLOW_LIMIT) {
      throw new HttpError(429, "You've sent today's follow requests. Verify your college for no limit.", 'FOLLOW_LIMIT_UNVERIFIED',
        { limit: DAILY_FOLLOW_LIMIT });
    }
  }

  /** People an unverified account may mention in a Story: those it has matched with (2.7). */
  static async matchedIds(userId: string) {
    const matches = await prisma.match.findMany({
      where: { status: 'active', OR: [{ user1Id: userId }, { user2Id: userId }] },
      select: { user1Id: true, user2Id: true },
    });
    return new Set(matches.map((match) => (match.user1Id === userId ? match.user2Id : match.user1Id)));
  }

  /**
   * Everything the app shows about verifying, in one read
   * (GOOGLE_SIGNUP_PLAN.md 2, 4, 5): the badge, what is limited and how much
   * is left, the grace period, and when a verification runs out.
   */
  static async status(userId: string) {
    const [user, membership] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          createdAt: true, pausedAt: true, googleSub: true, googleLinkedAt: true, realPersonVerifiedAt: true, realPersonPassedAt: true,
          campusRef: { select: { name: true, isActive: true } },
          claimedInstitution: { select: { name: true, shortName: true } },
        },
      }),
      prisma.studentMembership.findUnique({
        where: { userId },
        select: { status: true, verifiedAt: true, expiresAt: true, institution: { select: { isActive: true, name: true, shortName: true } } },
      }),
    ]);
    const now = new Date();
    const verified = !!(membership?.status === 'verified' && membership.verifiedAt && membership.institution.isActive &&
      (!membership.expiresAt || membership.expiresAt > now));
    const limited = !membership?.verifiedAt;
    const [likesLeft, chat, rosesSent] = await Promise.all([
      this.likesLeft(userId),
      limited ? this.chatAllowance(userId) : Promise.resolve(null),
      limited ? prisma.rose.count({ where: { senderId: userId } }) : Promise.resolve(0),
    ]);
    const madeWithGoogle = !!(user.googleSub && user.googleLinkedAt && user.googleLinkedAt.getTime() - user.createdAt.getTime() < 60_000);
    const owesRealPerson = realPersonEnforced() && madeWithGoogle && !user.realPersonPassedAt;
    const graceEndsAt = limited || owesRealPerson ? new Date(user.createdAt.getTime() + GRACE_DAYS * DAY_MS) : null;
    return {
      verified,
      /** Verified once, now expired: the badge is gone, nothing else is limited (5). */
      expired: !verified && !limited,
      limited,
      likesLeft,
      dailyLikeLimit: DAILY_LIKE_LIMIT,
      chatLeft: chat && chat.limited ? chat.left : null,
      chatLimit: CHAT_MESSAGE_LIMIT,
      roseTrialAvailable: limited && rosesSent === 0,
      paused: !!user.pausedAt,
      graceEndsAt: graceEndsAt?.toISOString() ?? null,
      graceDaysLeft: graceEndsAt ? Math.max(0, Math.ceil((graceEndsAt.getTime() - now.getTime()) / DAY_MS)) : null,
      expiresAt: membership?.verifiedAt ? membership.expiresAt?.toISOString() ?? null : null,
      daysUntilExpiry: verified && membership?.expiresAt ? Math.ceil((membership.expiresAt.getTime() - now.getTime()) / DAY_MS) : null,
      signedUpWithGoogle: !!user.googleSub,
      /** The real-person check (PHOTO_VERIFICATION_PLAN.md): required of Google accounts; never a badge. */
      realPersonVerified: !!user.realPersonVerifiedAt,
      realPersonRequired: madeWithGoogle,
      owesRealPerson,
      /** Where they are held before verifying, for messages like "Right now you see people from Gurukul". */
      campusName: user.campusRef?.isActive ? user.campusRef.name : null,
      collegeShortName: (() => {
        const college = verified ? membership?.institution : user.claimedInstitution ?? membership?.institution;
        return college ? college.shortName || college.name : null;
      })(),
    };
  }

  /** Messages sent so far - text, voice and story replies; reactions are not messages. */
  static async messagesSent(userId: string) {
    return prisma.message.count({ where: { senderId: userId } });
  }

  static async chatAllowance(userId: string) {
    if (!(await this.isLimited(userId))) return { limited: false as const };
    const used = await this.messagesSent(userId);
    return {
      limited: true as const,
      used,
      limit: CHAT_MESSAGE_LIMIT,
      left: Math.max(0, CHAT_MESSAGE_LIMIT - used),
      warnFrom: CHAT_WARNING_FROM,
      mediaLocked: true,
    };
  }

  /** The chat send gate: media locked, and the 31st message refused. */
  static async requireCanSend(userId: string, messageType: string, hasAttachment: boolean) {
    const allowance = await this.chatAllowance(userId);
    if (!allowance.limited) return;
    if (hasAttachment && messageType !== 'voice') {
      throw new HttpError(403, 'Verify your college to send photos and videos.', 'VERIFY_TO_SEND_MEDIA');
    }
    if (allowance.left <= 0) {
      throw new HttpError(403, "You've used your 30 messages. Verify your college to keep chatting.", 'VERIFY_TO_CHAT',
        { limit: allowance.limit, used: allowance.used });
    }
  }

  /** The upload gate: only a voice note's file may be uploaded before verifying. */
  static async requireCanUpload(userId: string, ext: string) {
    if (VOICE_EXTENSIONS.has(ext.toLowerCase())) return;
    if (await this.isLimited(userId)) {
      throw new HttpError(403, 'Verify your college to send photos and videos.', 'VERIFY_TO_SEND_MEDIA');
    }
  }

  /**
   * For the other person in a chat: is this match waiting for them to verify?
   * Only true once they have used all their messages - the partner then sees
   * a quiet grey line, never "blocked" (2.3).
   */
  static async waitingToVerify(userId: string) {
    const allowance = await this.chatAllowance(userId);
    return allowance.limited && allowance.left <= 0;
  }
}
