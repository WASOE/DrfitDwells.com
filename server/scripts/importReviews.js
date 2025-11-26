/* server/scripts/importReviews.js */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const Review = require('../models/Review');
const Cabin = require('../models/Cabin');

function parseArgs(argv) {
  // node server/scripts/importReviews.js --file /path/to/file.json --cabin "Bucephalus" [--dry-run] [--source airbnb]
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--file' && i + 1 < argv.length) args.file = argv[++i];
    else if (a === '--cabin' && i + 1 < argv.length) args.cabin = argv[++i];
    else if (a === '--source' && i + 1 < argv.length) args.source = argv[++i];
  }
  return args;
}

function loadJSON(p) {
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

/**
 * Simple CSV parser (handles quoted fields, commas in values)
 * Falls back to a basic line-by-line parser if quotes are complex
 */
function loadCSV(p) {
  const raw = fs.readFileSync(p, 'utf8');
  const lines = raw.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];

  // Parse header
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

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote state
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

/**
 * Map one Airbnb review row → Review doc fields.
 * Supports both JSON and CSV shapes. Adjust mappings if needed.
 */
function mapRowToReview(row, { cabinId, source }) {
  // Try to be resilient to different export headers/keys:
  const get = (obj, keys, fallback = undefined) => {
    for (const k of [].concat(keys)) {
      if (obj && obj[k] != null && obj[k] !== '') return obj[k];
    }
    return fallback;
  };

  const ratingRaw = get(row, ['rating', 'Rating', 'stars', 'Stars', 'star_rating'], 0);
  const rating = Number(ratingRaw);

  const text = String(
    get(row, ['comments', 'comment', 'text', 'review', 'Review Text', 'Comments', 'review_text'], '')
  ).trim();

  // externalId typically available in JSON exports; fall back to composed key
  const ext =
    get(row, ['id', 'review_id', 'Review ID', 'external_id', 'reviewId']) ||
    `airbnb:${get(row, ['listing_id', 'Listing ID', 'listingId'], 'unknown')}:${get(row, ['date', 'Date', 'created_at', 'createdAt', 'review_date'], Date.now())}:${text.slice(0, 32).replace(/[^a-zA-Z0-9]/g, '')}`;

  // Normalize reviewer name from multiple possible CSV headers
  const rawName = get(row, [
    'reviewer_name', 'Reviewer Name', 'reviewerName',
    'author', 'Author', 'authorName',
    'guest_name', 'guestName', 'Guest Name',
    'reviewer', 'Reviewer', 'name', 'Name',
    'userName', 'user_name', 'User Name'
  ]);
  
  // Sanitize and normalize the name
  let reviewerName = null;
  if (rawName && typeof rawName === 'string') {
    const trimmed = rawName.trim();
    if (trimmed.length > 0) {
      // Basic sanitization: remove emails, URLs, truncate to 60 chars
      let cleaned = trimmed;
      
      // Remove email domain if present
      if (cleaned.includes('@')) {
        const emailMatch = cleaned.match(/^([^@]+)@/);
        if (emailMatch) {
          cleaned = emailMatch[1].trim();
        } else {
          cleaned = ''; // Invalid email format
        }
      }
      
      // Remove URLs
      cleaned = cleaned.replace(/https?:\/\/[^\s]+/gi, '').trim();
      
      // Remove multiple dots
      cleaned = cleaned.replace(/\.{2,}/g, '').trim();
      
      // Truncate to 60 chars
      if (cleaned.length > 60) {
        cleaned = cleaned.substring(0, 60).trim();
      }
      
      if (cleaned.length > 0) {
        reviewerName = cleaned;
      }
    }
  }
  
  // If no valid name found, set to null (will display as "Guest" in UI)
  if (!reviewerName) {
    reviewerName = null;
  }

  const language = (get(row, ['language', 'Language', 'lang'], 'en') || 'en').toLowerCase();

  // Try parse dates safely
  const createdAtSourceRaw = get(row, ['date', 'Date', 'created_at', 'createdAt', 'review_date', 'reviewDate']);
  let createdAtSource;
  if (createdAtSourceRaw) {
    createdAtSource = new Date(createdAtSourceRaw);
    // If date parsing failed, use current date
    if (isNaN(createdAtSource.getTime())) {
      createdAtSource = new Date();
    }
  } else {
    createdAtSource = new Date();
  }

  // Optional host/owner response:
  const ownerResponseText =
    get(row, ['host_response', 'owner_response', 'Owner Response', 'response', 'host_comment'], '')?.toString().trim();

  // Extract additional authenticity fields
  const reviewerId = get(row, ['reviewer_id', 'reviewerId', 'reviewerID']);
  const reviewHighlight = get(row, ['reviewHighlight', 'review_highlight', 'highlight']);
  const highlightType = get(row, ['highlightType', 'highlight_type']);
  const localizedDate = get(row, ['localizedDate', 'localized_date']);

  const mapped = {
    cabinId,
    externalId: ext.toString(),
    rating: rating,
    text,
    reviewerName,
    reviewerId: reviewerId ? String(reviewerId).trim() : undefined,
    reviewHighlight: reviewHighlight ? String(reviewHighlight).trim() : undefined,
    highlightType: highlightType && ['LENGTH_OF_STAY', 'TYPE_OF_TRIP'].includes(highlightType) ? highlightType : undefined,
    localizedDate: localizedDate ? String(localizedDate).trim() : undefined,
    language,
    status: 'approved',           // import only approved (we're skipping 1★ later)
    pinned: false,
    locked: true,                 // imported reviews are locked
    source: source || 'airbnb',
    createdAtSource,
  };

  if (ownerResponseText) {
    mapped.ownerResponse = {
      text: ownerResponseText,
      respondedBy: 'owner',
      respondedAt: createdAtSource,
    };
  }

  return mapped;
}

/**
 * Recalculate cabin review statistics (same logic as adminReviewRoutes)
 */
async function recalculateCabinStats(cabinId) {
  const stats = await Review.aggregate([
    {
      $match: {
        cabinId: new mongoose.Types.ObjectId(cabinId),
        status: 'approved',
        rating: { $gte: 2 },
        deletedAt: { $exists: false }
      }
    },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        avgRating: { $avg: '$rating' }
      }
    }
  ]);

  const reviewsCount = stats[0]?.count || 0;
  const averageRating = stats[0]?.avgRating || 0;

  await Cabin.findByIdAndUpdate(cabinId, {
    reviewsCount,
    averageRating: Math.round(averageRating * 10) / 10 // Round to 1 decimal
  });
}

(async function main() {
  try {
    const args = parseArgs(process.argv);
    if (!args.file) throw new Error('Missing --file /absolute/or/relative/path');
    if (!args.cabin) throw new Error('Missing --cabin "Bucephalus"');
    const source = args.source || 'airbnb';

    console.log('📦 Review Importer');
    console.log('==================');
    console.log('File:   ', args.file);
    console.log('Cabin:  ', args.cabin);
    console.log('Source: ', source);
    console.log('Mode:   ', args.dryRun ? 'DRY RUN (no changes)' : 'LIVE IMPORT');
    console.log('');

    // DB connect
    const MONGO = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL || 'mongodb://localhost:27017/drift-dwells-booking';
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO, {});
    console.log('✅ MongoDB Connected');

    // Resolve cabin
    console.log(`Looking for cabin: "${args.cabin}"...`);
    const cabin = await Cabin.findOne({ name: args.cabin });
    if (!cabin) {
      throw new Error(`Cabin not found by name: "${args.cabin}". Available cabins: ${(await Cabin.find({}, 'name')).map(c => c.name).join(', ') || 'none'}`);
    }
    const cabinId = cabin._id;
    console.log(`✅ Found cabin: ${cabin.name} (${cabinId})`);

    // Load file
    const filePath = path.resolve(args.file);
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
    
    console.log(`✅ Loaded ${rows.length} rows`);
    console.log('');

    let total = 0, imported = 0, skipped1Star = 0, deduped = 0, errors = 0;
    const errorDetails = [];

    console.log('Processing reviews...');
    for (const row of rows) {
      total++;
      try {
        const candidate = mapRowToReview(row, { cabinId, source });

        // Skip 1★
        if (!(candidate.rating >= 2 && candidate.rating <= 5)) {
          skipped1Star++;
          if (args.dryRun && total <= 5) {
            console.log(`  [SKIP 1★] Rating ${candidate.rating}: ${candidate.text.slice(0, 50)}...`);
          }
          continue;
        }

        // Validate required fields
        if (!candidate.text || candidate.text.trim().length === 0) {
          errors++;
          errorDetails.push(`Row ${total}: Missing review text`);
          continue;
        }

        // Idempotent upsert by externalId + cabin
        if (args.dryRun) {
          // Just count what would happen
          const existing = await Review.findOne({ externalId: candidate.externalId, cabinId });
          if (existing) {
            deduped++;
            if (total <= 5) {
              console.log(`  [DEDUP] ${candidate.externalId} (${candidate.rating}★) - already exists`);
            }
          } else {
            imported++;
            if (total <= 5) {
              console.log(`  [IMPORT] ${candidate.externalId} (${candidate.rating}★) - ${candidate.reviewerName}: "${candidate.text.slice(0, 50)}..."`);
            }
          }
        } else {
          const existing = await Review.findOne({ externalId: candidate.externalId, cabinId });
          if (existing) {
            deduped++;
            // Optional: update status/locked/ownerResponse if empty (but don't overwrite existing)
            // For now, we just skip
            continue;
          }
          
          await Review.create(candidate);
          imported++;
          
          // Log progress every 10 reviews
          if (imported % 10 === 0) {
            process.stdout.write(`\r  Imported: ${imported}...`);
          }
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

    if (!args.dryRun && imported > 0) {
      process.stdout.write('\r'); // Clear progress line
      console.log('Recalculating cabin statistics...');
      await recalculateCabinStats(cabinId);
      console.log('✅ Stats recalculated');
    }

    console.log('');
    console.log('📊 Import Summary');
    console.log('==================');
    console.log('Cabin:         ', args.cabin);
    console.log('Source:        ', source);
    console.log('Total rows:    ', total);
    console.log('✅ Imported:   ', imported);
    console.log('⏭️  Skipped (1★):', skipped1Star);
    console.log('🔄 Deduped:    ', deduped);
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
    console.error('\n❌ Import failed:', err.message);
    if (err.stack && process.env.NODE_ENV === 'development') {
      console.error(err.stack);
    }
    process.exit(1);
  }
})();




