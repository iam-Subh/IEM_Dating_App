import { isIP } from 'net';

export type LinkCheck = { ok: true; url: string; host: string } | { ok: false; reason: string };

const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal']);

/**
 * The checks a link sticker must pass before a Story is published.
 *
 * Only plain web links to public hostnames: no other schemes, no credentials in
 * the URL, no IP literals or internal names that could point a viewer's phone
 * at a local network, and no absurd lengths. A Safe Browsing lookup runs on top
 * of this when an API key is configured.
 */
export function checkLinkShape(input: string): LinkCheck {
  if (input.length > 2048) return { ok: false, reason: 'The link is too long' };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`);
  } catch {
    return { ok: false, reason: 'The link is not a valid web address' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, reason: 'Only web links can be added' };
  if (url.username || url.password) return { ok: false, reason: 'Links cannot contain a username or password' };
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || BLOCKED_HOSTS.has(host) || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, reason: 'This link points to a private address' };
  }
  if (isIP(host.replace(/^\[|\]$/g, ''))) return { ok: false, reason: 'Links must use a website name, not an IP address' };
  if (!host.includes('.')) return { ok: false, reason: 'The link is not a valid web address' };
  return { ok: true, url: url.toString(), host };
}

/** Google Safe Browsing v4 lookup. Resolves true when the URL is known to be unsafe. */
export async function isKnownUnsafe(url: string): Promise<boolean> {
  const key = process.env.SAFE_BROWSING_API_KEY;
  if (!key) return false;
  const response = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client: { clientId: 'iem-connect', clientVersion: '1.0.0' },
      threatInfo: {
        threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
        platformTypes: ['ANY_PLATFORM'],
        threatEntryTypes: ['URL'],
        threatEntries: [{ url }],
      },
    }),
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error(`Safe Browsing returned HTTP ${response.status}`);
  const body = await response.json() as { matches?: unknown[] };
  return Boolean(body.matches?.length);
}
