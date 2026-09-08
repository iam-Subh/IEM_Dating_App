import { normalizeInterest } from '@iem-dating/shared/interest-catalog';
import { PrismaClient } from '@prisma/client';

// Rewrite only known aliases. Keep unrelated keys and malformed values for review.
export function canonicalizeInterestDocument(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const document = value as Record<string, unknown>;
  if (!Array.isArray(document.interests)) return value;
  return { ...document, interests: [...new Set(document.interests.map(item =>
    typeof item === 'string' ? normalizeInterest(item) : item))] };
}

export async function applyInterestBatch(db: PrismaClient, table: 'users' | 'swipes', rows: { id: string; value: unknown }[]) {
  const updates = rows.map(row => ({ id: row.id, before: row.value, after: canonicalizeInterestDocument(row.value) }))
    .filter(row => JSON.stringify(row.before) !== JSON.stringify(row.after));
  if (!updates.length) return 0;
  const column = table === 'users' ? 'preferences' : 'target_signals';
  await db.$transaction(async tx => {
    const count = await tx.$executeRawUnsafe(
      `UPDATE ${table} t SET ${column}=c.after${table === 'users' ? ', eligibility_version=eligibility_version+1, updated_at=now()' : ''}
       FROM jsonb_to_recordset($1::jsonb) AS c(id text,before jsonb,after jsonb)
       WHERE t.id=c.id::uuid AND t.${column}=c.before`, JSON.stringify(updates));
    if (count !== updates.length) throw new Error('Concurrent edit; retry this batch from its checkpoint');
  }, { timeout: 15000 });
  return updates.length;
}
