import { PrismaClient, Prisma } from '@prisma/client';
import { canonicalizeInterestDocument, applyInterestBatch } from '../src/services/interest-normalization';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
const local = url.hostname === '127.0.0.1' && url.port === '55439' && url.pathname === '/reco_test';
if (!local && !(args.includes('--staging') && process.env.NODE_ENV === 'staging' && option('--expect-host') === url.host))
  throw new Error('Use the isolated database, or NODE_ENV=staging with --staging --expect-host HOST:PORT');
const apply = args.includes('--apply');
const checkpoint = resolve(option('--checkpoint') ?? '.interest-backfill.json');
const identity = `${url.host}${url.pathname}:${apply ? 'apply' : 'dry-run'}:catalog-v1`;
const db = new PrismaClient();
type State = { identity: string; table: number; cursor: string | null; scanned: number; changed: number };
const state: State = existsSync(checkpoint) ? JSON.parse(readFileSync(checkpoint, 'utf8')) :
  { identity, table: 0, cursor: null, scanned: 0, changed: 0 };
if (state.identity !== identity) throw new Error('Checkpoint belongs to another database, mode, or catalog');
async function save() {
  writeFileSync(checkpoint + '.tmp', JSON.stringify(state, null, 2));
  // Windows virus scanners can hold a checkpoint briefly after a write.
  for (let attempt = 0; ; attempt++) {
    try { renameSync(checkpoint + '.tmp', checkpoint); return; }
    catch (error) {
      if (attempt >= 5 || !['EPERM','EACCES','EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 20 * 2 ** attempt));
    }
  }
}
async function main() {
  for (; state.table < 2; state.table++, state.cursor = null) {
    const table = state.table === 0 ? 'users' : 'swipes';
    const column = state.table === 0 ? 'preferences' : 'target_signals';
    while (true) {
      const rows = await db.$queryRawUnsafe<{ id: string; value: Prisma.JsonValue }[]>(
        `SELECT id,${column} AS value FROM ${table} WHERE ${state.cursor ? 'id>$1::uuid AND' : ''}
         ${column} IS NOT NULL ORDER BY id LIMIT 200`, ...(state.cursor ? [state.cursor] : []));
      if (!rows.length) break;
      // One conditional SQL update per batch. A conflict rolls back the entire batch.
      const changed = apply ? await applyInterestBatch(db, table, rows) : rows.filter(row =>
        JSON.stringify(canonicalizeInterestDocument(row.value)) !== JSON.stringify(row.value)).length;
      state.scanned += rows.length;
      state.changed += changed;
      state.cursor = rows[rows.length - 1].id;
      await save();
    }
  }
  await save();
  console.log(JSON.stringify({ ...state, mode: apply ? 'apply' : 'dry-run', complete: true }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
