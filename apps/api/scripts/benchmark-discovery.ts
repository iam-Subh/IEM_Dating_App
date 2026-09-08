import assert from 'node:assert/strict';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { RetrievalService } from '../src/services/retrieval.service';
import { DiscoveryRankingService, RankingMetrics } from '../src/services/discovery-ranking.service';
import { DEFAULT_COMPATIBILITY_WEIGHTS } from '../src/services/compatibility.service';
import { RecommendationService } from '../src/services/recommendation.service';
import { DiscoveryTelemetry, PageMetrics } from '../src/services/discovery-telemetry.service';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (url.hostname !== '127.0.0.1' || url.port !== '55439' || url.pathname !== '/reco_test'
    || process.env.REDIS_URL !== 'redis://127.0.0.1:56420')
  throw new Error('Benchmark requires the isolated PostgreSQL and Redis instances');
const summary = (values: number[]) => {
  const ordered = [...values].sort((a,b) => a-b);
  return { samples: ordered.length, p50Ms: ordered[Math.ceil(ordered.length*.5)-1],
    p95Ms: ordered[Math.ceil(ordered.length*.95)-1], p99Ms: ordered[Math.ceil(ordered.length*.99)-1] };
};
async function main() {
  const size = Number(process.argv[2] ?? 100000);
  if (![100000,200000].includes(size)) throw new Error('Use 100000 or 200000');
  await prisma.$executeRawUnsafe('TRUNCATE users,swipes,student_memberships,discovery_receipts,shadow_rankings,analytics_events,algorithm_config,matches,user_blocks CASCADE');
  await redisClient.flushdb();
  await prisma.$executeRaw`INSERT INTO users(id,name,password_hash,birthday,college,discovery_category,
    show_me_categories,min_age_pref,max_age_pref,discovery_mode,preferences_confirmed_at,
    account_status,preferences,seeking,created_at)
    SELECT gen_random_uuid(),'Benchmark '||i,'',TIMESTAMP '2003-01-01','IEM','woman',
      ARRAY['man','woman'],18,30,'college',now(),CASE WHEN i<=2001 THEN 'active' ELSE 'restricted' END,
      '{"interests":["r_and_b","hiking"]}'::jsonb,'long-term partner',now()-i*interval '1 second'
    FROM generate_series(1,${size}::int) i`;
  const institution = await prisma.institution.findUniqueOrThrow({ where: { code: 'IEM-KOLKATA' } });
  await prisma.$executeRaw`INSERT INTO student_memberships(user_id,institution_id,institutional_email,verified_at)
    SELECT id,${institution.id}::uuid,id::text||'@benchmark.invalid',now() FROM users`;
  const me = await prisma.user.findFirstOrThrow({ where: { name: 'Benchmark 1' } });
  // Every eligible candidate has a full bounded history. Targets are separate fixture users.
  await prisma.$executeRaw`INSERT INTO swipes(swiper_id,target_id,action,target_signals,created_at)
    SELECT actor.id,target.id,CASE WHEN target.n%4<>0 THEN 'like' ELSE 'pass' END,
      CASE WHEN target.n%2=0 THEN '{"interests":["r_b","hiking"],"seeking":"long-term partner"}'::jsonb
      ELSE '{"interests":["cricket"],"seeking":"new friends"}'::jsonb END,
      now()-target.n*interval '1 minute'
    FROM users actor CROSS JOIN (SELECT id,row_number() OVER (ORDER BY id) AS n FROM
      (SELECT id FROM users WHERE account_status='restricted' ORDER BY id LIMIT 240) t) target
    WHERE actor.account_status='active' AND actor.id<>${me.id}::uuid`;
  for (const table of ['users','student_memberships','swipes']) await prisma.$executeRawUnsafe('ANALYZE '+table);
  const reports: unknown[] = [];
  for (const budget of [40,400,800]) for (const enabled of [false,true]) {
    for (const [key,value] of Object.entries({candidate_budget:budget,reco_rollout_pct:100,
      reciprocity_enabled:Number(enabled),max_pending_per_profile:100}))
      await prisma.algorithmConfig.upsert({where:{key},create:{key,value},update:{value}});
    const retrieval: number[] = [], ranking: number[] = [], reciprocity: number[] = [];
    const generation: number[] = [], cached: number[] = [];
    const stages: PageMetrics[] = [];
    let estimated = 0, considered = 0;
    for (let i=0;i<23;i++) {
      let start = performance.now();
      const ids = await RetrievalService.ids(me,'benchmark:'+i,budget);
      assert.equal(ids.length,budget);
      if(i>=3) retrieval.push(performance.now()-start);
      let details: RankingMetrics | undefined;
      start = performance.now();
      await DiscoveryRankingService.rank(me,ids,1,DEFAULT_COMPATIBILITY_WEIGHTS,prisma,'benchmark:'+i,2,1,enabled,undefined,m=>details=m);
      if (enabled) {
        assert.equal(details?.reciprocity?.failed,0,'Reciprocity query failed');
        assert.equal(details?.reciprocity?.withEstimate,budget,'Every fixture candidate must receive an estimate');
      }
      if(i>=3) {
        ranking.push(performance.now()-start);
        reciprocity.push(details?.reciprocity?.elapsedMs ?? 0);
        estimated += details?.reciprocity?.withEstimate ?? 0;
        considered += details?.reciprocity?.candidates ?? 0;
      }
      // Prevent repeated synthetic sessions from exhausting reservation capacity.
      await redisClient.flushdb();
      start = performance.now();
      const page = await RecommendationService.getRecommendations(me.id,undefined,20,undefined,m=>{if(i>=3) stages.push(m);});
      assert.equal(page.cards.length,20);
      if(i>=3) generation.push(performance.now()-start);
      assert.ok(page.nextCursor);
      start = performance.now();
      const next = await RecommendationService.getRecommendations(me.id,page.nextCursor,20,undefined,m=>{
        if(i>=3 && budget>=400) assert.equal(m.generations,0,'Cached page unexpectedly generated candidates');
      });
      assert.equal(next.cards.length,20);
      if(i>=3) cached.push(performance.now()-start);
    }
    reports.push({budget,reciprocityEnabled:enabled,policy:1,coverage:considered?estimated/considered:null,
      retrieval:summary(retrieval),ranking:summary(ranking),reciprocity:summary(reciprocity),
      pageGeneration:summary(generation),nextPage:{kind:budget===40?'refill':'cached',...summary(cached)},
      stageMeans:Object.fromEntries(['totalMs','deckMs','retrievalMs','rankingMs','claimMs','receiptMs'].map(key=>
        [key,stages.reduce((sum,m)=>sum+Number(m[key as keyof PageMetrics]),0)/stages.length]))});
    console.log('Completed',budget,'reciprocity',enabled);
  }
  await DiscoveryTelemetry.flush();
  const folder = resolve('../../docs/verification');
  mkdirSync(folder,{recursive:true});
  const report = { users:size,eligibleCandidates:2000,historyRows:480000,
    scope:'Local single-process warm synthetic benchmark. Verified campus pool of 2000 within a larger user table. Every eligible actor has 240 snapshots; online query reads at most 200. Not production throughput or match-quality evidence.',
    reports };
  writeFileSync(resolve(folder,'discovery-v2-'+size+'.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  await DiscoveryTelemetry.flush(); await prisma.$disconnect(); redisClient.disconnect();
});
