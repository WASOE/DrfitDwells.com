/**
 * Restores images and metadata for The Cabin (Bucephalus) from the existing
 * uploads/cabins/68b83f3dadecaa65dbbe560f/ folder. NO deletions.
 *
 * Images: Attaches the 57 existing cabin images to the current The Cabin record.
 * Reviews: Use importReviews.js with your JSON/CSV export:
 *   node server/scripts/importReviews.js --file /path/to/reviews.json --cabin "The Cabin"
 *
 * Usage: node server/scripts/restoreBucephalusData.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Cabin = require('../models/Cabin');

const OLD_CABIN_IMAGES_DIR = path.join(__dirname, '..', '..', 'uploads', 'cabins', '68b83f3dadecaa65dbbe560f', 'original');

const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/drift-dwells-booking');
  console.log('MongoDB Connected');
};

async function restoreBucephalusData() {
  try {
    await connectDB();

    const cabin = await Cabin.findOne({ name: { $in: ['The Cabin', 'Bucephalus'] } });
    if (!cabin) {
      console.error('The Cabin not found. Run seedBucephalus.js first.');
      process.exit(1);
    }

    if (!fs.existsSync(OLD_CABIN_IMAGES_DIR)) {
      console.error(`Images folder not found: ${OLD_CABIN_IMAGES_DIR}`);
      process.exit(1);
    }

    const files = fs.readdirSync(OLD_CABIN_IMAGES_DIR).filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
    });
    files.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

    if (files.length === 0) {
      console.error('No image files found in', OLD_CABIN_IMAGES_DIR);
      process.exit(1);
    }

    // Build images array - paths use the OLD cabin ID (files exist there)
    const images = files.map((f, i) => ({
      _id: new mongoose.Types.ObjectId().toString(),
      url: `/uploads/cabins/68b83f3dadecaa65dbbe560f/original/${f}`,
      alt: '',
      sort: i,
      isCover: i === 0
    }));

    const imageUrl = images[0].url;

    await Cabin.findByIdAndUpdate(cabin._id, {
      images,
      imageUrl
    });

    console.log(`✅ Restored ${images.length} images to The Cabin (${cabin._id})`);
    console.log('');
    console.log('Reviews: To import reviews, run:');
    console.log('  node server/scripts/importReviews.js --file /path/to/reviews.json --cabin "The Cabin"');
    console.log('  (or --cabin "Bucephalus" if your export uses that name)');
    console.log('  Supports JSON array or CSV with columns: rating, comments, reviewer_name, date, etc.');
  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    await mongoose.connection.close();
  }
}

if (require.main === module) {
  restoreBucephalusData();
}

module.exports = restoreBucephalusData;
