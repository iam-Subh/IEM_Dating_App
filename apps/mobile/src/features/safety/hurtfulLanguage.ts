/**
 * Words that usually hurt (docs/SAFETY_AND_LEGAL.md 3): behind "Are you sure?"
 * before sending, and "Does this bother you?" on receiving - as Tinder does.
 * Never blocks a message; a nudge to think, and a quick way to report.
 *
 * English, and Hindi and Bengali abuse as students type it in Latin letters.
 * Matching ignores case, repeated letters ("stuuupid"), common symbol
 * swaps (@ for a, 1 for i) and spaces between letters.
 */
const WORDS = [
  // insults and slurs
  'bitch', 'slut', 'whore', 'cunt', 'bastard', 'retard', 'faggot', 'fag', 'dyke', 'tranny', 'nigger', 'nigga', 'chink',
  'motherfucker', 'fuck you', 'fuck off', 'piece of shit', 'kill yourself', 'kys', 'go die', 'ugly bitch', 'fat bitch',
  // unwanted sexual
  'send nudes', 'send nude', 'nudes', 'show me your boobs', 'show boobs', 'dick pic', 'sex chat', 'sexchat', 'horny', 'suck my', 'sit on my',
  // Hindi
  'madarchod', 'maderchod', 'mc', 'bhenchod', 'behenchod', 'bhosdike', 'bhosdi', 'bsdk', 'chutiya', 'chutiye', 'chut', 'lund', 'lauda', 'loda',
  'gaandu', 'gandu', 'randi', 'harami', 'haramkhor', 'kamina', 'kamine', 'kutiya', 'kutti', 'saali randi', 'teri maa', 'teri behen',
  // Bengali
  'bokachoda', 'boka choda', 'khanki', 'khankir chele', 'chodna', 'shuorer bachcha', 'tor maa',
  // caste abuse
  'chamar', 'bhangi',
];

/** Letters only, repeats squeezed, look-alikes undone. */
function normalise(text: string) {
  return text.toLowerCase()
    .replace(/[@4]/g, 'a').replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/0/g, 'o').replace(/[$5]/g, 's').replace(/7/g, 't')
    .replace(/[^a-z\s]/g, ' ')
    // Repeats squeezed to one letter, on both sides: "nuuuudes" and "nudes" meet.
    .replace(/([a-z])\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// Short words must stand alone ("mc" not in "mcdonalds"); phrases may span.
const PATTERNS = WORDS.map((word) => new RegExp(String.raw`(^|\s)` + normalise(word).replace(/ /g, String.raw`\s?`) + String.raw`(\s|$)`));

export function looksHurtful(text: string | null | undefined) {
  if (!text) return false;
  const clean = normalise(text);
  // "f u c k" spelt out with spaces: also check with the spaces between single letters taken out.
  const joined = clean.replace(/\b(\w) (?=\w\b)/g, '$1');
  return PATTERNS.some((pattern) => pattern.test(clean) || pattern.test(joined));
}

/** Hidden Words (the person's own list): plain, case-insensitive whole words or phrases. */
export function containsHidden(text: string | null | undefined, words: readonly string[]) {
  if (!text || !words.length) return false;
  const clean = ` ${normalise(text)} `;
  return words.some((word) => {
    const target = normalise(word);
    return !!target && clean.includes(` ${target} `);
  });
}
