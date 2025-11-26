/* server/scripts/inspectReviews.js */
require('dotenv').config();
const mongoose = require('mongoose');
const Review = require('../models/Review');

(async function main() {
  try {
    const MONGO = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL || 'mongodb://localhost:27017/drift-dwells-booking';
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO, {});
    console.log('✅ MongoDB Connected\n');

    // Get a few sample reviews
    const reviews = await Review.find({ deletedAt: { $exists: false } }).limit(5).lean();
    
    console.log(`Found ${reviews.length} sample reviews:\n`);
    
    reviews.forEach((r, i) => {
      console.log(`--- Review ${i + 1} (${r._id}) ---`);
      console.log('reviewerName:', r.reviewerName || '(null/empty)');
      console.log('reviewerId:', r.reviewerId || '(not present)');
      console.log('reviewHighlight:', r.reviewHighlight || '(not present)');
      console.log('highlightType:', r.highlightType || '(not present)');
      console.log('localizedDate:', r.localizedDate || '(not present)');
      console.log('author:', r.author || '(not present)');
      console.log('name:', r.name || '(not present)');
      console.log('Has raw object:', !!r.raw);
      if (r.raw && typeof r.raw === 'object') {
        console.log('Raw object keys:', Object.keys(r.raw));
        console.log('raw.reviewer_name:', r.raw.reviewer_name || '(not present)');
        console.log('raw.author:', r.raw.author || '(not present)');
        console.log('raw.name:', r.raw.name || '(not present)');
        console.log('raw.reviewerName:', r.raw.reviewerName || '(not present)');
        console.log('raw.guest_name:', r.raw.guest_name || '(not present)');
      }
      console.log('');
    });

    // Count reviews with names
    const withReviewerName = await Review.countDocuments({ 
      deletedAt: { $exists: false },
      reviewerName: { $exists: true, $ne: null, $ne: '' }
    });
    
    const withoutReviewerName = await Review.countDocuments({ 
      deletedAt: { $exists: false },
      $or: [
        { reviewerName: { $exists: false } },
        { reviewerName: null },
        { reviewerName: '' }
      ]
    });
    
    console.log(`\n📊 Summary:`);
    console.log(`Reviews WITH reviewerName: ${withReviewerName}`);
    console.log(`Reviews WITHOUT reviewerName: ${withoutReviewerName}`);
    
    // Check if names might be in raw
    const withRaw = await Review.countDocuments({ 
      deletedAt: { $exists: false },
      raw: { $exists: true, $ne: null }
    });
    console.log(`Reviews with raw object: ${withRaw}`);
    
    await mongoose.disconnect();
    console.log('\n✅ Done!');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    if (err.stack && process.env.NODE_ENV === 'development') {
      console.error(err.stack);
    }
    process.exit(1);
  }
})();

