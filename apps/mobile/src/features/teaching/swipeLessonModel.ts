export type PracticeDecision = 'like' | 'pass';

/** A short movement must not become a decision, even with noisy velocity. */
export function practiceDecision(x: number, velocity: number, width: number): PracticeDecision | null {
  const threshold = Math.max(56, width * 0.22);
  const deliberateFlick = Math.abs(x) >= 28 && Math.abs(velocity) >= 0.7 && Math.sign(x) === Math.sign(velocity);
  if (Math.abs(x) < threshold && !deliberateFlick) return null;
  return x > 0 ? 'like' : 'pass';
}

/** Each direction counts once. Completion requires both directions. */
export function recordPractice(mask: number, decision: PracticeDecision): number {
  return mask | (decision === 'like' ? 1 : 2);
}

export function practiceInstruction(mask: number): string {
  return mask === 1 ? 'Now swipe left to Pass.' : mask === 2 ? 'Now swipe right to Like.' : 'Swipe right to Like. Swipe left to Pass.';
}
