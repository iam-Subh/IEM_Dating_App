import { prisma } from '../utils/prisma';

/**
 * Open rates per kind and per line (apps/mobile/src/features/notifications/NOTIFICATIONS_PLAN.md 13):
 * how many went out, how many were opened, and how many made someone switch
 * that type off. Every two weeks, lines far under the average are replaced.
 */
export class PushStatsService {
  static async stats(days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60_000);
    const rows = await prisma.$queryRaw<{ kind: string; template: string | null; sent: number; opened: number; turned_off: number }[]>`
      SELECT kind, template, COUNT(*)::int AS sent,
        COUNT(opened_at)::int AS opened, COUNT(turned_off_at)::int AS turned_off
      FROM push_log WHERE sent_at >= ${since}
      GROUP BY kind, template ORDER BY kind, template`;
    const rate = (opened: number, sent: number) => (sent ? Math.round((opened / sent) * 1000) / 10 : 0);
    const lines = rows.map((row) => ({ ...row, openRate: rate(row.opened, row.sent) }));
    const totals = new Map<string, { kind: string; sent: number; opened: number; turnedOff: number }>();
    for (const row of rows) {
      const total = totals.get(row.kind) ?? { kind: row.kind, sent: 0, opened: 0, turnedOff: 0 };
      total.sent += row.sent; total.opened += row.opened; total.turnedOff += row.turned_off;
      totals.set(row.kind, total);
    }
    const kinds = [...totals.values()].map((total) => ({ ...total, openRate: rate(total.opened, total.sent) }));
    return { days, kinds, lines };
  }
}
