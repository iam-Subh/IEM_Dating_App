import { HttpError } from '../utils/httpError';
import { legalConfig } from '../legal/documents';

/**
 * What someone who can't sign in is told - only once they have proved who they
 * are (the right password, or Google), so the answer never reveals another
 * person's account status. Always says how to appeal (Terms 8).
 */
export function standingError(user: { accountStatus: string; suspendedUntil?: Date | null }): HttpError | null {
  const { supportEmail: support, publicUrl } = legalConfig();
  const appeal = `If you think this is a mistake, appeal at ${publicUrl}/appeal or write to ${support} with "Appeal" in the subject.`;
  if (user.accountStatus === 'banned') {
    return new HttpError(403, `This account was banned for breaking our Community Guidelines. ${appeal}`, 'ACCOUNT_BANNED', { supportEmail: support });
  }
  if (user.accountStatus === 'suspended') {
    const until = user.suspendedUntil ? user.suspendedUntil.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }) : null;
    return new HttpError(403, `This account is suspended${until ? ` until ${until}` : ''} for breaking our Community Guidelines. ${appeal}`, 'ACCOUNT_SUSPENDED', { supportEmail: support, until: user.suspendedUntil?.toISOString() ?? null });
  }
  if (user.accountStatus === 'restricted') {
    return new HttpError(403, `This account is on hold while our team reviews a report. You'll hear from us. Questions: ${support}.`, 'ACCOUNT_ON_HOLD', { supportEmail: support });
  }
  return null;
}
