require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const connectDB = require('./config/database');
const db = require('./config/database');

// Import routes
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

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB (non-fatal: server starts either way)
connectDB().then((conn) => {
  if (conn) {
    const Review = require('./models/Review');
    Review.syncIndexes().then(() => {
      console.log('✅ Review indexes synced');
    }).catch((err) => {
      if (err.message && err.message.includes('externalId')) {
        console.warn('⚠️  Review index sync warning:', err.message);
        console.warn('   If you see duplicate key errors, run: db.reviews.dropIndex("externalId_1");');
      } else {
        console.error('Review index sync error:', err);
      }
    });
  }
}).catch(() => {});

// Create uploads directory
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Create cabins subdirectory
const cabinsUploadsDir = path.join(uploadsDir, 'cabins');
if (!fs.existsSync(cabinsUploadsDir)) {
  fs.mkdirSync(cabinsUploadsDir, { recursive: true });
}

// CORS configuration for embedded iframe
const allowCraftOrigin = (req, res, next) => {
  const origin = req.headers.origin;
  if (origin === 'https://driftdwells.com') {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
};

// Middleware
app.use(cors());
app.use(compression());

// Stripe webhook must receive raw body for signature verification (mount before express.json)
app.use('/api/stripe', express.raw({ type: 'application/json' }), stripeWebhookRoutes);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static file serving for uploads with caching headers
// Defensively guard setHeaders so a bad filePath or ext lookup can never crash /uploads.
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
      // Fallback: never throw for header logic on static files
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }
  }
};
app.use('/uploads', express.static(uploadsDir, staticOptions));

// Require DB for routes that use MongoDB (avoids crash when DB is down)
const requireDb = (req, res, next) => {
  if (db.isConnected && db.isConnected()) return next();
  res.status(503).json({ success: false, message: 'Database unavailable. Please try again shortly.' });
};

// Health check first (no DB required) so it is not gated by requireDb
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Drift & Dwells Booking API is running',
    database: db.isConnected && db.isConnected() ? 'connected' : 'disconnected'
  });
});

// Routes
app.use('/api/availability', requireDb, availabilityRoutes);
app.use('/api/bookings', requireDb, bookingRoutes);
app.use('/api/cabins', requireDb, cabinRoutes);
app.use('/api/cabin-types', requireDb, cabinTypeRoutes);
app.use('/api/units', requireDb, unitRoutes);
app.use('/api', requireDb, reviewRoutes); // Public review routes (e.g. GET /api/cabins/:id/reviews)
app.use('/api/admin', requireDb, adminRoutes);
app.use('/api/admin/reviews', adminReviewRoutes);
app.use('/api/admin/cabin-types', adminCabinTypeRoutes);
app.use('/api/drafts', allowCraftOrigin, requireDb, draftRoutes);
app.use('/api/email/webhook', emailWebhookRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    message: 'Something went wrong!', 
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error' 
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`🚀 Drift & Dwells Booking Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
});
