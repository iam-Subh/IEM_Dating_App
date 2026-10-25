/**
 * "Your verification changed - re-read it", to every device of one person:
 * a selfie-check result, a team decision, a college confirmation. Carries
 * nothing; the app re-reads its status (useVerificationStatus, useFaceStatus).
 */
export function announceVerification(userId: string) {
  // Required lazily: the socket module imports much of the app.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getIO } = require('../socket') as typeof import('../socket');
  getIO()?.to(`user:${userId}`).emit('verification_changed', {});
}

/**
 * "Your own profile changed - re-read it", to every device of its owner: an
 * edit made on another phone, a photo the team removed, a birthday approved.
 * The same `profile_changed` people watching this profile in Search get.
 */
export function announceOwnProfile(userId: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getIO } = require('../socket') as typeof import('../socket');
  getIO()?.to(`user:${userId}`).emit('profile_changed', { userId });
}
