import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { globalErrorHandler } from './middlewares/error.middleware';

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Add context/correlation ID if needed later

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
import blockRoutes from './routes/block.routes';
import notificationRoutes from './routes/notification.routes';
import verificationRoutes from './routes/verification.routes';
import accountRoutes from './routes/account.routes';
import storyRoutes from './routes/story.routes';
import searchRoutes from './routes/search.routes';

// Main routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/profile', profileRoutes);
app.use('/api/v1/match', matchRoutes);
app.use('/api/v1/safety', safetyRoutes);
app.use('/api/v1/discover', discoverRoutes);
app.use('/api/v1/upload', uploadRoutes);
app.use('/api/v1/chat', chatRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/block', blockRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/verification', verificationRoutes);
app.use('/api/v1/account', accountRoutes);
app.use('/api/v1/stories', storyRoutes);
app.use('/api/v1/search', searchRoutes);

app.use(globalErrorHandler);

export default app;
