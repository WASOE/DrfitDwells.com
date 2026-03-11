#!/usr/bin/env node
/**
 * Process Airbnb reviews: keep 5-star, convert 4-star to 5-star.
 * Outputs JSON ready for importReviews.js
 *
 * GET YOUR DATA FIRST (we cannot scrape Airbnb):
 * 1. Airbnb official: Account → Privacy & sharing → Request your personal data (JSON)
 *    Unzip → use JSON/reviews.json
 * 2. Chrome extension: "Airbnb Review Exporter" (search Chrome Web Store)
 * 3. Apify: apify.com/automation-lab/airbnb-reviews (paste listing URL)
 *
 * Usage:
 *   node scripts/processAirbnbReviews.js --file /path/to/reviews.json [--listing 797914705574649299]
 *   node scripts/processAirbnbReviews.js --file /path/to/reviews.json --out processed.json
 *
 * Then import:
 *   node scripts/importReviews.js --file processed.json --cabin "The Cabin"
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--file' && i + 1 < argv.length) args.file = argv[++i];
    else if (argv[i] === '--out' && i + 1 < argv.length) args.out = argv[++i];
    else if (argv[i] === '--listing' && i + 1 < argv.length) args.listing = argv[++i];
  }
  return args;
}

function get(obj, keys, fallback) {
  for (const k of [].concat(keys)) {
    if (obj && obj[k] != null && obj[k] !== '') return obj[k];
  }
  return fallback;
}

function loadJSON(p) {
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

function loadCSV(p) {
  const raw = fs.readFileSync(p, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    const row = {};
    header.forEach((h, idx) => { row[h] = values[idx] || ''; });
    rows.push(row);
  }
  return rows;
}

function extractReviews(data, listingId) {
  let rows = [];
  if (Array.isArray(data)) {
    rows = data;
  } else if (data && Array.isArray(data.items)) {
    rows = data.items; // Apify dataset format
  } else if (data && Array.isArray(data.reviews)) {
    rows = data.reviews;
  } else if (data && typeof data === 'object') {
    const key = Object.keys(data).find((k) => k.toLowerCase().includes('review') || k === 'items');
    rows = key ? (Array.isArray(data[key]) ? data[key] : [data[key]]) : [];
  }
  if (listingId) {
    rows = rows.filter((r) => {
      const lid = get(r, ['listing_id', 'listingId', 'listingID', 'listing'], '');
      return !lid || String(lid) === String(listingId);
    });
  }
  return rows;
}

function processRow(row) {
  const ratingRaw = get(row, ['rating', 'Rating', 'stars', 'Stars', 'star_rating', 'overall_rating'], 0);
  let rating = Number(ratingRaw);
  if (rating === 4) rating = 5;

  const text = String(get(row, ['text', 'comments', 'comment', 'review', 'Review Text', 'review_text', 'content'], '')).trim();
  const reviewerName = get(row, ['reviewerName', 'reviewer_name', 'author', 'guest_name', 'reviewer', 'name'], null);
  const date = get(row, ['createdAt', 'created_at', 'date', 'Date', 'review_date', 'reviewDate']);
  const reviewId = get(row, ['reviewId', 'review_id', 'id', 'external_id']);

  return { rating, text, reviewerName, date, reviewId, row };
}

(async function main() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    console.error('Usage: node processAirbnbReviews.js --file /path/to/reviews.json [--listing 797914705574649299] [--out processed.json]');
    process.exit(1);
  }

  const filePath = path.resolve(args.file);
  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(1);
  }

  console.log('Reading', filePath, '...');
  let data;
  const ext = path.extname(filePath).toLowerCase();
  try {
    data = ext === '.csv' ? loadCSV(filePath) : loadJSON(filePath);
  } catch (e) {
    console.error('Parse error:', e.message);
    process.exit(1);
  }

  const rows = extractReviews(data, args.listing);
  console.log('Found', rows.length, 'review(s)');

  const processed = [];
  let fourToFive = 0;
  for (const row of rows) {
    const { rating, text, reviewerName, date, reviewId, row: orig } = processRow(row);
    if (rating < 4 || !text) continue;
    if (Number(get(orig, ['rating', 'Rating', 'stars', 'star_rating'], 0)) === 4) fourToFive++;
    processed.push({
      rating: 5,
      comments: text,
      reviewer_name: reviewerName || 'Guest',
      date: date || new Date().toISOString().slice(0, 10),
      id: reviewId || get(orig, ['id', 'review_id', 'reviewId']) || `airbnb-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    });
  }

  console.log('Kept', processed.length, 'reviews (4★ and 5★ → all 5★)');
  console.log('Converted 4★ to 5★:', fourToFive);

  const outPath = args.out ? path.resolve(args.out) : path.join(path.dirname(filePath), 'reviews-processed.json');
  fs.writeFileSync(outPath, JSON.stringify(processed, null, 2), 'utf8');
  console.log('Wrote', outPath);
  console.log('');
  console.log('Import into DB:');
  console.log('  node scripts/importReviews.js --file', outPath, '--cabin "The Cabin"');
})();
