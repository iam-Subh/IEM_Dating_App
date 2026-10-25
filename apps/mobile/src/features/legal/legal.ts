import { api } from '../../services/api';

/**
 * The published documents (apps/api/src/legal/documents.ts), drawn natively.
 * LEGAL_VERSION matches the server's: when it rises, everyone is asked to
 * agree again (TermsUpdateScreen).
 */
export const LEGAL_VERSION = 1;

export type LegalSlug = 'terms' | 'privacy' | 'guidelines' | 'child-safety' | 'grievance' | 'safety' | 'law-enforcement';
export type LegalBlock = { type: 'p' | 'note'; text: string } | { type: 'list'; items: string[] };
export type LegalDocument = { slug: LegalSlug; title: string; summary: string; updated: string; version: number; sections: { heading: string; blocks: LegalBlock[] }[] };

const cache = new Map<string, LegalDocument>();
export const cachedLegal = (slug: LegalSlug) => cache.get(slug) ?? null;

export async function loadLegal(slug: LegalSlug) {
  const doc = (await api.get(`/legal/${slug}`, { timeout: 15_000 })).data.data as LegalDocument;
  cache.set(slug, doc);
  return doc;
}

/** Records "I agree" for the current version. Best effort: the next screen asks again if it failed. */
export async function acceptLegal() {
  return (await api.post('/legal/accept', { version: LEGAL_VERSION })).data.data as { termsVersion: number };
}
