import type { Ionicons } from '@expo/vector-icons';
import type React from 'react';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * The one list of report reasons, everywhere in the app (docs/SAFETY_AND_LEGAL.md 2.1).
 * The codes match the server's (apps/api/src/services/report-reasons.ts),
 * which ranks them: urgent ones are looked at first, and "Under 18" hides the
 * profile at once.
 */
export type ReportReason = { code: string; label: string; icon: IconName; details?: string[]; urgent?: boolean };

export const REPORT_REASONS: ReportReason[] = [
  { code: 'underage', label: 'Under 18', icon: 'alert-circle-outline', urgent: true },
  { code: 'fake', label: 'Fake profile or not them', icon: 'person-remove-outline', details: ['Photos of someone else', 'Catfish', 'Celebrity or stolen photos'] },
  { code: 'scam', label: 'Scam or selling', icon: 'cash-outline', details: ['Asking for money', 'Investment or crypto', 'Selling sex or services', 'Promoting accounts or links'] },
  { code: 'harassment', label: 'Harassment or threats', icon: 'hand-left-outline', details: ['Bullying', 'Threats', 'Stalking', "Won't stop messaging"] },
  { code: 'sexual', label: 'Sexual content', icon: 'eye-off-outline', details: ['Nude photos I didn’t ask for', 'Sexual messages', 'Explicit profile'] },
  { code: 'hate', label: 'Hate or discrimination', icon: 'megaphone-outline', details: ['Caste', 'Religion', 'Race or ethnicity', 'Gender or sexuality', 'Disability'] },
  { code: 'violence', label: 'Violence or offline harm', icon: 'warning-outline', urgent: true, details: ['Something happened on a date', 'Physical harm', 'Felt unsafe meeting'] },
  { code: 'intimate_images', label: 'Intimate images shared without consent', icon: 'images-outline', urgent: true, details: ['Of me', 'Of someone else'] },
  { code: 'self_harm', label: 'Self-harm', icon: 'heart-dislike-outline', urgent: true },
  { code: 'spam', label: 'Spam or bot', icon: 'repeat-outline' },
  { code: 'not_student', label: 'Not a student here', icon: 'school-outline' },
  { code: 'other', label: 'Something else', icon: 'ellipsis-horizontal-circle-outline' },
];
