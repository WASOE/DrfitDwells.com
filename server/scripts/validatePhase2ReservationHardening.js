/* eslint-disable no-console */
/**
 * Phase 2 checks: strict ICS eligibility (pending requires paid/partial Payment), integrity signals shape.
 * Run: npm run validate:phase2 (requires MongoDB)
 */
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const Cabin = require('../models/Cabin');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const { selectBlockingSpansForSingleCabin } = require('../services/calendar/selectBlockingSpans');
const { getReservationIntegritySignals } = require('../services/ops/readiness/reservationIntegritySignals');

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function addDaysUTC(date, days) {
  const x = new Date(date.getTime());
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

async function run() {
  process.env.PUBLIC_ICS_STRICT_ELIGIBILITY = '1';
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);

  const todayUtc = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const base = addDaysUTC(todayUtc, 40);
  const checkIn = addDaysUTC(base, 1);
  const checkOut = addDaysUTC(base, 4);

  let pendingBookingId = null;
  let demoConfirmedId = null;
  let legacyPaidNoProvId = null;

  const cabin = await Cabin.create({
    name: `Phase2Hardening ${Date.now()}`,
    description: 'Phase 2 validation cabin',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/phase2.jpg',
    location: 'Bulgaria',
    geoLocation: { latitude: 42.6977, longitude: 23.3219 }
  });

  try {
    const pending = await Booking.create({
      cabinId: cabin._id,
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
      status: 'pending',
      guestInfo: {
        firstName: 'Pay',
        lastName: 'Later',
        email: `phase2-pend-${Date.now()}@example.com`,
        phone: '+3590'
      },
      totalPrice: 100,
      tripType: 'retreat',
      romanticSetup: false,
      provenance: { source: 'guest_portal', intakeRevision: 1 }
    });
    pendingBookingId = pending._id;

    let spans = await selectBlockingSpansForSingleCabin(cabin._id, { strictIcsEligibility: true });
    assert(
      !spans.some((s) => s.sourceId === String(pending._id)),
      'strict ICS must exclude unpaid pending booking'
    );

    await Payment.create({
      reservationId: pending._id,
      provider: 'stripe',
      providerReference: `phase2_${pending._id}_${Date.now()}`,
      status: 'paid',
      amount: 100,
      currency: 'eur',
      source: 'webhook'
    });

    spans = await selectBlockingSpansForSingleCabin(cabin._id, { strictIcsEligibility: true });
    assert(
      spans.some((s) => s.kind === 'booking' && s.sourceId === String(pending._id)),
      'strict ICS must include pending once paid/partial Payment exists'
    );

    const sig = await getReservationIntegritySignals();
    assert(typeof sig.publicIcsStrictEligibility === 'boolean', 'signals must include publicIcsStrictEligibility');
    assert(Array.isArray(sig.warnings), 'signals.warnings must be array');
    assert(typeof sig.staleActiveReservationBlockCount === 'number', 'stale count must be numeric');
    assert(typeof sig.publicIcsExportSafetyEnforced === 'boolean', 'signals must include export safety flag');

    const demoConfirmed = await Booking.create({
      cabinId: cabin._id,
      checkIn: addDaysUTC(base, 20),
      checkOut: addDaysUTC(base, 23),
      adults: 2,
      children: 0,
      status: 'confirmed',
      isTest: true,
      isProductionSafe: false,
      guestInfo: {
        firstName: 'Demo',
        lastName: 'Guest',
        email: `phase2-demo-${Date.now()}@example.com`,
        phone: '+3592'
      },
      totalPrice: 100,
      tripType: 'retreat',
      romanticSetup: false,
      provenance: { source: 'guest_portal', intakeRevision: 1 }
    });
    demoConfirmedId = demoConfirmed._id;
    await Payment.create({
      reservationId: demoConfirmed._id,
      provider: 'stripe',
      providerReference: `phase2_demo_${demoConfirmed._id}_${Date.now()}`,
      status: 'paid',
      amount: 100,
      currency: 'eur',
      source: 'webhook'
    });
    spans = await selectBlockingSpansForSingleCabin(cabin._id, { strictIcsEligibility: true });
    assert(
      !spans.some((s) => s.sourceId === String(demoConfirmed._id)),
      'confirmed isTest booking must not export on public ICS even when paid'
    );

    const legacyPaidNoProv = await Booking.create({
      cabinId: cabin._id,
      checkIn: addDaysUTC(base, 25),
      checkOut: addDaysUTC(base, 28),
      adults: 2,
      children: 0,
      status: 'confirmed',
      guestInfo: {
        firstName: 'Legacy',
        lastName: 'Paid',
        email: `phase2-legacy-${Date.now()}@example.com`,
        phone: '+3593'
      },
      totalPrice: 100,
      tripType: 'retreat',
      romanticSetup: false
    });
    legacyPaidNoProvId = legacyPaidNoProv._id;
    await Payment.create({
      reservationId: legacyPaidNoProv._id,
      provider: 'stripe',
      providerReference: `phase2_legacy_${legacyPaidNoProv._id}_${Date.now()}`,
      status: 'paid',
      amount: 100,
      currency: 'eur',
      source: 'webhook'
    });
    spans = await selectBlockingSpansForSingleCabin(cabin._id, { strictIcsEligibility: true });
    assert(
      !spans.some((s) => s.sourceId === String(legacyPaidNoProv._id)),
      'confirmed+paid without provenance or explicit isProductionSafe must not export (Phase 2c)'
    );

    console.log(JSON.stringify({ success: true, batch: 'phase2-reservation-hardening' }, null, 2));
  } finally {
    if (legacyPaidNoProvId) {
      await Payment.deleteMany({ reservationId: legacyPaidNoProvId });
      await Booking.deleteOne({ _id: legacyPaidNoProvId });
    }
    if (demoConfirmedId) {
      await Payment.deleteMany({ reservationId: demoConfirmedId });
      await Booking.deleteOne({ _id: demoConfirmedId });
    }
    if (pendingBookingId) {
      await Payment.deleteMany({ reservationId: pendingBookingId });
    }
    await Booking.deleteMany({ cabinId: cabin._id });
    await Cabin.deleteOne({ _id: cabin._id });
    await mongoose.disconnect();
  }
}

run().catch((e) => {
  console.error(JSON.stringify({ success: false, batch: 'phase2-reservation-hardening', error: e?.message || String(e) }, null, 2));
  process.exit(1);
});
