'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const {
  majorCurrencyAmountToCents,
  aggregateInsightsReconciliation
} = require('../services/ops/reporting/insightsReconciliationService');
const { validateInsightsEntityFilters } = require('../services/ops/reporting/entityFilterValidation');

let mongoServer;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([Cabin.deleteMany({}), Booking.deleteMany({}), Payment.deleteMany({})]);
});

test('majorCurrencyAmountToCents avoids floating-point drift', () => {
  assert.equal(majorCurrencyAmountToCents(19.99), 1999);
  assert.equal(majorCurrencyAmountToCents(0.1 + 0.2), 30);
  assert.equal(majorCurrencyAmountToCents('12.34'), 1234);
  assert.equal(majorCurrencyAmountToCents(null), 0);
});

test('reconciliation excludes gift payments, computes variances, keeps unlinked site-wide', async () => {
  const cabin = await Cabin.create({
    name: 'Recon Cabin',
    description: 'd',
    location: 'Bachevo',
    capacity: 2,
    pricePerNight: 100,
    minNights: 2,
    propertyKind: 'cabin',
    imageUrl: 'https://example.com/cabin.jpg'
  });

  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn: new Date('2026-09-10T00:00:00.000Z'),
    checkOut: new Date('2026-09-12T00:00:00.000Z'),
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'recon@test.com', phone: '+359800000001' },
    totalPrice: 200,
    totalValueCents: 20000,
    stripePaidAmountCents: 20000,
    status: 'confirmed',
    provenance: { source: 'guest_portal' }
  });

  await Payment.create({
    provider: 'stripe',
    providerReference: 'pi_stay_paid',
    reservationId: booking._id,
    status: 'paid',
    amount: 200,
    currency: 'eur',
    source: 'webhook',
    metadata: { type: 'booking' }
  });
  await Payment.create({
    provider: 'stripe',
    providerReference: 'pi_stay_refund',
    reservationId: booking._id,
    status: 'refunded',
    amount: 50,
    currency: 'eur',
    source: 'webhook',
    metadata: {}
  });
  await Payment.create({
    provider: 'stripe',
    providerReference: 'pi_gift',
    reservationId: booking._id,
    status: 'paid',
    amount: 55,
    currency: 'eur',
    source: 'webhook',
    metadata: { type: 'gift_voucher', giftVoucherId: 'gv1' }
  });
  const unlinked = await Payment.create({
    provider: 'stripe',
    providerReference: 'pi_unlinked',
    reservationId: null,
    status: 'paid',
    amount: 99.99,
    currency: 'eur',
    source: 'webhook',
    metadata: {}
  });
  await Payment.collection.updateOne(
    { _id: unlinked._id },
    { $set: { createdAt: new Date('2026-09-12T12:00:00.000Z') } }
  );

  const data = await aggregateInsightsReconciliation({
    propertyKind: 'cabin',
    from: '2026-09-01',
    to: '2026-09-30',
    revenueBasis: 'checkIn'
  });

  assert.equal(data.commercial.grossBookedRevenueCents.value, 20000);
  assert.equal(data.paymentSnapshotAtBooking.amountCents.value, 20000);
  assert.equal(data.linkedPaymentLedger.grossPaidAmountCents.value, 20000);
  assert.equal(data.linkedPaymentLedger.refundedAmountCents.value, 5000);
  assert.equal(data.linkedPaymentLedger.netPaidAmountCents.value, 15000);
  assert.equal(data.linkedPaymentLedger.giftVoucherPaymentsExcludedCount, 1);
  assert.equal(data.variance.snapshotVsLinkedLedgerCents, 5000);
  assert.equal(data.variance.commercialVsLinkedNetPaidCents, 5000);
  assert.equal(data.siteWideUnlinkedPayments.count, 1);
  assert.equal(data.siteWideUnlinkedPayments.amountCents, 9999);
  assert.equal(data.siteWideUnlinkedPayments.includedInZoneVariance, false);
  assert.equal(data.siteWideUnlinkedPayments.propertyKindAttributed, false);
  assert.equal(data.exclusions.giftVoucherProductPaymentsExcluded, true);
  assert.equal(data.exclusions.giftVoucherRedemptionNotNewCash, true);
  assert.equal(data.provenance.readOnly, true);
  assert.equal(data.provenance.writesPerformed, false);
  assert.match(data.exclusions.locationBookingTreatment, /LocationBooking/i);

  // Unlinked amount must not affect zone variance math (already asserted via linked-only variance).
  assert.equal(
    data.variance.snapshotVsLinkedLedgerCents,
    data.paymentSnapshotAtBooking.amountCents.value - data.linkedPaymentLedger.netPaidAmountCents.value
  );
});

test('reconciliation rejects cross-zone entity filters', async () => {
  const cabin = await Cabin.create({
    name: 'Cabin Zone',
    description: 'd',
    location: 'Bachevo',
    capacity: 2,
    pricePerNight: 100,
    minNights: 2,
    propertyKind: 'cabin',
    imageUrl: 'https://example.com/cabin.jpg'
  });

  await assert.rejects(
    () =>
      aggregateInsightsReconciliation({
        propertyKind: 'valley',
        from: '2026-09-01',
        to: '2026-09-30',
        cabinId: String(cabin._id)
      }),
    (err) => err.statusCode === 400
  );

  await assert.rejects(
    () => validateInsightsEntityFilters({ propertyKind: 'valley', cabinId: String(cabin._id) }),
    (err) => err.statusCode === 400
  );
});

test('voucher redemption is not counted as new ledger cash', async () => {
  const cabin = await Cabin.create({
    name: 'Voucher Cabin',
    description: 'd',
    location: 'Bachevo',
    capacity: 2,
    pricePerNight: 100,
    minNights: 2,
    propertyKind: 'cabin',
    imageUrl: 'https://example.com/cabin.jpg'
  });

  // Stay paid partly by voucher: Stripe snapshot lower than commercial; no extra Payment for redemption.
  await Booking.create({
    cabinId: cabin._id,
    checkIn: new Date('2026-09-20T00:00:00.000Z'),
    checkOut: new Date('2026-09-22T00:00:00.000Z'),
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'voucher@test.com', phone: '+359800000002' },
    totalPrice: 200,
    totalValueCents: 20000,
    giftVoucherAppliedCents: 5000,
    stripePaidAmountCents: 15000,
    status: 'confirmed',
    provenance: { source: 'guest_portal' }
  });

  const before = await Payment.countDocuments({});
  const data = await aggregateInsightsReconciliation({
    propertyKind: 'cabin',
    from: '2026-09-01',
    to: '2026-09-30',
    revenueBasis: 'checkIn'
  });
  const after = await Payment.countDocuments({});

  assert.equal(before, after);
  assert.equal(data.commercial.grossBookedRevenueCents.value, 20000);
  assert.equal(data.paymentSnapshotAtBooking.amountCents.value, 15000);
  assert.equal(data.linkedPaymentLedger.grossPaidAmountCents.value, 0);
  assert.equal(data.linkedPaymentLedger.netPaidAmountCents.value, 0);
});
