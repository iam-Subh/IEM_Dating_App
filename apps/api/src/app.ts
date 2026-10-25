import express from 'express';
import cors from 'cors';
import { corsOrigin } from './utils/corsOrigin';
import helmet from 'helmet';
import { globalErrorHandler } from './middlewares/error.middleware';
import { logger } from './utils/logger';

const app = express();

// ngrok in development and the load balancer in production both deliver the
// real client IP in X-Forwarded-For. Express must be told, or express-rate-limit
// keys every bucket on the proxy own address and all users share one limit.
//
// Trust a fixed number of hops rather than true: trusting every proxy lets a
// client spoof X-Forwarded-For and mint a fresh rate-limit bucket per request,
// which would defeat the limiter on the auth and OTP routes entirely.
const trustedProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '', 10);
app.set('trust proxy', Number.isInteger(trustedProxyHops) && trustedProxyHops > 0 ? trustedProxyHops : false);

app.use(helmet());
app.use(cors({ origin: corsOrigin() }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Every refused request, one line each: method, path, status, and the error
// code when there is one. Without it a 404 in the app names no route at all.
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    if (res.statusCode < 400) return;
    const code = (res.locals as { errorCode?: string }).errorCode;
    logger.warn(`${req.method} ${req.originalUrl.split('?')[0]} -> ${res.statusCode}${code ? ` ${code}` : ''} (${Date.now() - started}ms)`);
  });
  next();
});

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

import authRoutes from './routes/auth.routes';
import profileRoutes from './routes/profile.routes';
import matchRoutes from './routes/match.routes';
import safetyRoutes from './routes/safety.routes';
import discoverRoutes from './routes/discover.routes';
import uploadRoutes from './routes/upload.routes';
import chatRoutes from './routes/chat.routes';
import adminRoutes from './routes/admin.routes';
import adminPanelRoutes from './routes/admin-panel.routes';
import legalRoutes from './routes/legal.routes';
import feedbackRoutes from './routes/feedback.routes';
import publicPagesRoutes from './routes/public-pages.routes';
import blockRoutes from './routes/block.routes';
import notificationRoutes from './routes/notification.routes';
import verificationRoutes from './routes/verification.routes';
import accountRoutes from './routes/account.routes';
import storyRoutes from './routes/story.routes';
import storyBatchRoutes from './routes/story-batch.routes';
import searchRoutes from './routes/search.routes';

// Main routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/profile', profileRoutes);
app.use('/api/v1/match', matchRoutes);
app.use('/api/v1/safety', safetyRoutes);
app.use('/api/v1/discover', discoverRoutes);
app.use('/api/v1/upload', uploadRoutes);
app.use('/api/v1/chat', chatRoutes);
app.use('/api/v1/legal', legalRoutes);
app.use('/api/v1/feedback', feedbackRoutes);
// Public pages: the legal documents and account deletion without the app.
app.use(publicPagesRoutes);
app.use('/api/v1/admin/panel', adminPanelRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/block', blockRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/verification', verificationRoutes);
app.use('/api/v1/account', accountRoutes);
// Before the Stories router, whose session check would reject the worker's publish token.
app.use('/api/v1/stories/batches', storyBatchRoutes);
app.use('/api/v1/stories', storyRoutes);
app.use('/api/v1/search', searchRoutes);

app.use(globalErrorHandler);

export default app;
