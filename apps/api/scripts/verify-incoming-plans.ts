import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
const db = new PrismaClient();
const url = new URL(process.env.DATABASE_URL!);
if (url.hostname !== '127.0.0.1' || url.port !== '55439' || url.pathname !== '/reco_test')
  throw new Error('Requires isolated recommendation test database');
async function main() {
  const report: Record<string, unknown> = {};
  const rollback = new Error('fixture rollback');
  try {
    await db.$transaction(async tx => {
      // Restore the pre-change index set inside this rollback-only fixture.
      await tx.$executeRawUnsafe('DROP INDEX IF EXISTS swipes_target_action_swiper_idx');
      await tx.$executeRawUnsafe('DROP INDEX IF EXISTS swipes_incoming_order_idx');
      await tx.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS swipes_swiper_id_idx ON swipes(swiper_id)');
      const target = randomUUID();
      await tx.$executeRawUnsafe("INSERT INTO swipes (id,swiper_id,target_id,action) SELECT gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'like' FROM generate_series(1,200000)");
      await tx.$executeRawUnsafe("INSERT INTO swipes (id,swiper_id,target_id,action) SELECT gen_random_uuid(),gen_random_uuid(),$1::uuid,CASE WHEN i%3=0 THEN 'pass' ELSE 'like' END FROM generate_series(1,50000) i", target);
      await tx.$executeRawUnsafe('ANALYZE swipes');
      const ids = await tx.$queryRawUnsafe<{swiper_id:string}[]>('SELECT swiper_id FROM swipes WHERE target_id=$1::uuid LIMIT 800',target);
      const candidates = ids.map(x=>x.swiper_id);
      const queries: Record<string, [string, unknown[]]> = {
        ranking: ["SELECT swiper_id FROM swipes WHERE target_id=$1::uuid AND action='like' AND swiper_id=ANY($2::uuid[])", [target,candidates]],
        incomingSource: ["SELECT swiper_id FROM swipes WHERE target_id=$1::uuid AND action='like' ORDER BY created_at DESC,swiper_id LIMIT 40", [target]],
        outgoing: ['SELECT target_id FROM swipes WHERE swiper_id=$1::uuid', [candidates[0]]],
      };
      for(const stage of ['before','after']) {
        if(stage==='after') {
          await tx.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS swipes_target_action_swiper_idx ON swipes(target_id,action,swiper_id)');
          await tx.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS swipes_incoming_order_idx ON swipes(target_id,action,created_at DESC,swiper_id)');
          await tx.$executeRawUnsafe('DROP INDEX IF EXISTS swipes_swiper_id_idx');
          await tx.$executeRawUnsafe('ANALYZE swipes');
        }
        for(const [name,[query,params]] of Object.entries(queries))
          report[stage+'_'+name] = await tx.$queryRawUnsafe('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query,...params);
      }
      throw rollback;
    },{timeout:120000});
  } catch(e) { if(e!==rollback) throw e; }
  writeFileSync('../../docs/verification/incoming-query-plans.json',JSON.stringify(report,null,2));
  for(const [name,result] of Object.entries(report)) {
    const plan=(result as any)[0]['QUERY PLAN'][0];
    console.log(name, 'executionMs',plan['Execution Time'], 'node',plan.Plan['Node Type']);
  }
}
main().finally(()=>db.$disconnect());
