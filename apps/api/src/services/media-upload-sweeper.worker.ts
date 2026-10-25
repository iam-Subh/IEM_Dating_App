import { logger } from '../utils/logger';
import { ChatMediaService } from './chat-media.service';
import { StoryBatchService } from './story-batch.service';
import { StoryStickerService } from './story-sticker.service';

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const COUNTDOWN_INTERVAL_MS = 60 * 1000;

/**
 * Aborts abandoned resumable uploads.
 *
 * A phone can start a 500 MB upload and never come back. S3 keeps the parts
 * of an unfinished multipart upload, and bills for them, until it is aborted.
 */
export class MediaUploadSweeper {
  private static timer: NodeJS.Timeout | undefined;
  private static countdownTimer: NodeJS.Timeout | undefined;
  private static running = false;
  private static countdownRunning = false;

  static start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref();
    // Countdown reminders are due to the minute, so they run on their own clock.
    this.countdownTimer = setInterval(() => void this.remindCountdowns(), COUNTDOWN_INTERVAL_MS);
    this.countdownTimer.unref();
  }

  static stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.timer = undefined;
    this.countdownTimer = undefined;
  }

  static async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const [chat, stories] = await Promise.all([
        ChatMediaService.sweepExpiredMultipartUploads(),
        StoryBatchService.sweep(),
      ]);
      return chat + stories;
    } catch (error) {
      logger.warn('Media upload sweep failed', { error: (error as Error)?.message });
      return 0;
    } finally {
      this.running = false;
    }
  }

  private static async remindCountdowns() {
    if (this.countdownRunning) return;
    this.countdownRunning = true;
    try {
      await StoryStickerService.sweepCountdowns();
    } catch (error) {
      logger.warn('Countdown reminders failed', { error: (error as Error)?.message });
    } finally {
      this.countdownRunning = false;
    }
  }
}
