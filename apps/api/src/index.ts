import { VerificationRemindersWorker } from './services/verification-reminders.worker';
import { DiscoveryTelemetry } from "./services/discovery-telemetry.service";
import 'dotenv/config';
import { createServer } from 'http';
import app from './app';
import { logger } from './utils/logger';
import { closeSocket, setupSocket } from './socket';
import { prisma } from './utils/prisma';
import { installNotificationLive } from './services/notification-feed.service';
import { installSessionLive } from './services/session-live';

// Every notification written anywhere reaches its owner's open app, live.
installNotificationLive(prisma);
// Signing in or out anywhere shows on the Active sessions page, live.
installSessionLive(prisma);
import { ImpressionService } from './services/impression.service';
import { ShadowService } from './services/shadow.service';
import { validateAuthConfiguration } from './utils/jwt';
import { OutboxWorker } from './services/outbox.worker';
import { MessageExpiryWorker } from './services/message-expiry.worker';
import { MediaUploadSweeper } from './services/media-upload-sweeper.worker';
import { LocationRetentionWorker } from './services/location-retention.worker';
import { AccountLifecycleService } from './services/account-lifecycle.service';
import { StoryLifecycleWorker } from './services/story-lifecycle.worker';
import { StandoutsWorker } from './services/standouts.worker';
import { PushEngagementWorker } from './services/push-engagement.service';

const PORT = process.env.PORT || 3000;
const httpServer = createServer(app);

// Startup sequence
const bootstrap = async () => {
  try {
    validateAuthConfiguration();
    // 1. Check Database Connection
    await prisma.$connect();
    logger.info('Database connection established successfully');

    setupSocket(httpServer);
    OutboxWorker.start();
    MessageExpiryWorker.start();
    MediaUploadSweeper.start();
    LocationRetentionWorker.start();
    AccountLifecycleService.start();
    StoryLifecycleWorker.start();
    StandoutsWorker.start();
    VerificationRemindersWorker.start();
    PushEngagementWorker.start();

    // 2. Begin draining buffered impressions into Postgres
    ImpressionService.startFlushLoop();

    // 3. Start HTTP Server
    httpServer.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

bootstrap();

// Graceful Shutdown
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  try {
    // Drain buffered impressions before the process exits, otherwise the
    // last minute of data is lost on every deploy.
    await ImpressionService.stopFlushLoop();
    await ShadowService.stop();
    await DiscoveryTelemetry.flush();
    await OutboxWorker.stop();
    await MessageExpiryWorker.stop();
    MediaUploadSweeper.stop();
    LocationRetentionWorker.stop();
    AccountLifecycleService.stop();
    StoryLifecycleWorker.stop();
    StandoutsWorker.stop();
    PushEngagementWorker.stop();
    await closeSocket();
    logger.info('Impression buffer flushed');

    await prisma.$disconnect();
    logger.info('Prisma disconnected');
    httpServer.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
  } catch (err) {
    logger.error('Error during shutdown:', err);
    process.exit(1);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
