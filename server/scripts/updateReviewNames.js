/* server/scripts/updateReviewNames.js */
/**
 * Update existing reviews from original CSV/JSON file to extract and populate reviewerName.
 * This script UPDATES existing reviews (unlike importReviews which skips duplicates).
 * 
 * Usage: node server/scripts/updateReviewNames.js --file /path/to/file.json --cabin "Bucephalus" [--dry-run]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const Review = require('../models/Review');
const Cabin = require('../models/Cabin');
const { sanitizeName } = require('../utils/nameUtils');

// Reuse CSV parsing from importReviews
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

function loadCSV(p) {
  const raw = fs.readFileSync(p, 'utf8');
  const lines = raw.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];

  const header = parseCSVLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0) continue;
    
    const row = {};
    header.forEach((col, idx) => {
      row[col] = values[idx] || '';
    });
    rows.push(row);
  }

  return rows;
}

function loadJSON(p) {
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

function get(row, keys, fallback = undefined) {
  for (const k of [].concat(keys)) {
    if (row && row[k] != null && row[k] !== '') return row[k];
  }
  return fallback;
}

/**
 * Extract reviewer name from a row (same logic as importReviews)
 */
function extractReviewerName(row) {
  // Try to get first name and last name separately, then combine
  const firstName = get(row, ['reviewer_firstName', 'reviewer_first_name', 'firstName', 'first_name']);
  const lastName = get(row, ['reviewer_lastName', 'reviewer_last_name', 'lastName', 'last_name']);
  
  // If we have both, combine them
  if (firstName && lastName) {
    const combined = `${String(firstName).trim()} ${String(lastName).trim()}`;
    if (combined.trim().length > 0) {
      const rawName = combined;
      // Continue with sanitization below
      let cleaned = rawName.trim();
      if (cleaned.includes('@')) {
        const emailMatch = cleaned.match(/^([^@]+)@/);
        if (emailMatch) {
          cleaned = emailMatch[1].trim();
        } else {
          cleaned = '';
        }
      }
      cleaned = cleaned.replace(/https?:\/\/[^\s]+/gi, '').trim();
      cleaned = cleaned.replace(/\.{2,}/g, '').trim();
      if (cleaned.length > 60) {
        cleaned = cleaned.substring(0, 60).trim();
      }
      return cleaned.length > 0 ? cleaned : null;
    }
  }
  
  // If only first name, use that
  if (firstName && !lastName) {
    const rawName = String(firstName).trim();
    if (rawName.length > 0) {
      let cleaned = rawName.trim();
      if (cleaned.includes('@')) {
        const emailMatch = cleaned.match(/^([^@]+)@/);
        if (emailMatch) {
          cleaned = emailMatch[1].trim();
        } else {
          cleaned = '';
        }
      }
      cleaned = cleaned.replace(/https?:\/\/[^\s]+/gi, '').trim();
      cleaned = cleaned.replace(/\.{2,}/g, '').trim();
      if (cleaned.length > 60) {
        cleaned = cleaned.substring(0, 60).trim();
      }
      return cleaned.length > 0 ? cleaned : null;
    }
  }
  
  // Fall back to single name field
  const rawName = get(row, [
    'reviewer_name', 'Reviewer Name', 'reviewerName',
    'author', 'Author', 'authorName',
    'guest_name', 'guestName', 'Guest Name',
    'reviewer', 'Reviewer', 'name', 'Name',
    'userName', 'user_name', 'User Name'
  ]);
  
  if (!rawName || typeof rawName !== 'string') return null;
  
  const trimmed = rawName.trim();
  if (trimmed.length === 0) return null;
  
  // Sanitize using the same logic as importReviews
  let cleaned = trimmed;
  
  if (cleaned.includes('@')) {
    const emailMatch = cleaned.match(/^([^@]+)@/);
    if (emailMatch) {
      cleaned = emailMatch[1].trim();
    } else {
      cleaned = '';
    }
  }
  
  cleaned = cleaned.replace(/https?:\/\/[^\s]+/gi, '').trim();
  cleaned = cleaned.replace(/\.{2,}/g, '').trim();
  
  if (cleaned.length > 60) {
    cleaned = cleaned.substring(0, 60).trim();
  }
  
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Generate externalId from row (same logic as importReviews)
 */
function generateExternalId(row, reviewText) {
  // Try id_comment first (Airbnb export format)
  const ext = get(row, ['id_comment', 'id', 'review_id', 'Review ID', 'external_id', 'reviewId']);
  if (ext) return ext.toString();
  
  // Fallback: compose from available fields
  const listingId = get(row, ['listing_id', 'Listing ID', 'listingId'], 'unknown');
  const date = get(row, ['createdAt', 'date', 'Date', 'created_at', 'review_date'], Date.now());
  const textHash = reviewText.slice(0, 32).replace(/[^a-zA-Z0-9]/g, '');
  return `airbnb:${listingId}:${date}:${textHash}`;
}

async function updateReviewNames(options = {}) {
  const { file, cabin, dryRun = false } = options;
  
  if (!file) throw new Error('Missing --file /absolute/or/relative/path');
  if (!cabin) throw new Error('Missing --cabin "Cabin Name"');
  
  try {
    // Connect to DB
    const MONGO = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL || 'mongodb://localhost:27017/drift-dwells-booking';
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO, {});
    console.log('✅ MongoDB Connected\n');

    console.log('📦 Review Name Updater');
    console.log('======================');
    console.log('File:   ', file);
    console.log('Cabin:  ', cabin);
    console.log('Mode:   ', dryRun ? 'DRY RUN (no changes)' : 'LIVE UPDATE');
    console.log('');

    // Find cabin
    const cabinDoc = await Cabin.findOne({ name: cabin });
    if (!cabinDoc) {
      throw new Error(`Cabin not found: "${cabin}"`);
    }
    const cabinId = cabinDoc._id;
    console.log(`✅ Found cabin: ${cabinDoc.name} (${cabinId})\n`);

    // Load file
    const filePath = path.resolve(file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    const ext = path.extname(filePath).toLowerCase();
    console.log(`Reading ${ext === '.csv' ? 'CSV' : 'JSON'} file...`);
    
    let rows;
    try {
      rows = ext === '.csv' ? loadCSV(filePath) : loadJSON(filePath);
    } catch (err) {
      throw new Error(`Failed to parse file: ${err.message}`);
    }
    
    if (!Array.isArray(rows)) {
      throw new Error('Input must be an array of reviews');
    }
    
    console.log(`✅ Loaded ${rows.length} rows\n`);

    let total = 0, updated = 0, skipped = 0, errors = 0;
    const errorDetails = [];

    console.log('Processing reviews...');
    for (const row of rows) {
      total++;
      try {
        // Extract review text to match reviews
        const reviewText = String(
          get(row, ['comment', 'comments', 'text', 'review', 'Review Text', 'Comments', 'review_text'], '')
        ).trim();
        
        if (!reviewText || reviewText.length === 0) {
          skipped++;
          continue;
        }

        // Generate externalId to match existing review
        const externalId = generateExternalId(row, reviewText);
        
        // Try to find existing review by externalId first
        let existingReview = await Review.findOne({ 
          externalId, 
          cabinId 
        });
        
        // If not found by externalId, try matching by review text (first 100 chars)
        if (!existingReview && reviewText.length > 20) {
          const textPrefix = reviewText.substring(0, 100).trim();
          // Escape special regex characters and limit length
          const escapedPrefix = textPrefix
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            .substring(0, 50);
          try {
            existingReview = await Review.findOne({
              cabinId,
              text: { $regex: new RegExp(escapedPrefix, 'i') }
            });
          } catch (regexError) {
            // If regex fails, try exact text match (without HTML tags)
            const cleanText = reviewText.replace(/<[^>]+>/g, '').trim().substring(0, 100);
            existingReview = await Review.findOne({
              cabinId,
              text: { $regex: new RegExp(cleanText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').substring(0, 30), 'i') }
            });
          }
        }
        
        if (!existingReview) {
          skipped++;
          if (skipped <= 5) {
            console.log(`  [SKIP] No matching review found for externalId: ${externalId}`);
          }
          continue;
        }

        // Extract reviewer name from row
        const reviewerName = extractReviewerName(row);
        
        // Extract additional fields for authenticity
        const reviewerId = get(row, ['reviewer_id', 'reviewerId', 'reviewerID']);
        const reviewHighlight = get(row, ['reviewHighlight', 'review_highlight', 'highlight']);
        const highlightType = get(row, ['highlightType', 'highlight_type']);
        const localizedDate = get(row, ['localizedDate', 'localized_date']);
        
        // Check if update is needed
        const currentName = existingReview.reviewerName || null;
        const needsNameUpdate = reviewerName && reviewerName !== currentName;
        const needsOtherUpdate = 
          (reviewerId && reviewerId !== (existingReview.reviewerId || null)) ||
          (reviewHighlight && reviewHighlight !== (existingReview.reviewHighlight || null)) ||
          (highlightType && highlightType !== (existingReview.highlightType || null)) ||
          (localizedDate && localizedDate !== (existingReview.localizedDate || null));
        
        if (!needsNameUpdate && !needsOtherUpdate) {
          skipped++;
          if (skipped <= 5) {
            console.log(`  [SKIP] Review ${existingReview._id}: already up to date`);
          }
          continue;
        }

        // Update the review
        if (!dryRun) {
          if (needsNameUpdate) {
            existingReview.reviewerName = reviewerName;
          }
          if (reviewerId) existingReview.reviewerId = String(reviewerId).trim();
          if (reviewHighlight) existingReview.reviewHighlight = String(reviewHighlight).trim();
          if (highlightType && ['LENGTH_OF_STAY', 'TYPE_OF_TRIP'].includes(highlightType)) {
            existingReview.highlightType = highlightType;
          }
          if (localizedDate) existingReview.localizedDate = String(localizedDate).trim();
          await existingReview.save(); // This will trigger sanitization in pre-save hook
        }
        
        updated++;
        const updates = [];
        if (needsNameUpdate) updates.push(`name: "${currentName || 'null'}" → "${reviewerName}"`);
        if (reviewerId) updates.push(`reviewerId: ${reviewerId}`);
        if (reviewHighlight) updates.push(`highlight: ${reviewHighlight}`);
        if (updated <= 10) {
          console.log(`  [UPDATE] ${existingReview._id}: ${updates.join(', ')}`);
        }
      } catch (e) {
        errors++;
        const errorMsg = `Row ${total}: ${e.message}`;
        errorDetails.push(errorMsg);
        if (errorDetails.length <= 10) {
          console.error(`  ❌ ${errorMsg}`);
        }
      }
    }

    console.log('');
    console.log('📊 Update Summary');
    console.log('==================');
    console.log('Cabin:         ', cabin);
    console.log('Total rows:    ', total);
    console.log('✅ Updated:    ', updated);
    console.log('⏭️  Skipped:    ', skipped);
    console.log('❌ Errors:     ', errors);
    
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
    console.error('\n❌ Update failed:', err.message);
    if (err.stack && process.env.NODE_ENV === 'development') {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

// Parse command line args
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--file' && i + 1 < argv.length) args.file = argv[++i];
    else if (a === '--cabin' && i + 1 < argv.length) args.cabin = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv);
updateReviewNames(args);

