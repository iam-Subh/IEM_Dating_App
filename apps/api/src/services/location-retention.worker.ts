import { logger } from '../utils/logger';
import { LocationService } from './location.service';

const INTERVAL_MS = 60 * 60 * 1000;

/**
 * Erases positions nobody has refreshed in 30 days and saved places nobody
 * has been back to in 90 (LOCATION_SPEC.md 6.8, 7). Hourly is far finer than
 * either window needs; it runs once at start so a restart never delays it.
 */
export class LocationRetentionWorker {
  private static timer: NodeJS.Timeout | undefined;
  private static running = false;

  static start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.run(), INTERVAL_MS);
    this.timer.unref();
    void this.run();
  }

  static stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  static async run() {
    if (this.running) return null;
    this.running = true;
    try {
      const result = await LocationService.sweep();
      if (result.erasedPositions || result.removedPlaces) logger.info('Location retention sweep', result);
      return result;
    } catch (error) {
      logger.warn('Location retention sweep failed', { error: (error as Error)?.message });
      return null;
    } finally {
      this.running = false;
    }
  }
}
