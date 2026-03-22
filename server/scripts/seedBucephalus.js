/**
 * Additive-only script: creates Bucephalus/The Cabin if it doesn't exist.
 * NO deletions. Does not touch Stone House, Lux Cabin, bookings, or any other data.
 *
 * Usage: node server/scripts/seedBucephalus.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');
const Cabin = require('../models/Cabin');

const KEEP_CABIN_NAMES = ['Bucephalus', 'The Cabin'];

const toPublicUrl = (...parts) => `/${parts.map((p) => encodeURIComponent(p)).join('/')}`;

const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/drift-dwells-booking');
  console.log('MongoDB Connected');
};

const listImages = (relativeParts) => {
  const absDir = path.join(__dirname, '..', '..', ...relativeParts);
  try {
    const fs = require('fs');
    const files = fs.readdirSync(absDir).filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
    });
    files.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    return files.map((file, index) => ({
      url: toPublicUrl(...relativeParts, file),
      alt: '',
      sort: index,
      isCover: index === 0
    }));
  } catch {
    return [];
  }
};

const seedBucephalus = async () => {
  try {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_SEED !== '1') {
      console.error('[seed] seedBucephalus refused in production without ALLOW_PRODUCTION_SEED=1');
      process.exit(1);
    }
    await connectDB();

    const existing = await Cabin.findOne({ name: { $in: KEEP_CABIN_NAMES } });
    if (existing) {
      console.log(`✅ Bucephalus/The Cabin already exists (id: ${existing._id}). Nothing to do.`);
      return;
    }

    // Prefer images from The Cabin folder; fallback to video poster
    const cabinImages = listImages(['uploads', 'The Cabin']);
    const posterFallback = '/uploads/Videos/The-cabin-header.winter-poster.jpg';
    const imageUrl = cabinImages.length > 0 ? cabinImages[0].url : posterFallback;
    const images = cabinImages.length > 0
      ? cabinImages
      : [{ url: posterFallback, alt: 'The Cabin exterior', sort: 0, isCover: true }];

    const cabin = await Cabin.create({
      name: 'The Cabin',
      description:
        'Nestled in the rugged folds of the Pirin Mountains, The Cabin is a testament to the beauty of subtraction. Formerly Bucephalus, this is a sanctuary for the over-connected. Off-grid, wood stove, composting toilet, and a wood-fired hot tub.',
      inventoryType: 'single',
      inventoryMode: 'single',
      capacity: 2,
      minGuests: 1,
      pricePerNight: 55,
      pricingModel: 'per_night',
      minNights: 2,
      imageUrl,
      images,
      location: 'Near Bachevo, Pirin Mountains, Bulgaria',
      amenities: [
        'Queen bed',
        'Wood stove',
        'Gas heater',
        'Wood-fired hot tub',
        'Composting toilet',
        'Basic kitchen (gas, BBQ)',
        'Firewood included',
        'Bed linen and towels'
      ],
      transportOptions: [],
      isActive: true
    });

    console.log(`✅ Created The Cabin (id: ${cabin._id}). No data was deleted.`);
  } catch (error) {
    console.error('Seed error:', error);
    throw error;
  } finally {
    await mongoose.connection.close();
  }
};

if (require.main === module) {
  seedBucephalus();
}

module.exports = seedBucephalus;
