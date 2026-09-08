import "dotenv/config";
import { prisma } from "../src/utils/prisma";
async function main() {
  // Bounded batches. Run repeatedly when a backlog remains.
  const receipts =
    await prisma.$executeRaw`DELETE FROM discovery_receipts WHERE id IN
    (SELECT r.id FROM discovery_receipts r WHERE delivered_at < now()-interval '30 days'
      OR NOT EXISTS(SELECT 1 FROM users WHERE id=r.viewer_id) OR NOT EXISTS(SELECT 1 FROM users WHERE id=r.candidate_id) LIMIT 5000)`;
  const shadows =
    await prisma.$executeRaw`DELETE FROM shadow_rankings WHERE id IN
    (SELECT r.id FROM shadow_rankings r WHERE created_at < now()-interval '30 days'
      OR NOT EXISTS(SELECT 1 FROM users WHERE id=r.viewer_id) LIMIT 5000)`;
  // Remove deleted account references from retained diagnostic lists.
  await prisma.$executeRaw`UPDATE shadow_rankings s SET report = jsonb_set(jsonb_set(report,'{candidateIds}',
    COALESCE((SELECT jsonb_agg(v) FROM jsonb_array_elements(report->'candidateIds') v WHERE EXISTS(SELECT 1 FROM users u WHERE u.id::text=v#>>'{}')),'[]'::jsonb)),
    '{controlIds}',COALESCE((SELECT jsonb_agg(v) FROM jsonb_array_elements(report->'controlIds') v WHERE EXISTS(SELECT 1 FROM users u WHERE u.id::text=v#>>'{}')),'[]'::jsonb))
    WHERE s.id IN (SELECT r.id FROM shadow_rankings r WHERE
      EXISTS(SELECT 1 FROM jsonb_array_elements(r.report->'candidateIds') v WHERE NOT EXISTS(SELECT 1 FROM users u WHERE u.id::text=v#>>'{}'))
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.report->'controlIds') v WHERE NOT EXISTS(SELECT 1 FROM users u WHERE u.id::text=v#>>'{}'))
      LIMIT 5000)`;
  console.log(
    JSON.stringify({ receiptsDeleted: receipts, shadowRowsDeleted: shadows }),
  );
}
main().finally(() => prisma.$disconnect());
