import { prisma } from '../utils/prisma';
import { ageAt, isEligibilityParty } from './eligibility.service';

export async function requireSocketDatingEligibility(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountStatus: true, birthday: true },
  });
  // Verified, or an unverified account with a college (GOOGLE_SIGNUP_PLAN.md 2.1).
  if (!user || user.accountStatus !== 'active' || (ageAt(user.birthday) ?? 0) < 18 || !(await isEligibilityParty(prisma, userId))) {
    throw new Error('Dating setup is incomplete');
  }
}
