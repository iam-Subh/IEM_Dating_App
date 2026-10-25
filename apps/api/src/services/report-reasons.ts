/**
 * The one list of report reasons (docs/SAFETY_AND_LEGAL.md 2.1). The app
 * shows the same list everywhere (features/safety/reportReasons.ts). Older
 * app versions send free text; those keep working as "other".
 */
export type ReportPriority = 'normal' | 'high' | 'urgent';

export const REPORT_REASONS: Record<string, { label: string; priority: ReportPriority }> = {
  underage: { label: 'Under 18', priority: 'urgent' },
  violence: { label: 'Violence or offline harm', priority: 'urgent' },
  intimate_images: { label: 'Intimate images shared without consent', priority: 'urgent' },
  self_harm: { label: 'Self-harm', priority: 'urgent' },
  fake: { label: 'Fake profile or not them', priority: 'high' },
  scam: { label: 'Scam or selling', priority: 'high' },
  harassment: { label: 'Harassment or threats', priority: 'high' },
  sexual: { label: 'Sexual content', priority: 'high' },
  hate: { label: 'Hate or discrimination', priority: 'high' },
  spam: { label: 'Spam or bot', priority: 'normal' },
  not_student: { label: 'Not a student here', priority: 'normal' },
  other: { label: 'Something else', priority: 'normal' },
};

/** How urgent a reason is - a known code, or the old free-text reasons. */
export function reasonPriority(reason: string): ReportPriority {
  const known = REPORT_REASONS[reason];
  if (known) return known.priority;
  if (/under\s*-?\s*18|underage|minor/i.test(reason)) return 'urgent';
  if (/harass|fake|scam|inappropriate|sexual|hate/i.test(reason)) return 'high';
  return 'normal';
}
