/**
 * The minimum a note from a stranger needs (STANDOUTS_LIKES_SPEC.md 4.5): a
 * Rose comment is the one piece of free text someone can put in front of a
 * person they have not matched with.
 *
 * - Contact details are refused: a phone number, an e-mail address, a link or
 *   an @handle. Contact goes through a match, not around it.
 * - A short list of slurs and sexual terms is refused. Extra terms can be
 *   added without a release through NOTE_BLOCKED_TERMS (comma separated).
 *
 * Deliberately conservative: it catches the obvious, and anything it misses
 * can be reported from Likes You (`sourceType: 'rose'`). A filter that tried
 * harder would refuse ordinary notes, and a refused Rose is a bad first
 * impression of the app.
 */

const BUILT_IN_TERMS = [
  // Sexual
  'nude', 'nudes', 'sext', 'sexting', 'horny', 'hookup', 'onlyfans', 'dick', 'pussy', 'boobs', 'blowjob',
  // Slurs and abuse
  'slut', 'whore', 'bitch', 'randi', 'chutiya', 'madarchod', 'bhenchod', 'behenchod', 'faggot', 'retard',
];

function blockedTerms(): string[] {
  const extra = (process.env.NOTE_BLOCKED_TERMS ?? '')
    .split(',')
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...BUILT_IN_TERMS, ...extra])];
}

/** Undo the usual disguises: accents, look-alike digits, and spacing tricks. */
function normalise(text: string) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[0]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[4@]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't');
}

const EMAIL = /[a-z0-9._%+-]+\s*(@|\(at\)|\[at\])\s*[a-z0-9-]+\s*(\.|\(dot\)|\[dot\])\s*[a-z]{2,}/i;
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|in|net|org|io|me|co|app|link|ly|gg)\b|t\.me\/|wa\.me\/)/i;
const HANDLE = /(^|\s)@[a-z0-9._]{3,}/i;
/** Seven or more digits, allowing the separators people put in phone numbers. */
const PHONE = /(\+?\d[\s\-().]*){7,}/;

export type NoteVerdict = { ok: true } | { ok: false; reason: 'contact' | 'term' };

export function checkNote(raw: string): NoteVerdict {
  const text = raw.trim();
  if (!text) return { ok: true };
  if (EMAIL.test(text) || LINK.test(text) || HANDLE.test(text) || PHONE.test(text)) {
    return { ok: false, reason: 'contact' };
  }
  const plain = normalise(text);
  // Whole words only - "thorny" is not a match - plus words spelled out one
  // letter at a time ("n u d e s", "n.u.d.e.s"), joined back together.
  const words = new Set(plain.split(/[^a-z]+/).filter(Boolean));
  for (const run of plain.match(/(?:\b[a-z]\b[\s.\-_*]*){3,}/g) ?? []) {
    words.add(run.replace(/[^a-z]/g, ''));
  }
  for (const term of blockedTerms()) {
    if (words.has(term)) return { ok: false, reason: 'term' };
  }
  return { ok: true };
}
