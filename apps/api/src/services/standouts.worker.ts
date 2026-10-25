import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { AlgorithmConfigService } from './algorithm-config.service';
import { StandoutsV3Service } from './standouts-v3.service';
import { istDay } from './discovery-cards.service';

const CHECK_MS = 10 * 60_000;
/** The night run's window, in minutes after midnight IST (STANDOUTS_PLAN.md 6). */
const WINDOW_START = 30;
const WINDOW_END = 180;

/** Minutes after midnight in India. */
function istMinute(now = new Date()) {
  return (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440;
}

/**
 * Starts the Standouts v3 night run (standouts-v3.service.ts) once a day,
 * between 00:30 and 03:00 IST, when v3 or its shadow mode is on. Viewers it
 * does not reach get their set on first open, inside the same limits.
 */
export class StandoutsWorker {
  private static timer: NodeJS.Timeout | undefined;
  private static running = false;

  static start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), CHECK_MS);
    this.timer.unref();
    void this.tick();
  }

  static stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  static async tick() {
    const minute = istMinute();
    if (minute < WINDOW_START || minute >= WINDOW_END) return null;
    return this.run(istDay());
  }

  /** Runs the day's night run unless it already finished. Also callable by an admin. */
  static async run(day: string) {
    if (this.running) return null;
    const { flags } = await AlgorithmConfigService.get();
    const mode = flags.standouts_v3 === 1 ? 'live' : flags.standouts_shadow === 1 ? 'shadow' : null;
    if (!mode) return null;
    const done = await prisma.standoutRun.findUnique({ where: { day }, select: { finishedAt: true, mode: true } });
    if (done?.finishedAt && done.mode === mode) return null;
    this.running = true;
    try {
      // One instance at a time, through the run's own row: claimed in one
      // statement, and claimable again only if a run died an hour ago unfinished.
      const claimed = await prisma.$executeRaw`
        INSERT INTO standout_runs (day, mode) VALUES (${day}, ${mode})
        ON CONFLICT (day) DO UPDATE SET mode = ${mode}, started_at = now(), finished_at = NULL
        WHERE standout_runs.mode <> ${mode}
           OR (standout_runs.finished_at IS NULL AND standout_runs.started_at < now() - interval '1 hour')`;
      if (!claimed) return null;
      return await StandoutsV3Service.nightly(day, mode);
    } catch (error) {
      logger.warn('Standouts night run failed', { error: (error as Error)?.message });
      return null;
    } finally {
      this.running = false;
    }
  }
}
