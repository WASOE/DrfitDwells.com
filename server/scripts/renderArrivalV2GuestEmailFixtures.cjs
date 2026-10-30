'use strict';

/**
 * Renders Arrival V2 confirmation + arrival HTML/text fixtures for owner inspection.
 * No SMTP. Writes under server/.scratch/arrival-v2-email-fixtures/
 */

const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const { composeArrivalGuestEmail } = require('../services/messaging/arrival/arrivalEmailComposer');
const { VALLEY, CABIN } = require('../services/messaging/arrival/arrivalPropertyFacts');

const OUT = path.join(__dirname, '../.scratch/arrival-v2-email-fixtures');

async function insert(doc, Model) {
  const _id = new mongoose.Types.ObjectId();
  await Model.collection.insertOne({ _id, ...doc });
  return _id;
}

async function bookingFor({ cabinId, cabinTypeId, unitId, firstName = 'Ada' }) {
  const _id = new mongoose.Types.ObjectId();
  const checkIn = new Date('2026-11-20T00:00:00+02:00');
  const checkOut = new Date('2026-11-22T00:00:00+02:00');
  await Booking.collection.insertOne({
    _id,
    cabinId: cabinId || null,
    cabinTypeId: cabinTypeId || null,
    unitId: unitId || null,
    status: 'confirmed',
    paymentStatus: 'paid',
    checkIn,
    checkOut,
    totalPrice: 240,
    guestInfo: {
      firstName,
      lastName: 'Lovelace',
      email: 'fixture.arrival.v2@example.com',
      phone: '+359888000111'
    }
  });
  return Booking.findById(_id).lean();
}

function writeFixture(name, composed) {
  fs.writeFileSync(path.join(OUT, `${name}.subject.txt`), composed.subject + '\n');
  fs.writeFileSync(path.join(OUT, `${name}.html`), composed.html);
  fs.writeFileSync(path.join(OUT, `${name}.txt`), composed.text);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  const luxId = await insert(
    {
      propertyKind: 'valley',
      name: 'Lux Cabin',
      slug: 'lux-cabin',
      location: 'The Valley',
      meetingPoint: { label: VALLEY.parkingLabel, googleMapsUrl: VALLEY.parkingNavigateUrl },
      arrivalGuideUrl: '/guides/the-valley'
    },
    Cabin
  );
  const stoneId = await insert(
    {
      propertyKind: 'valley',
      name: 'Stone House',
      slug: 'stone-house',
      location: 'The Valley',
      meetingPoint: { label: VALLEY.parkingLabel, googleMapsUrl: VALLEY.parkingNavigateUrl },
      arrivalGuideUrl: '/guides/the-valley'
    },
    Cabin
  );
  const cabinId = await insert(
    {
      propertyKind: 'cabin',
      name: 'The Cabin',
      slug: 'the-cabin',
      location: 'Bachevo',
      meetingPoint: { label: 'Park and walk', googleMapsUrl: CABIN.parkAndWalkNavigateUrl },
      arrivalGuideUrl: '/guides/the-cabin'
    },
    Cabin
  );
  const aframeTypeId = await insert(
    {
      propertyKind: 'valley',
      name: 'A-Frame',
      slug: 'a-frame',
      arrivalGuideUrl: '/guides/the-valley'
    },
    CabinType
  );
  const unitId = await insert(
    { cabinTypeId: aframeTypeId, displayName: 'A-Frame 2', unitNumber: '2', status: 'active' },
    Unit
  );

  const cases = [
    ['valley-aframe-confirmation', await bookingFor({ cabinTypeId: aframeTypeId, unitId }), 'confirmation'],
    ['valley-aframe-arrival', await bookingFor({ cabinTypeId: aframeTypeId, unitId }), 'arrival'],
    ['valley-lux-confirmation', await bookingFor({ cabinId: luxId }), 'confirmation'],
    ['valley-lux-arrival', await bookingFor({ cabinId: luxId }), 'arrival'],
    ['valley-stone-confirmation', await bookingFor({ cabinId: stoneId }), 'confirmation'],
    ['valley-stone-arrival', await bookingFor({ cabinId: stoneId }), 'arrival'],
    ['cabin-confirmation', await bookingFor({ cabinId }), 'confirmation'],
    ['cabin-arrival', await bookingFor({ cabinId }), 'arrival']
  ];

  const index = [];
  for (const [name, booking, purpose] of cases) {
    const composed = await composeArrivalGuestEmail({ booking, purpose });
    if (!composed.ok) throw new Error(`${name}: ${composed.message}`);
    writeFixture(name, composed);
    index.push({
      name,
      purpose,
      propertyKind: composed.propertyKind,
      propertyName: composed.propertyName,
      valleyStayFamily: composed.valleyStayFamily,
      checkoutTime: composed.checkoutTime,
      subject: composed.subject
    });
  }

  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2));
  console.log(JSON.stringify({ ok: true, outDir: OUT, fixtures: index }, null, 2));

  await mongoose.disconnect();
  await mongo.stop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
