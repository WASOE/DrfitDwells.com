require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const Booking = require('../models/Booking');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/drift-dwells-booking');
    console.log('MongoDB Connected for seeding');
  } catch (error) {
    console.error('Database connection error:', error);
    process.exit(1);
  }
};

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const KEEP_CABIN_NAMES = ['Bucephalus', 'The Cabin'];

const toPublicUrl = (...parts) => `/${parts.map((part) => encodeURIComponent(part)).join('/')}`;

const listImages = (relativeParts) => {
  const absDir = path.join(__dirname, '..', '..', ...relativeParts);
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
};

const ensureImages = (label, images) => {
  if (!images.length) {
    throw new Error(`No images found for ${label}. Check uploads path and filenames.`);
  }
};

const buildUnits = (count) => (
  Array.from({ length: count }, (_, idx) => {
    const number = String(idx + 1).padStart(2, '0');
    return {
      unitNumber: `AF-${number}`,
      displayName: `A-Frame ${number}`,
      isActive: true
    };
  })
);

const seedDatabase = async () => {
  try {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_SEED !== '1') {
      console.error('[seed] Refused: NODE_ENV=production. Set ALLOW_PRODUCTION_SEED=1 only on intentional maintenance.');
      process.exit(1);
    }
    await connectDB();

    const keepCabins = await Cabin.find({ name: { $in: KEEP_CABIN_NAMES } });
    const keepCabinIds = keepCabins.map((cabin) => cabin._id);

    // Update Bucephalus/The Cabin pricing (€55/night, min 2 nights)
    await Cabin.updateMany(
      { name: { $in: KEEP_CABIN_NAMES } },
      { $set: { pricePerNight: 55, minNights: 2 } }
    );

    // Ensure the kept "The Cabin" carries Bulgarian content (parity with
    // scripts/backfillCabinI18nBg.cjs). Only fills missing/empty fields so
    // ops-edited translations are never clobbered by a reseed.
    const theCabinBg = {
      name: 'Къщата',
      location: 'Пирин планина, край Бачево',
      description:
        'Скътана в суровите гънки на Пирин, Къщата е доказателство за красотата на изваждането. Позната преди като „Буцефал“, тя е убежище за свръхсвързаните. Офгрид, с печка на дърва, компостна тоалетна и джакузи, подгрявано на дърва.'
    };
    for (const [field, value] of Object.entries(theCabinBg)) {
      await Cabin.updateMany(
        {
          name: 'The Cabin',
          $or: [
            { [`i18n.bg.${field}`]: { $exists: false } },
            { [`i18n.bg.${field}`]: '' }
          ]
        },
        { $set: { [`i18n.bg.${field}`]: value } }
      );
    }

    await Booking.deleteMany({
      $or: [
        { cabinTypeId: { $ne: null } },
        ...(keepCabinIds.length
          ? [{ cabinId: { $nin: keepCabinIds } }]
          : [{ cabinId: { $exists: true } }])
      ]
    });

    await Cabin.deleteMany({ name: { $nin: KEEP_CABIN_NAMES } });
    await CabinType.deleteMany({});
    await Unit.deleteMany({});

    const aFrameImages = listImages(['uploads', 'The Valley', 'A frames']);
    const stoneHouseImages = listImages(['uploads', 'The Valley', 'Stone House']);
    const luxCabinImages = listImages(['uploads', 'The Valley', 'Lux Cabin']);

    ensureImages('A-Frames', aFrameImages);
    ensureImages('Stone House', stoneHouseImages);
    ensureImages('Lux Cabin', luxCabinImages);

    const aFrameType = await CabinType.create({
      name: 'A-Frame',
      slug: 'a-frame',
      description:
        'Off-grid A-frame cabins in a hidden mountain valley below Ortsevo, the highest inhabited village in the Balkans. Designed for quiet stays, nature immersion, and switching off. Simple, warm, and private, with shared facilities in the heart of the valley.',
      i18n: {
        bg: {
          name: 'А-фрейм',
          location: 'Черешово / Орцево, Родопите, България',
          description:
            'Офгрид А-фрейм къщички в скрита планинска долина под Орцево — най-високото обитаемо село на Балканите. Създадени за тихи престои, потапяне в природата и изключване от ежедневието. Семпли, топли и уединени, с общи съоръжения в сърцето на долината.'
        }
      },
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
      imageUrl: aFrameImages[0].url,
      images: aFrameImages,
      isActive: true
    });

    const units = buildUnits(13).map((unit) => ({
      ...unit,
      cabinTypeId: aFrameType._id
    }));
    await Unit.insertMany(units);

    const cabins = await Cabin.insertMany([
      {
        name: 'Stone House',
        description:
          'A restored 400-year-old stone house at the center of the valley, surrounded by forest, water, and open meadow. Features a 360-degree balcony, shared kitchen, outdoor bathrooms, and communal spaces for groups, families, or retreats.',
        i18n: {
          bg: {
            name: 'Каменна къща',
            location: 'Черешово / Орцево, Родопите, България',
            description:
              'Реставрирана 400-годишна каменна къща в центъра на долината, заобиколена от гора, вода и открити поляни. Разполага с панорамен балкон на 360 градуса, обща кухня, външни бани и общи пространства за групи, семейства или ритрийти.'
          }
        },
        capacity: 6,
        minGuests: 3,
        pricePerNight: 25,
        pricingModel: 'per_person',
        minNights: 2,
        location: 'Chereshovo / Ortsevo, Rhodope Mountains, Bulgaria',
        amenities: [
          'Multiple sleeping areas',
          'Fireplace',
          'Shared rustic kitchen',
          'Shared outdoor showers',
          'Shared toilets',
          'Large panoramic balcony',
          'Fire pit',
          'Electricity (solar, limited)',
          'Starlink internet',
          'Bed linen and towels',
          'Valley and mountain views'
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
        imageUrl: stoneHouseImages[0].url,
        images: stoneHouseImages,
        isActive: true
      },
      {
        name: 'Lux Cabin',
        description:
          'A fully private off-grid cabin with its own kitchen, bathroom, and floor-to-ceiling windows overlooking the forest and creek. Built for couples who want real comfort in nature — spacious, warm, and completely self-contained, with running water right beside the cabin.',
        i18n: {
          bg: {
            name: 'Лукс къща',
            location: 'Черешово / Орцево, Родопите, България',
            description:
              'Напълно самостоятелна офгрид къща със собствена кухня, баня и панорамни прозорци от пода до тавана с изглед към гората и потока. Създадена за двойки, които търсят истински комфорт сред природата — просторна, топла и изцяло независима, с течаща вода непосредствено до къщата.'
          }
        },
        capacity: 2,
        minGuests: 1,
        pricePerNight: 85,
        pricingModel: 'per_night',
        minNights: 2,
        location: 'Chereshovo / Ortsevo, Rhodope Mountains, Bulgaria',
        amenities: [
          'Double bed',
          'Private bathroom with hot shower',
          'Private fully equipped kitchen',
          'Floor-to-ceiling windows',
          'Creek-side location',
          'Wood stove',
          'Electricity (solar)',
          'Private terrace',
          'Mountain and forest view',
          'Bed linen and towels',
          'Fire pit access',
          'Starlink internet'
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
            duration: '2 km (from Chereshovo 20 to 30 min)',
            isAvailable: true
          }
        ],
        imageUrl: luxCabinImages[0].url,
        images: luxCabinImages,
        isActive: true
      }
    ]);

    console.log('✅ Database seeded successfully!');
    console.log(`- Kept cabins: ${keepCabins.length}`);
    console.log(`- Cabin types created: 1 (A-Frame)`);
    console.log(`- Units created: ${units.length}`);
    console.log(`- Cabins created: ${cabins.length}`);
  } catch (error) {
    console.error('Seeding error:', error);
  } finally {
    mongoose.connection.close();
  }
};

if (require.main === module) {
  seedDatabase();
}

module.exports = seedDatabase;
