import "dotenv/config";
import { prisma } from "../src/utils/prisma";
async function main() {
  // Run during a swipe maintenance window. Old retry-inflated counters are replaced by stored decisions.
  await prisma.$executeRaw`INSERT INTO user_scores(id,user_id,total_swipes_out,total_right_swipes,total_swipes_received,total_likes_received,updated_at)
    SELECT gen_random_uuid(),u.id,COALESCE(o.total,0),COALESCE(o.likes,0),COALESCE(i.total,0),COALESCE(i.likes,0),now()
    FROM users u LEFT JOIN (SELECT swiper_id,COUNT(*)::int total,COUNT(*) FILTER(WHERE action='like')::int likes FROM swipes GROUP BY swiper_id) o ON o.swiper_id=u.id
    LEFT JOIN (SELECT target_id,COUNT(*)::int total,COUNT(*) FILTER(WHERE action='like')::int likes FROM swipes GROUP BY target_id) i ON i.target_id=u.id
    ON CONFLICT(user_id) DO UPDATE SET total_swipes_out=EXCLUDED.total_swipes_out,total_right_swipes=EXCLUDED.total_right_swipes,
      total_swipes_received=EXCLUDED.total_swipes_received,total_likes_received=EXCLUDED.total_likes_received,updated_at=now()`;
  console.log("Swipe counters reconciled from persisted decisions.");
}
main().finally(() => prisma.$disconnect());
