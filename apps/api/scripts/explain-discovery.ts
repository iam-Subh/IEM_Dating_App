import { PrismaClient } from "@prisma/client";
import { RetrievalService } from "../src/services/retrieval.service";
import { writeFileSync } from "fs";
const db = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
let query = "";
let params: any[] = [];
db.$on("query", (e) => {
  if (e.query.includes("WITH incoming")) {
    query = e.query;
    params = JSON.parse(e.params);
  }
});
async function main() {
  const me = await db.user.findFirstOrThrow({
    where: { swipesMade: { some: {} } },
  });
  me.discoveryMode = "distance";
  me.college = "IEM";
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL jit=off");
    await tx.$executeRawUnsafe("SET LOCAL plan_cache_mode=force_custom_plan");
    await RetrievalService.ids(
      me,
      "benchmark:5",
      400,
      [],
      tx as unknown as PrismaClient,
    );
    return tx.$queryRawUnsafe<any[]>(
      "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + query,
      ...params,
    );
  });
  writeFileSync(
    "../../docs/verification/discovery-plan.json",
    JSON.stringify(result, null, 2),
  );
  function walk(n: any, depth = 0) {
    console.log(
      " ".repeat(depth) +
        n["Node Type"] +
        " " +
        (n["Relation Name"] ?? n["Index Name"] ?? "") +
        " rows=" +
        n["Actual Rows"] +
        " loops=" +
        n["Actual Loops"] +
        " time=" +
        n["Actual Total Time"] +
        " removed=" +
        (n["Rows Removed by Filter"] ?? 0),
    );
    for (const p of n.Plans ?? []) walk(p, depth + 1);
  }
  walk(result[0]["QUERY PLAN"][0].Plan);
}
main().finally(() => db.$disconnect());
