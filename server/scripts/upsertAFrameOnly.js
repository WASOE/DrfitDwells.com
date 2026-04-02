/**
 * Idempotent A-Frame-only data sync (MongoDB).
 *
 * - Does NOT delete or update unrelated documents.
 * - CabinType: inserts full defaults only when no document with slug `a-frame` exists.
 *   If it already exists, the script leaves it unchanged (no overwrite of copy, pricing, images).
 * - Units: upserts AF-01 … AF-n for that type via $setOnInsert only (existing unit rows are not modified).
 *
 * Usage (from repo root or server/ — set MONGODB_URI):
 *   cd server && node scripts/upsertAFrameOnly.js
 *   cd server && node scripts/upsertAFrameOnly.js --dry-run
 *   cd server && node scripts/upsertAFrameOnly.js --unit-count 13
 *
 * Production: requires explicit opt-in (in addition to MONGODB_URI):
 *   ALLOW_PRODUCTION_AFRAME_UPSERT=1
 *
 * Optional: copy minimal admin-list Cabin stub (inventoryType multi) — off by default:
 *   node scripts/upsertAFrameOnly.js --ensure-multi-cabin
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const Cabin = require('../models/Cabin');

const SLUG = 'a-frame';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  let unitCount = 13;
  const ucIdx = argv.indexOf('--unit-count');
  if (ucIdx !== -1 && argv[ucIdx + 1]) {
    const n = parseInt(argv[ucIdx + 1], 10);
    if (Number.isFinite(n) && n >= 1 && n <= 50) unitCount = n;
  }
  const ensureMultiCabin = argv.includes('--ensure-multi-cabin');
  return { dryRun, unitCount, ensureMultiCabin };
}

const toPublicUrl = (...parts) => `/${parts.map((part) => encodeURIComponent(part)).join('/')}`;

function listAFrameImagesFromRepo() {
  const relativeParts = ['uploads', 'The Valley', 'A frames'];
  const absDir = path.join(__dirname, '..', '..', ...relativeParts);
  if (!fs.existsSync(absDir)) {
    return null;
  }
  const files = fs.readdirSync(absDir).filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
  });
  files.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  return files.map((file, index) => ({
    url: toPublicUrl(...relativeParts, file),
    alt: '',
    sort: index,
    isCover: index === 0
  }));
}

function buildUnits(count) {
  return Array.from({ length: count }, (_, idx) => {
    const number = String(idx + 1).padStart(2, '0');
    return {
      unitNumber: `AF-${number}`,
      displayName: `A-Frame ${number}`,
      isActive: true
    };
  });
}

function buildAFrameCabinTypePayload(images) {
  if (!images || !images.length) {
    throw new Error(
      'No A-frame images found. Run from repo with uploads/The Valley/A frames, or set AFRAME_IMAGE_URL to a single /uploads/... or https://... image and set AFRAME_IMAGES_JSON to a JSON array of {url,alt,sort,isCover}.'
    );
  }

  return {
    name: 'A-Frame',
    slug: SLUG,
    description:
      'Off-grid A-frame cabins in a hidden mountain valley below Ortsevo, the highest inhabited village in the Balkans. Designed for quiet stays, nature immersion, and switching off. Simple, warm, and private, with shared facilities in the heart of the valley.',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 60,
    pricingModel: 'per_night',
    minNights: 2,
    location: 'Chereshovo / Ortsevo, Rhodope Mountains, Bulgaria',
    amenities: [
      'Double bed',
      'Wood stove',
      'Private terrace',
      'Electricity (solar, limited)',
      'Mountain and meadow view',
      'Bed linen and towels',
      'Shared rustic kitchen',
      'Shared outdoor showers',
      'Shared toilets',
      'Fire pit',
      'Starlink internet in communal area'
    ],
    transportOptions: [
      {
        type: 'Jeep',
        pricePerPerson: 25,
        description: '4x4 transfer from Chereshovo to the Valley',
        duration: '25 minutes',
        isAvailable: true
      },
      {
        type: 'Horse',
        pricePerPerson: 40,
        description: 'Guided horse ride into the Valley',
        duration: '90 minutes',
        isAvailable: true
      },
      {
        type: 'Hike',
        pricePerPerson: 0,
        description: 'Marked hiking route to the Valley',
        duration: '2.5 hours',
        isAvailable: true
      }
    ],
    imageUrl: images[0].url,
    images,
    isActive: true
  };
}

function resolveImages() {
  const fromEnvUrl = process.env.AFRAME_IMAGE_URL && String(process.env.AFRAME_IMAGE_URL).trim();
  const fromEnvJson = process.env.AFRAME_IMAGES_JSON && String(process.env.AFRAME_IMAGES_JSON).trim();

  if (fromEnvJson) {
    const parsed = JSON.parse(fromEnvJson);
    if (!Array.isArray(parsed) || !parsed.length) {
      throw new Error('AFRAME_IMAGES_JSON must be a non-empty JSON array');
    }
    return parsed;
  }

  const fromDisk = listAFrameImagesFromRepo();
  if (fromDisk && fromDisk.length) {
    return fromDisk;
  }

  if (fromEnvUrl) {
    return [
      {
        url: fromEnvUrl,
        alt: 'A-Frame',
        sort: 0,
        isCover: true
      }
    ];
  }

  return null;
}

async function ensureMultiInventoryCabin(cabinType, dryRun) {
  const existing = await Cabin.findOne({
    cabinTypeId: cabinType._id,
    $or: [{ inventoryType: 'multi' }, { inventoryMode: 'multi' }]
  }).lean();

  if (existing) {
    console.log(`[a-frame-upsert] Multi Cabin already linked (cabin _id ${existing._id}). Skipping.`);
    return;
  }

  const doc = {
    name: cabinType.name,
    description: cabinType.description,
    inventoryType: 'multi',
    inventoryMode: 'multi',
    cabinTypeId: cabinType._id,
    capacity: cabinType.capacity,
    minGuests: cabinType.minGuests || 1,
    pricePerNight: cabinType.pricePerNight,
    pricingModel: cabinType.pricingModel || 'per_night',
    minNights: cabinType.minNights || 1,
    imageUrl: cabinType.imageUrl,
    images: cabinType.images || [],
    location: cabinType.location,
    amenities: cabinType.amenities || [],
    transportOptions: cabinType.transportOptions || [],
    isActive: cabinType.isActive !== false
  };

  if (dryRun) {
    console.log('[a-frame-upsert] DRY-RUN: would create multi-inventory Cabin linked to type', cabinType._id);
    return;
  }

  const created = await Cabin.create(doc);
  console.log(`[a-frame-upsert] Created multi-inventory Cabin ${created._id} for admin /api/admin/cabins list.`);
}

async function main() {
  const { dryRun, unitCount, ensureMultiCabin } = parseArgs(process.argv.slice(2));

  if (process.env.NODE_ENV === 'production') {
    const ok = process.env.ALLOW_PRODUCTION_AFRAME_UPSERT === '1';
    if (!ok) {
      console.error(
        '[a-frame-upsert] Refused: NODE_ENV=production. Set ALLOW_PRODUCTION_AFRAME_UPSERT=1 for intentional production upsert.'
      );
      process.exit(1);
    }
  }

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri || !String(uri).trim()) {
    console.error('[a-frame-upsert] MONGODB_URI (or MONGO_URI) is required.');
    process.exit(1);
  }

  let images;
  try {
    images = resolveImages();
  } catch (e) {
    console.error('[a-frame-upsert]', e.message);
    process.exit(1);
  }

  console.log(`[a-frame-upsert] Connecting… dryRun=${dryRun} unitCount=${unitCount}`);
  await mongoose.connect(uri);

  let cabinType = await CabinType.findOne({ slug: SLUG });

  if (!cabinType) {
    const payload = buildAFrameCabinTypePayload(images);
    console.log('[a-frame-upsert] No CabinType with slug a-frame — will insert.');
    if (dryRun) {
      console.log('[a-frame-upsert] DRY-RUN: would CabinType.create(...)', { name: payload.name, slug: payload.slug });
      console.log(`[a-frame-upsert] DRY-RUN: would upsert ${unitCount} units (AF-01 …)`);
      if (ensureMultiCabin) {
        console.log('[a-frame-upsert] DRY-RUN: would --ensure-multi-cabin (Cabin row for /admin/cabins)');
      }
      await mongoose.disconnect();
      console.log('[a-frame-upsert] Done.');
      return;
    }
    cabinType = await CabinType.create(payload);
    console.log(`[a-frame-upsert] Created CabinType _id=${cabinType._id}`);
  } else {
    console.log(`[a-frame-upsert] CabinType already exists _id=${cabinType._id} — leaving fields unchanged.`);
  }

  const typeId = cabinType._id;

  const units = buildUnits(unitCount);
  for (const u of units) {
    if (dryRun) {
      const exists = await Unit.findOne({ cabinTypeId: typeId, unitNumber: u.unitNumber }).lean();
      if (!exists) {
        console.log(`[a-frame-upsert] DRY-RUN: would upsert unit ${u.unitNumber}`);
      }
      continue;
    }
    const res = await Unit.updateOne(
      { cabinTypeId: typeId, unitNumber: u.unitNumber },
      {
        $setOnInsert: {
          cabinTypeId: typeId,
          unitNumber: u.unitNumber,
          displayName: u.displayName,
          isActive: true
        }
      },
      { upsert: true }
    );
    if (res.upsertedCount) {
      console.log(`[a-frame-upsert] Inserted unit ${u.unitNumber}`);
    }
  }

  if (!dryRun) {
    const total = await Unit.countDocuments({ cabinTypeId: typeId });
    console.log(`[a-frame-upsert] Units for this type in DB: ${total}`);
  }

  if (ensureMultiCabin) {
    const freshType = dryRun ? await CabinType.findById(typeId).lean() : await CabinType.findById(typeId);
    if (freshType) {
      await ensureMultiInventoryCabin(freshType, dryRun);
    }
  }

  await mongoose.disconnect();
  console.log('[a-frame-upsert] Done.');
}

main().catch((err) => {
  console.error('[a-frame-upsert] Fatal:', err);
  process.exit(1);
});
