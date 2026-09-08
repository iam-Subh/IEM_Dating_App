import { prisma } from '../utils/prisma';
import { ageAt } from './eligibility.service';

export async function requireSocketDatingEligibility(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      accountStatus: true,
      birthday: true,
      studentMembership: {
        select: { status: true, verifiedAt: true, expiresAt: true, institution: { select: { isActive: true } } },
      },
    },
  });
  const membership = user?.studentMembership;
  if (!user || user.accountStatus !== 'active' || (ageAt(user.birthday) ?? 0) < 18 || membership?.status !== 'verified' || !membership.verifiedAt ||
      !membership.institution.isActive || (membership.expiresAt !== null && membership.expiresAt <= new Date())) {
    throw new Error('Dating setup is incomplete');
  }
}
