import dns from 'node:dns/promises';
import net from 'node:net';
import { HttpError } from '../utils/httpError';

const MAX_HTML_BYTES = 512 * 1024;
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; value: LinkPreview }>();

export interface LinkPreview {
  url: string;
  title: string;
  description?: string;
  image?: string;
  siteName?: string;
}

function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const normalized = address.toLowerCase();
  return normalized === '::1' || normalized === '::' || normalized.startsWith('fc')
    || normalized.startsWith('fd') || normalized.startsWith('fe8')
    || normalized.startsWith('fe9') || normalized.startsWith('fea')
    || normalized.startsWith('feb') || normalized.startsWith('::ffff:127.')
    || normalized.startsWith('::ffff:10.') || normalized.startsWith('::ffff:192.168.');
}

async function validateRemoteUrl(value: string): Promise<URL> {
  let url: URL;
  try { url = new URL(value); } catch { throw new HttpError(400, 'Link is invalid', 'INVALID_LINK'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new HttpError(400, 'Link is invalid', 'INVALID_LINK');
  }
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local')) {
    throw new HttpError(400, 'Link host is not allowed', 'LINK_HOST_BLOCKED');
  }
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new HttpError(400, 'Link host is not allowed', 'LINK_HOST_BLOCKED');
  }
  return url;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim();
}

function meta(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return undefined;
}

async function fetchHtml(initialUrl: URL): Promise<{ html: string; finalUrl: URL }> {
  let url = initialUrl;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'IEMDating-LinkPreview/1.0', Accept: 'text/html,application/xhtml+xml' },
      });
    } finally {
      clearTimeout(timeout);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirect === 3) throw new HttpError(422, 'Link redirect is invalid', 'LINK_PREVIEW_FAILED');
      url = await validateRemoteUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('text/html')) {
      throw new HttpError(422, 'Link preview is unavailable', 'LINK_PREVIEW_FAILED');
    }
    const declaredSize = Number(response.headers.get('content-length') ?? 0);
    if (declaredSize > MAX_HTML_BYTES) throw new HttpError(422, 'Link page is too large', 'LINK_PREVIEW_TOO_LARGE');
    const reader = response.body?.getReader();
    if (!reader) throw new HttpError(422, 'Link preview is unavailable', 'LINK_PREVIEW_FAILED');
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTML_BYTES) {
        await reader.cancel();
        throw new HttpError(422, 'Link page is too large', 'LINK_PREVIEW_TOO_LARGE');
      }
      chunks.push(value);
    }
    return { html: Buffer.concat(chunks).toString('utf8'), finalUrl: url };
  }
  throw new HttpError(422, 'Link preview is unavailable', 'LINK_PREVIEW_FAILED');
}

export class LinkPreviewService {
  static async get(value: string): Promise<LinkPreview> {
    const url = await validateRemoteUrl(value);
    const key = url.toString();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const { html, finalUrl } = await fetchHtml(url);
    const title = meta(html, 'og:title')
      ?? decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? finalUrl.hostname);
    const description = meta(html, 'og:description') ?? meta(html, 'description');
    const imageValue = meta(html, 'og:image');
    let image: string | undefined;
    if (imageValue) {
      try {
        const resolved = new URL(imageValue, finalUrl);
        if (['http:', 'https:'].includes(resolved.protocol)) image = resolved.toString();
      } catch { image = undefined; }
    }
    const preview: LinkPreview = {
      url: finalUrl.toString(),
      title: title.slice(0, 180),
      ...(description ? { description: description.slice(0, 320) } : {}),
      ...(image ? { image } : {}),
      siteName: (meta(html, 'og:site_name') ?? finalUrl.hostname).slice(0, 100),
    };
    cache.set(key, { value: preview, expiresAt: Date.now() + CACHE_TTL_MS });
    return preview;
  }
}
