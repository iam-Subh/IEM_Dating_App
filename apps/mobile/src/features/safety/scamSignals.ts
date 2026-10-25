/**
 * Signs that a chat may be a scam or a move off the app (docs/SAFETY_AND_LEGAL.md 3):
 * links, phone numbers, payment apps, money and crypto. Only a nudge - it
 * never blocks a message.
 */
const SIGNALS = [
  /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|in|net|org|io|me|link|xyz|app)\b/i,
  /\b(wa\.me|t\.me|telegram|whats\s?app|snap(chat)?|insta(gram)?\s*id)\b/i,
  /\b(upi|paytm|g\s?pay|google\s?pay|phone\s?pe|bhim|bank\s+account|ifsc)\b/i,
  /\b(crypto|bitcoin|btc|usdt|forex|trading|invest(ment)?|profit|double your)\b/i,
  /(₹|\brs\.?|\binr\b)\s?\d|\b\d+\s?(rupees|rs)\b|\b(send|lend|need)\s+(me\s+)?(money|cash|amount)\b/i,
  /(?:\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/,
];

export function looksRisky(text: string | null | undefined) {
  return !!text && SIGNALS.some((pattern) => pattern.test(text));
}
