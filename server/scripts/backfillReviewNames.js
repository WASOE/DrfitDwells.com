/* server/scripts/backfillReviewNames.js */
/**
 * Backfill script to migrate reviewer names from legacy fields to reviewerName
 * and sanitize existing names.
 * 
 * Usage: node server/scripts/backfillReviewNames.js [--dry-run]
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Review = require('../models/Review');
const { sanitizeName } = require('../utils/nameUtils');

async function backfillReviewNames(options = {}) {
  const { dryRun = false } = options;
  
  try {
    // Connect to DB
    const MONGO = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL || 'mongodb://localhost:27017/drift-dwells-booking';
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO, {});
    console.log('✅ MongoDB Connected\n');

    console.log('📦 Reviewer Name Backfill');
    console.log('==========================');
    console.log('Mode:   ', dryRun ? 'DRY RUN (no changes)' : 'LIVE UPDATE');
    console.log('');

    // Find all reviews
    const reviews = await Review.find({ deletedAt: { $exists: false } }).lean();
    console.log(`Found ${reviews.length} reviews to process\n`);

    let updated = 0;
    let skipped = 0;
    let errors = 0;
    const errorDetails = [];

    for (const review of reviews) {
      try {
        // Skip if reviewerName already exists and is non-empty
        if (review.reviewerName && review.reviewerName.trim().length > 0) {
          // Sanitize existing name if needed
          const sanitized = sanitizeName(review.reviewerName);
          
          if (sanitized && sanitized !== review.reviewerName) {
            // Name needs sanitization
            if (!dryRun) {
              await Review.findByIdAndUpdate(review._id, {
                $set: { reviewerName: sanitized }
              });
            }
            updated++;
            if (updated <= 10) {
              console.log(`  [SANITIZE] ${review._id}: "${review.reviewerName}" → "${sanitized}"`);
            }
          } else {
            skipped++;
          }
          continue;
        }

        // Try to find name in legacy fields
        const legacyFields = [
          review.name,
          review.authorName,
          review.author,
          review.userName,
          review.user_name
        ];

        let foundName = null;
        for (const field of legacyFields) {
          if (field && typeof field === 'string' && field.trim().length > 0) {
            const sanitized = sanitizeName(field);
            if (sanitized) {
              foundName = sanitized;
              break;
            }
          }
        }

        // Also check raw object if it exists
        if (!foundName && review.raw && typeof review.raw === 'object') {
          const rawFields = [
            review.raw.reviewer_name,
            review.raw.reviewerName,
            review.raw.author,
            review.raw.name,
            review.raw.guest_name,
            review.raw.guestName
          ];
          
          for (const field of rawFields) {
            if (field && typeof field === 'string' && field.trim().length > 0) {
              const sanitized = sanitizeName(field);
              if (sanitized) {
                foundName = sanitized;
                break;
              }
            }
          }
        }

        if (foundName) {
          // Update with found name
          if (!dryRun) {
            await Review.findByIdAndUpdate(review._id, {
              $set: { reviewerName: foundName }
            });
          }
          updated++;
          if (updated <= 10) {
            console.log(`  [BACKFILL] ${review._id}: "${foundName}"`);
          }
        } else {
          // No name found, set to null (will display as "Guest")
          if (!dryRun) {
            await Review.findByIdAndUpdate(review._id, {
              $set: { reviewerName: null }
            });
          }
          skipped++;
          if (skipped <= 5) {
            console.log(`  [SKIP] ${review._id}: No name found, set to null`);
          }
        }
      } catch (e) {
        errors++;
        const errorMsg = `Review ${review._id}: ${e.message}`;
        errorDetails.push(errorMsg);
        if (errorDetails.length <= 10) {
          console.error(`  ❌ ${errorMsg}`);
        }
      }
    }

    console.log('');
    console.log('📊 Backfill Summary');
    console.log('==================');
    console.log('Total reviews:  ', reviews.length);
    console.log('✅ Updated:     ', updated);
    console.log('⏭️  Skipped:     ', skipped);
    console.log('❌ Errors:      ', errors);

    if (errorDetails.length > 10) {
      console.log(`\n⚠️  First 10 errors:`);
      errorDetails.slice(0, 10).forEach(err => console.log(`   - ${err}`));
    } else if (errorDetails.length > 0) {
      console.log(`\n⚠️  Errors:`);
      errorDetails.forEach(err => console.log(`   - ${err}`));
    }

    await mongoose.disconnect();
    console.log('\n✅ Done!');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Backfill failed:', err.message);
    if (err.stack && process.env.NODE_ENV === 'development') {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

// Parse command line args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

backfillReviewNames({ dryRun });
















