require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const connectDB = require('./config/database');

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

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
connectDB().then(() => {
  // Sync indexes for Review model to ensure externalId is sparse
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
});

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static file serving for uploads with caching headers
const staticOptions = {
  maxAge: '7d',
  setHeaders(res, filePath) {
    const longCacheExtensions = ['.mp4', '.webm', '.png', '.jpg', '.jpeg', '.avif', '.webp'];
    if (longCacheExtensions.includes(path.extname(filePath).toLowerCase())) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }
  }
};
app.use('/uploads', express.static(uploadsDir, staticOptions));

// Routes
app.use('/api/availability', availabilityRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/cabins', cabinRoutes);
app.use('/api/cabin-types', cabinTypeRoutes);
app.use('/api/units', unitRoutes);
app.use('/api', reviewRoutes); // Public review routes
app.use('/api/admin', adminRoutes);
app.use('/api/admin/reviews', adminReviewRoutes); // Admin review routes (protected by adminAuth in adminRoutes)
app.use('/api/admin/cabin-types', adminCabinTypeRoutes); // Admin A-frame routes (protected, feature-flagged)
app.use('/api/drafts', allowCraftOrigin, draftRoutes);
app.use('/api/email/webhook', emailWebhookRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Drift & Dwells Booking API is running' });
});

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
