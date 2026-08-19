/**
 * Dashboard external_hold (Airbnb iCal) operational lanes.
 * Run: cd server && node --test scripts/dashboardExternalHolds.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const Booking = require('../models/Booking');
const AvailabilityBlock = require('../models/AvailabilityBlock');
require('../models/Unit');
require('../models/CabinType');
const { getDashboardReadModel } = require('../services/ops/readModels/dashboardReadModel');
const { normalizeDateToSofiaDayStart } = require('../utils/dateTime');

let mongoServer;

function sofiaToday() {
  return normalizeDateToSofiaDayStart(new Date());
}

function addSofiaDays(base, days) {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return normalizeDateToSofiaDayStart(d);
}

async function createCabin(nameSuffix) {
  return Cabin.create({
    name: `Dashboard Hold Cabin ${nameSuffix}`,
    description: 'Dashboard external hold test cabin',
    capacity: 2,
    pricePerNight: 120,
    minNights: 1,
    imageUrl: 'https://example.com/dashboard-hold.jpg',
    location: 'Bulgaria',
    geoLocation: { latitude: 42.6977, longitude: 23.3219 }
  });
}

async function createExternalHold({ cabinId, startDate, endDate, status = 'active', unitId = null }) {
  return AvailabilityBlock.create({
    cabinId,
    unitId,
    blockType: 'external_hold',
    source: 'airbnb_ical',
    startDate,
    endDate,
    status,
    sourceReference: `airbnb_ical:uid:dashboard-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  });
}

async function createArrivingBooking({ cabinId, email, checkIn, checkOut }) {
  const today = sofiaToday();
  const resolvedCheckIn = checkIn || today;
  const resolvedCheckOut = checkOut || addSofiaDays(resolvedCheckIn, 2);
  return Booking.create({
    cabinId,
    checkIn: resolvedCheckIn,
    checkOut: resolvedCheckOut,
    adults: 2,
    children: 0,
    status: 'confirmed',
    isProductionSafe: false,
    guestInfo: {
      firstName: 'Direct',
      lastName: 'Guest',
      email,
      phone: '+359123456789'
    },
    totalPrice: 200,
    tripType: 'retreat',
    romanticSetup: false
  });
}

function rowIds(rows) {
  return rows.map((row) => row.reservationId);
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    AvailabilityBlock.deleteMany({}),
    Booking.deleteMany({}),
    Cabin.deleteMany({})
  ]);
});

test('1. external hold starting today appears in Arriving today', async () => {
  const cabin = await createCabin('arriving');
  const today = sofiaToday();
  const hold = await createExternalHold({
    cabinId: cabin._id,
    startDate: today,
    endDate: addSofiaDays(today, 3)
  });

  const dashboard = await getDashboardReadModel();
  const rows = dashboard.dashboard.today.arriving.rows;

  assert.ok(rowIds(rows).includes(String(hold._id)));
  const row = rows.find((r) => r.reservationId === String(hold._id));
  assert.equal(row.kind, 'external_hold');
  assert.equal(row.guestName, 'Airbnb hold');
  assert.equal(row.channel, 'airbnb');
  assert.ok(!row.href);
});

test('2. external hold spanning today appears in Staying now', async () => {
  const cabin = await createCabin('staying');
  const today = sofiaToday();
  const hold = await createExternalHold({
    cabinId: cabin._id,
    startDate: addSofiaDays(today, -2),
    endDate: addSofiaDays(today, 2)
  });

  const dashboard = await getDashboardReadModel();
  const rows = dashboard.dashboard.today.staying.rows;

  assert.ok(rowIds(rows).includes(String(hold._id)));
});

test('3. external hold whose exclusive endDate is today appears in Leaving today', async () => {
  const cabin = await createCabin('leaving');
  const today = sofiaToday();
  const hold = await createExternalHold({
    cabinId: cabin._id,
    startDate: addSofiaDays(today, -3),
    endDate: today
  });

  const dashboard = await getDashboardReadModel();
  const rows = dashboard.dashboard.today.leaving.rows;

  assert.ok(rowIds(rows).includes(String(hold._id)));
});

test('4. future external hold appears in Upcoming operations', async () => {
  const cabin = await createCabin('upcoming');
  const today = sofiaToday();
  const hold = await createExternalHold({
    cabinId: cabin._id,
    startDate: addSofiaDays(today, 5),
    endDate: addSofiaDays(today, 8)
  });

  const dashboard = await getDashboardReadModel();
  const rows = dashboard.dashboard.upcoming.nextArrivals;

  assert.ok(rowIds(rows).includes(String(hold._id)));
  const row = rows.find((r) => r.reservationId === String(hold._id));
  assert.match(row.statusLabel, /^Starts in \d+ day/);
  assert.ok(!/arriv/i.test(row.statusLabel));
});

test('5. tombstoned hold does not appear in operational lanes', async () => {
  const cabin = await createCabin('tombstone');
  const today = sofiaToday();
  const hold = await createExternalHold({
    cabinId: cabin._id,
    startDate: today,
    endDate: addSofiaDays(today, 2),
    status: 'tombstoned'
  });

  const dashboard = await getDashboardReadModel();
  const allRows = [
    ...dashboard.dashboard.today.arriving.rows,
    ...dashboard.dashboard.today.staying.rows,
    ...dashboard.dashboard.today.leaving.rows,
    ...dashboard.dashboard.upcoming.nextArrivals
  ];

  assert.ok(!rowIds(allRows).includes(String(hold._id)));
});

test('6. Booking and external hold on the same date both appear in Arriving today', async () => {
  const cabin = await createCabin('overlap');
  const today = sofiaToday();
  const email = `dashboard-hold-overlap-${Date.now()}@example.com`;
  const [booking, hold] = await Promise.all([
    createArrivingBooking({ cabinId: cabin._id, email }),
    createExternalHold({
      cabinId: cabin._id,
      startDate: today,
      endDate: addSofiaDays(today, 2)
    })
  ]);

  const dashboard = await getDashboardReadModel();
  const rows = dashboard.dashboard.today.arriving.rows;
  const ids = rowIds(rows);

  assert.ok(ids.includes(String(booking._id)));
  assert.ok(ids.includes(String(hold._id)));
  assert.equal(rows.filter((r) => r.kind === 'external_hold').length, 1);
  assert.equal(rows.filter((r) => r.kind !== 'external_hold').length, 1);
});

test('7. exclusive endDate tomorrow keeps hold in Staying now, not Leaving today', async () => {
  const cabin = await createCabin('checkout-tomorrow');
  const today = sofiaToday();
  const hold = await createExternalHold({
    cabinId: cabin._id,
    startDate: addSofiaDays(today, -3),
    endDate: addSofiaDays(today, 1)
  });

  const dashboard = await getDashboardReadModel();
  const stayingIds = rowIds(dashboard.dashboard.today.staying.rows);
  const leavingIds = rowIds(dashboard.dashboard.today.leaving.rows);

  assert.ok(stayingIds.includes(String(hold._id)));
  assert.ok(!leavingIds.includes(String(hold._id)));
});

test('7b. exclusive endDate today places hold in Leaving today (Aug 19–22 leaves on checkout day)', async () => {
  const cabin = await createCabin('checkout-today');
  const today = sofiaToday();
  const hold = await createExternalHold({
    cabinId: cabin._id,
    startDate: addSofiaDays(today, -3),
    endDate: today
  });

  const dashboard = await getDashboardReadModel();
  const leavingIds = rowIds(dashboard.dashboard.today.leaving.rows);
  const stayingIds = rowIds(dashboard.dashboard.today.staying.rows);

  assert.ok(leavingIds.includes(String(hold._id)));
  assert.ok(!stayingIds.includes(String(hold._id)));
});

test('8. normal Booking dashboard row shape remains unchanged', async () => {
  const cabin = await createCabin('booking-shape');
  const email = `dashboard-booking-shape-${Date.now()}@example.com`;
  const booking = await createArrivingBooking({ cabinId: cabin._id, email });

  const dashboard = await getDashboardReadModel();
  const row = dashboard.dashboard.today.arriving.rows.find(
    (r) => r.reservationId === String(booking._id)
  );

  assert.ok(row);
  assert.notEqual(row.kind, 'external_hold');
  assert.equal(row.href, `/ops/reservations/${booking._id}`);
  assert.equal(row.guestName, 'Direct Guest');
  assert.ok(row.paymentStatus);
  assert.ok(row.reservationStatus);
  assert.ok(row.guestsLabel);
});

test('9. next14DaysArrivalCount excludes external holds', async () => {
  const cabin = await createCabin('next14');
  const today = sofiaToday();
  await createExternalHold({
    cabinId: cabin._id,
    startDate: addSofiaDays(today, 5),
    endDate: addSofiaDays(today, 8)
  });

  const dashboard = await getDashboardReadModel();

  assert.equal(dashboard.dashboard.upcoming.next14DaysArrivalCount, 0);
  assert.equal(dashboard.dashboard.upcoming.nextArrivals.length, 1);
  assert.equal(dashboard.dashboard.upcoming.nextArrivals[0].kind, 'external_hold');
});

test('10. future Booking upcoming wording remains "Arrives in ..."', async () => {
  const cabin = await createCabin('booking-upcoming-wording');
  const today = sofiaToday();
  const email = `dashboard-booking-upcoming-${Date.now()}@example.com`;
  const booking = await createArrivingBooking({
    cabinId: cabin._id,
    email,
    checkIn: addSofiaDays(today, 4),
    checkOut: addSofiaDays(today, 6)
  });

  const dashboard = await getDashboardReadModel();
  const row = dashboard.dashboard.upcoming.nextArrivals.find(
    (r) => r.reservationId === String(booking._id)
  );

  assert.ok(row);
  assert.notEqual(row.kind, 'external_hold');
  assert.match(row.statusLabel, /^Arrives in \d+ day/);
});

test('11. external_hold upcoming wording never uses arrival language', async () => {
  const cabin = await createCabin('hold-upcoming-wording');
  const today = sofiaToday();
  const hold = await createExternalHold({
    cabinId: cabin._id,
    startDate: addSofiaDays(today, 6),
    endDate: addSofiaDays(today, 9)
  });

  const dashboard = await getDashboardReadModel();
  const row = dashboard.dashboard.upcoming.nextArrivals.find(
    (r) => r.reservationId === String(hold._id)
  );

  assert.ok(row);
  assert.equal(row.kind, 'external_hold');
  assert.match(row.statusLabel, /^Starts in \d+ day/);
  assert.ok(!/arriv/i.test(row.statusLabel));
});

test('12. booking-only aggregates exclude external holds while lane rows include both', async () => {
  const cabin = await createCabin('aggregate-split');
  const today = sofiaToday();
  const email = `dashboard-aggregate-split-${Date.now()}@example.com`;
  await Promise.all([
    createArrivingBooking({ cabinId: cabin._id, email }),
    createExternalHold({
      cabinId: cabin._id,
      startDate: today,
      endDate: addSofiaDays(today, 2)
    })
  ]);

  const dashboard = await getDashboardReadModel();

  assert.equal(dashboard.aggregates.arrivalsToday, 1);
  assert.equal(dashboard.occupancySnapshot.value.inHouse, 0);
  assert.ok(dashboard.dashboard.today.arriving.rows.some((r) => r.kind === 'external_hold'));
  assert.ok(dashboard.dashboard.today.arriving.rows.some((r) => r.kind !== 'external_hold'));
  assert.ok(dashboard.dashboard.today.arriving.total >= 2);
});

test('13. upcoming top 5 selects earliest across >5 bookings and >5 holds', async () => {
  const cabin = await createCabin('upcoming-top5');
  const today = sofiaToday();
  const emailPrefix = `dashboard-upcoming-top5-${Date.now()}`;

  const bookingDays = [1, 3, 5, 7, 9, 11];
  const holdDays = [2, 4, 6, 8, 10, 12];

  await Promise.all([
    ...bookingDays.map((offset, index) =>
      createArrivingBooking({
        cabinId: cabin._id,
        email: `${emailPrefix}-b${index}@example.com`,
        checkIn: addSofiaDays(today, offset),
        checkOut: addSofiaDays(today, offset + 2)
      })
    ),
    ...holdDays.map((offset) =>
      createExternalHold({
        cabinId: cabin._id,
        startDate: addSofiaDays(today, offset),
        endDate: addSofiaDays(today, offset + 2)
      })
    )
  ]);

  const dashboard = await getDashboardReadModel();
  const rows = dashboard.dashboard.upcoming.nextArrivals;

  assert.equal(rows.length, 5);
  const expectedOffsets = [1, 2, 3, 4, 5];
  const actualOffsets = rows.map((row) => {
    const checkIn = new Date(row.checkInDate);
    return Math.round((checkIn.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  });
  assert.deepEqual(actualOffsets, expectedOffsets);
});

test('14. legacy sections remain Booking-only while dashboard lanes include external holds', async () => {
  const cabin = await createCabin('legacy-sections');
  const today = sofiaToday();
  const email = `dashboard-legacy-sections-${Date.now()}@example.com`;
  const [booking] = await Promise.all([
    createArrivingBooking({ cabinId: cabin._id, email }),
    createExternalHold({
      cabinId: cabin._id,
      startDate: today,
      endDate: addSofiaDays(today, 2)
    }),
    createExternalHold({
      cabinId: cabin._id,
      startDate: addSofiaDays(today, 5),
      endDate: addSofiaDays(today, 8)
    })
  ]);

  const dashboard = await getDashboardReadModel();

  assert.ok(dashboard.dashboard.today.arriving.rows.some((r) => r.kind === 'external_hold'));
  assert.ok(dashboard.dashboard.today.arriving.rows.some((r) => r.reservationId === String(booking._id)));
  assert.ok(dashboard.dashboard.upcoming.nextArrivals.some((r) => r.kind === 'external_hold'));

  assert.ok(dashboard.sections.arrivalsToday.every((r) => r.kind !== 'external_hold'));
  assert.ok(dashboard.sections.inHouse.every((r) => r.kind !== 'external_hold'));
  assert.ok(dashboard.sections.checkingOutToday.every((r) => r.kind !== 'external_hold'));
  assert.ok(dashboard.sections.upcoming7Days.every((r) => r.kind !== 'external_hold'));

  assert.ok(dashboard.sections.arrivalsToday.some((r) => r.reservationId === String(booking._id)));
  assert.ok(
    dashboard.sections.upcoming7Days.every(
      (r) => !r.statusLabel || /^Arrives in \d+ day/.test(r.statusLabel) || r.statusLabel === 'Upcoming arrival'
    )
  );
  assert.ok(
    dashboard.dashboard.upcoming.nextArrivals
      .filter((r) => r.kind === 'external_hold')
      .every((r) => /^Starts in \d+ day/.test(r.statusLabel))
  );
});
