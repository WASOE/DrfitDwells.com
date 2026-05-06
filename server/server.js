require('dotenv').config();
const { validateProductionEnvOrExit } = require('./config/validateProductionEnv');
validateProductionEnvOrExit();

const express = require('express');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const connectDB = require('./config/database');
const db = require('./config/database');

const availabilityRoutes = require('./routes/availabilityRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const cabinRoutes = require('./routes/cabinRoutes');
const cabinTypeRoutes = require('./routes/cabinTypeRoutes');
const unitRoutes = require('./routes/unitRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const adminRoutes = require('./routes/adminRoutes');
const adminReviewRoutes = require('./routes/adminReviewRoutes');
const adminCabinTypeRoutes = require('./routes/adminCabinTypeRoutes');
const draftRoutes = require('./routes/draftRoutes');
const emailWebhookRoutes = require('./routes/emailWebhookRoutes');
const stripeWebhookRoutes = require('./routes/stripeWebhookRoutes');
const chatRoutes = require('./routes/chatRoutes');
const opsRoutes = require('./routes/ops');
const internalSyncRoutes = require('./routes/internalSyncRoutes');
const maintenanceRoutes = require('./routes/maintenanceRoutes');
const publicCalendarRoutes = require('./routes/publicCalendarRoutes');
const publicGuideRoutes = require('./routes/publicGuideRoutes');
const creatorReferralVisitRoutes = require('./routes/creatorReferralVisitRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

/**
 * Express trust proxy: must match reverse-proxy hop count (e.g. 1 for single CDN/ALB).
 * Set TRUST_PROXY to an integer; unset defaults to 1. Verify with real X-Forwarded-For chain in staging/prod.
 */
function resolveTrustProxySetting() {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined || raw === '') {
    return 1;
  }
  const n = parseInt(String(raw), 10);
  if (!Number.isNaN(n) && n >= 0) {
    return n;
  }
  if (String(raw).trim().toLowerCase() === 'true') {
    return true;
  }
  return 1;
}

app.set('trust proxy', resolveTrustProxySetting());

// --- Env var validation (warnings for missing optional config) ---
if (process.env.NODE_ENV === 'production') {
  const warnings = [];
  if (!process.env.MONGODB_URI) warnings.push('MONGODB_URI not set — using localhost default');
  if (!process.env.STRIPE_SECRET_KEY) warnings.push('STRIPE_SECRET_KEY not set — payments disabled');
  if (!process.env.STRIPE_WEBHOOK_SECRET) warnings.push('STRIPE_WEBHOOK_SECRET not set — webhooks disabled');
  if (!process.env.SMTP_URL && !process.env.SMTP_HOST) {
    warnings.push('SMTP transport not set (SMTP_URL or SMTP_HOST) — emails will be logged, not sent');
  }
  if (!process.env.CORS_ORIGINS) warnings.push('CORS_ORIGINS not set — using localhost defaults');
  warnings.forEach(w => console.warn(`[ENV WARNING] ${w}`));
}

// --- Uncaught error handlers (keep the process alive for transient errors) ---
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Give existing requests 5s to finish, then exit
  setTimeout(() => process.exit(1), 5000);
});

// --- MongoDB (non-fatal) ---
connectDB().then((conn) => {
  if (conn) {
    const Review = require('./models/Review');
    Review.syncIndexes().then(() => {
      console.log('Review indexes synced');
    }).catch((err) => {
      if (err.message && err.message.includes('externalId')) {
        console.warn('Review index sync warning:', err.message);
      } else {
        console.error('Review index sync error:', err);
      }
    });

    // Automatic iCal sync scheduling (prod-safe, env-controlled).
    try {
      const { startIcalSyncSchedulerIfEnabled } = require('./services/ops/ingestion/icalSyncScheduler');
      startIcalSyncSchedulerIfEnabled();
    } catch (e) {
      console.error('[ical-sync] Scheduler startup failed:', e?.message || e);
    }
  }
}).catch(() => {});

// --- Directories ---
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const cabinsUploadsDir = path.join(uploadsDir, 'cabins');
if (!fs.existsSync(cabinsUploadsDir)) fs.mkdirSync(cabinsUploadsDir, { recursive: true });

// --- CORS ---
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

if (ALLOWED_ORIGINS.length === 0) {
  ALLOWED_ORIGINS.push('http://localhost:5173', 'http://localhost:3000');
}

const corsOptions = {
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(null, false);
  },
  credentials: true
};

const allowCraftOrigin = (req, res, next) => {
  const origin = req.headers.origin;
  if (origin === 'https://driftdwells.com' || origin === 'https://driftanddwells.com') {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
};

// --- Rate limiters ---
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts, please try again later.' }
});

const bookingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many booking requests, please slow down.' }
});

// --- Middleware ---
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors(corsOptions));
app.use(compression());

// Stripe webhook: raw body for signature verification (before express.json)
app.use('/api/stripe', express.raw({ type: 'application/json' }), stripeWebhookRoutes);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(mongoSanitize());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// General API rate limit
app.use('/api', apiLimiter);

// Static file serving with caching
const staticOptions = {
  maxAge: '7d',
  setHeaders(res, filePath) {
    try {
      const ext = path.extname(String(filePath || '')).toLowerCase();
      const longCacheExtensions = ['.mp4', '.webm', '.png', '.jpg', '.jpeg', '.avif', '.webp'];
      if (longCacheExtensions.includes(ext)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=604800');
      }
    } catch {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }
  }
};
app.use('/uploads', express.static(uploadsDir, staticOptions));

// Legacy SEO URL hard redirect to canonical terms page.
app.get(['/terms-and-conditions-drift-dwells', '/terms-and-conditions-drift-dwells/'], (req, res) => {
  res.redirect(301, '/terms');
});
app.get('/uploads/PDFs/drift-dwells-docs-v2/terms.pdf', (req, res) => {
  res.redirect(301, '/legal/terms-2026-04-19-v2.pdf');
});

// DB availability check
const requireDb = (req, res, next) => {
  if (db.isConnected && db.isConnected()) return next();
  res.status(503).json({ success: false, message: 'Database unavailable. Please try again shortly.' });
};

// Health check (no DB required)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Drift & Dwells Booking API is running',
    database: db.isConnected && db.isConnected() ? 'connected' : 'disconnected'
  });
});

// --- Routes ---
app.use('/api/chat', chatRoutes); // No DB required—FAQ retrieval only
app.use('/api/public', requireDb, publicCalendarRoutes);
app.use('/api/public', requireDb, publicGuideRoutes);
app.use('/api/availability', requireDb, availabilityRoutes);
app.use('/api/creator-referral-visits', requireDb, creatorReferralVisitRoutes);
app.use('/api/bookings', requireDb, bookingRoutes);
app.use('/api/cabins', requireDb, cabinRoutes);
app.use('/api/cabin-types', requireDb, cabinTypeRoutes);
app.use('/api/units', requireDb, unitRoutes);
app.use('/api', requireDb, reviewRoutes);
app.use('/api/admin/login', authLimiter);
app.use('/api/admin', requireDb, adminRoutes);
app.use('/api/admin/reviews', requireDb, adminReviewRoutes);
app.use('/api/admin/cabin-types', requireDb, adminCabinTypeRoutes);
app.use('/api/drafts', allowCraftOrigin, requireDb, draftRoutes);
app.use('/api/email/webhook', emailWebhookRoutes);
app.use('/api/ops', requireDb, opsRoutes);
app.use('/api/internal/sync', requireDb, internalSyncRoutes);
app.use('/api/maintenance', requireDb, maintenanceRoutes);

// Error handling
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

const server = app.listen(PORT, () => {
  console.log(`Drift & Dwells Booking Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  // Precompute chat FAQ embeddings (non-blocking)
  const chatService = require('./services/chatService');
  chatService.warmEmbeddings().catch((err) => console.warn('[chat] Warm failed:', err?.message));
});

// --- Graceful shutdown ---
const shutdown = (signal) => {
  console.log(`${signal} received. Shutting down gracefully...`);
  server.close(() => {
    const mongoose = require('mongoose');
    mongoose.connection.close(false).then(() => {
      console.log('MongoDB connection closed.');
      process.exit(0);
    }).catch(() => process.exit(0));
  });
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
