import "dotenv/config";
import { prisma } from "../src/utils/prisma";
async function main() {
  // Last seven days are excluded so seven-day conversation outcomes can mature.
  const rows = await prisma.$queryRaw<
    {
      algorithm: number;
      viewers: bigint;
      visible: bigint;
      qualified_viewers: bigint;
    }[]
  >`
    WITH seen AS (SELECT DISTINCT viewer_id,candidate_id,algorithm FROM discovery_receipts
      WHERE visible_at >= now()-interval '21 days' AND visible_at < now()-interval '7 days'),
    qualified AS (SELECT DISTINCT s.viewer_id,s.algorithm FROM seen s JOIN matches m
      ON ((m.user1_id=s.viewer_id AND m.user2_id=s.candidate_id) OR (m.user2_id=s.viewer_id AND m.user1_id=s.candidate_id))
      WHERE m.created_at >= now()-interval '21 days' AND m.created_at < now()-interval '7 days'
      AND EXISTS(SELECT 1 FROM messages x WHERE x.match_id=m.id AND x.sender_id=m.user1_id AND x.sent_at < m.created_at+interval '7 days' AND NOT x.is_deleted)
      AND EXISTS(SELECT 1 FROM messages x WHERE x.match_id=m.id AND x.sender_id=m.user2_id AND x.sent_at < m.created_at+interval '7 days' AND NOT x.is_deleted))
    SELECT s.algorithm,COUNT(DISTINCT s.viewer_id) AS viewers,COUNT(*) AS visible,
      COUNT(DISTINCT q.viewer_id) AS qualified_viewers FROM seen s LEFT JOIN qualified q ON s.viewer_id=q.viewer_id AND s.algorithm=q.algorithm GROUP BY s.algorithm`;
  const report = rows.map((r) => ({
    algorithm: r.algorithm,
    viewers: Number(r.viewers),
    visiblePairs: Number(r.visible),
    qualifiedViewers: Number(r.qualified_viewers),
  }));
  await prisma.analyticsEvent.create({
    data: {
      eventType: "shadow_report",
      eventData: {
        kind: "descriptive_outcomes",
        experimentScope: "rebuilt_scoring_policy_on_vs_off",
        algorithmLabels: { "0": "policy_off", "1": "policy_on" },
        legacyBaseline: false,
        report,
        limitation:
          "Observational report only. Does not establish experiment lift or confidence intervals. Users can appear in both versions after configuration changes.",
      },
    },
  });
  console.log(JSON.stringify(report, null, 2));
}
main().finally(() => prisma.$disconnect());
