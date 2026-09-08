import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../src/utils/prisma';
import { RetrievalService } from '../src/services/retrieval.service';

const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (url.hostname !== '127.0.0.1' || url.port !== '55439' || url.pathname !== '/reco_test')
  throw new Error('Requires isolated localhost:55439/reco_test database');

const indexes = [
  ['users_discovery_active_sample_idx', '20260907000000_discovery_active_sample_index'],
  ['users_discovery_created_idx', '20260907010000_discovery_active_created_index'],
] as const;
const report: Record<string, unknown> = {
  scope: 'Local PostgreSQL; 100000 synthetic users, 50% active and confirmed, verified memberships. Warm retrieval only. No ranking or reciprocity benchmark.',
};
async function main() {
  const catalog = await prisma.$queryRaw<any[]>`SELECT c.relname, i.indisvalid, i.indisready,
    pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i
    JOIN pg_class c ON c.oid=i.indexrelid
    WHERE c.relname IN ('users_discovery_active_sample_idx','users_discovery_created_idx')`;
  assert.equal(catalog.length, 2, 'Apply migrations before verification');
  for (const row of catalog) {
    assert.ok(row.indisvalid && row.indisready, `${row.relname} is not ready`);
    assert.match(row.definition, /account_status/);
    assert.match(row.definition, /preferences_confirmed_at IS NOT NULL/);
  }
  report.catalog = catalog;
  const rollback = new Error('Rollback verification fixture');
  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL jit=off');
      await tx.$executeRawUnsafe('SET LOCAL plan_cache_mode=force_custom_plan');
      const marker = randomUUID();
      await tx.$executeRaw`INSERT INTO users(name,password_hash,birthday,college,
        discovery_category,show_me_categories,min_age_pref,max_age_pref,discovery_mode,
        account_status,preferences_confirmed_at,created_at,discovery_sample)
        SELECT ${marker},'',TIMESTAMP '2003-01-01','IEM','woman',ARRAY['man','woman'],18,30,'college',
          CASE WHEN i%4=0 THEN 'restricted' ELSE 'active' END,
          CASE WHEN i%4=1 THEN NULL ELSE now() END,
          now()-i*interval '1 second',(i*7919)%1048576
        FROM generate_series(1,100000) i`;
      const institution = await tx.institution.findUniqueOrThrow({ where: { code: 'IEM-KOLKATA' } });
      await tx.$executeRaw`INSERT INTO student_memberships(user_id,institution_id,institutional_email,verified_at)
        SELECT id,${institution.id}::uuid,id::text||'@index-test.invalid',now() FROM users WHERE name=${marker}`;
      const me = await tx.user.findFirstOrThrow({ where: { name: marker, accountStatus: 'active', preferencesConfirmedAt: { not: null } } });
      await tx.$executeRawUnsafe('ANALYZE users');
      await tx.$executeRawUnsafe('ANALYZE student_memberships');
      const results: string[][] = [];
      for (const stage of ['before', 'after']) {
        for (const [name, migration] of indexes) {
          if (stage === 'before') await tx.$executeRawUnsafe(`DROP INDEX ${name}`);
          else {
            // Transaction-only comparison; deploy uses the unchanged concurrent migration.
            const sql = readFileSync(resolve('prisma/migrations', migration, 'migration.sql'), 'utf8')
              .replace('CREATE INDEX CONCURRENTLY', 'CREATE INDEX');
            await tx.$executeRawUnsafe(sql);
          }
        }
        let captured: Prisma.Sql | undefined;
        const capture = { $queryRaw: async (query: Prisma.Sql) => {
          captured = query;
          return tx.$queryRaw(query);
        } } as unknown as PrismaClient;
        const timings: number[] = [];
        for (let i = 0; i < 23; i++) {
          const start = performance.now();
          const ids = await RetrievalService.ids(me, 'index-verification', 400, [], capture);
          assert.equal(ids.length, 400, 'Fixture must return a full candidate pool');
          if (i === 0) results.push(ids);
          if (i >= 3) timings.push(performance.now() - start);
        }
        assert.ok(captured);
        const plans = await tx.$queryRawUnsafe<any[]>(
          'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + captured.text, ...captured.values);
        timings.sort((a,b) => a-b);
        report[stage] = { samples: timings.length, candidates: 400,
          p50Ms: timings[9], p95Ms: timings[18], plans };
        if (stage === 'after') {
          const planText = JSON.stringify(plans);
          for (const [name] of indexes) assert.ok(planText.includes(name), `Fixture did not use ${name}`);
        }
      }
      assert.deepEqual(results[0], results[1], 'Indexes must preserve candidate order');
      throw rollback;
    }, { timeout: 120000 });
  } catch (error) { if (error !== rollback) throw error; }
  const folder = resolve('../../docs/verification');
  mkdirSync(folder, { recursive: true });
  writeFileSync(resolve(folder, 'discovery-index-verification.json'), JSON.stringify(report, null, 2));
  for (const stage of ['before', 'after']) {
    const { plans, ...metrics } = report[stage] as any;
    console.log(stage, metrics);
  }
  console.log('Index catalog, query plans, and candidate equivalence verified; fixture rolled back.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
