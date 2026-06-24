'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const GiftVoucherRedemption = require('../models/GiftVoucherRedemption');
const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
require('../models/Unit');
const {
  aggregateGiftVoucherPulseMetrics,
  buildSofiaCalendarMonthRange
} = require('../services/ops/reporting/giftVoucherPulseMetricsService');
const { getDashboardReadModel } = require('../services/ops/readModels/dashboardReadModel');

let mongoServer;

function futureCheckIn(daysAhead = 30) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysAhead);
  return date;
}

function futureCheckOut(checkIn, nights = 2) {
  const date = new Date(checkIn);
  date.setUTCDate(date.getUTCDate() + nights);
  return date;
}

function monthActivatedAt() {
  const { monthStart, monthEndExclusive } = buildSofiaCalendarMonthRange(new Date());
  const midpoint = new Date((monthStart.getTime() + monthEndExclusive.getTime()) / 2);
  return midpoint;
}

function buildVoucher(overrides = {}) {
  const activatedAt = monthActivatedAt();
  const expiresAt = new Date(activatedAt.getTime() + 365 * 24 * 60 * 60 * 1000);
  return {
    code: `DD-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    amountOriginalCents: 5000,
    balanceRemainingCents: 5000,
    physicalCardFeeCents: 0,
    currency: 'EUR',
    status: 'active',
    buyerName: 'Pulse Buyer',
    buyerEmail: 'pulse-buyer@driftdwells.com',
    recipientName: 'Pulse Recipient',
    recipientEmail: 'pulse-recipient@driftdwells.com',
    deliveryMode: 'email',
    purchaseRequestId: `gvr_pulse_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    stripePaymentIntentId: `pi_pulse_${Date.now()}`,
    activatedAt,
    expiresAt,
    issuanceSource: 'purchase',
    ...overrides
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await Promise.all([
    GiftVoucher.syncIndexes(),
    GiftVoucherEvent.syncIndexes(),
    GiftVoucherRedemption.syncIndexes(),
    Booking.syncIndexes(),
    Cabin.syncIndexes()
  ]);
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    mongoose.connection.db.collection('giftvoucherevents').deleteMany({}),
    GiftVoucherRedemption.deleteMany({}),
    GiftVoucher.deleteMany({}),
    Booking.deleteMany({}),
    Cabin.deleteMany({})
  ]);
});

test('€50 email voucher active this month: sales €50, cash €50, fees €0, liability €50', async () => {
  await GiftVoucher.create(
    buildVoucher({
      amountOriginalCents: 5000,
      balanceRemainingCents: 5000,
      physicalCardFeeCents: 0
    })
  );

  const metrics = await aggregateGiftVoucherPulseMetrics();
  assert.equal(metrics.salesMTDCents, 5000);
  assert.equal(metrics.cashCollectedMTDCents, 5000);
  assert.equal(metrics.physicalCardFeesMTDCents, 0);
  assert.equal(metrics.liabilityOutstandingCents, 5000);
  assert.equal(metrics.redemptionsMTDCents, 0);
});

test('€50 postal voucher with €5 fee: sales €50, cash €55, fees €5, liability €50', async () => {
  await GiftVoucher.create(
    buildVoucher({
      amountOriginalCents: 5000,
      balanceRemainingCents: 5000,
      physicalCardFeeCents: 500,
      deliveryMode: 'postal',
      deliveryAddress: {
        addressLine1: '1 Mountain Road',
        city: 'Bansko',
        postalCode: '2770',
        country: 'BG'
      }
    })
  );

  const metrics = await aggregateGiftVoucherPulseMetrics();
  assert.equal(metrics.salesMTDCents, 5000);
  assert.equal(metrics.cashCollectedMTDCents, 5500);
  assert.equal(metrics.physicalCardFeesMTDCents, 500);
  assert.equal(metrics.liabilityOutstandingCents, 5000);
});

test('pending_payment excluded from sales and liability', async () => {
  await GiftVoucher.create(
    buildVoucher({
      status: 'pending_payment',
      code: null,
      activatedAt: null,
      amountOriginalCents: 5000,
      balanceRemainingCents: 5000
    })
  );

  const metrics = await aggregateGiftVoucherPulseMetrics();
  assert.equal(metrics.salesMTDCents, 0);
  assert.equal(metrics.liabilityOutstandingCents, 0);
});

test('voided excluded from sales and liability', async () => {
  await GiftVoucher.create(
    buildVoucher({
      status: 'voided',
      amountOriginalCents: 5000,
      balanceRemainingCents: 5000
    })
  );

  const metrics = await aggregateGiftVoucherPulseMetrics();
  assert.equal(metrics.salesMTDCents, 0);
  assert.equal(metrics.liabilityOutstandingCents, 0);
});

test('refunded excluded from sales and liability', async () => {
  await GiftVoucher.create(
    buildVoucher({
      status: 'refunded',
      amountOriginalCents: 5000,
      balanceRemainingCents: 0
    })
  );

  const metrics = await aggregateGiftVoucherPulseMetrics();
  assert.equal(metrics.salesMTDCents, 0);
  assert.equal(metrics.liabilityOutstandingCents, 0);
});

test('smoke voucher excluded', async () => {
  await GiftVoucher.create(
    buildVoucher({
      purchaseRequestId: 'gvr_smoke_dashboard_pulse',
      buyerName: 'SMOKE PAYMENTS TEST',
      amountOriginalCents: 5000,
      balanceRemainingCents: 5000
    })
  );

  const metrics = await aggregateGiftVoucherPulseMetrics();
  assert.equal(metrics.salesMTDCents, 0);
  assert.equal(metrics.liabilityOutstandingCents, 0);
});

test('audit purchase request excluded', async () => {
  await GiftVoucher.create(
    buildVoucher({
      purchaseRequestId: 'gvr_audit_dashboard_pulse',
      amountOriginalCents: 5000,
      balanceRemainingCents: 5000
    })
  );

  const metrics = await aggregateGiftVoucherPulseMetrics();
  assert.equal(metrics.salesMTDCents, 0);
});

test('compensation and goodwill vouchers excluded', async () => {
  await GiftVoucher.create(
    buildVoucher({
      issuanceSource: 'cancellation_compensation',
      amountOriginalCents: 5000,
      balanceRemainingCents: 5000
    })
  );
  await GiftVoucher.create(
    buildVoucher({
      issuanceSource: 'goodwill_ops',
      amountOriginalCents: 5000,
      balanceRemainingCents: 5000
    })
  );

  const metrics = await aggregateGiftVoucherPulseMetrics();
  assert.equal(metrics.salesMTDCents, 0);
  assert.equal(metrics.liabilityOutstandingCents, 0);
});

test('email failed but active still counts in sales and liability', async () => {
  await GiftVoucher.create(
    buildVoucher({
      amountOriginalCents: 5000,
      balanceRemainingCents: 5000,
      deliveryMode: 'email',
      buyerEmail: 'failed-email@driftdwells.com'
    })
  );

  const metrics = await aggregateGiftVoucherPulseMetrics();
  assert.equal(metrics.salesMTDCents, 5000);
  assert.equal(metrics.liabilityOutstandingCents, 5000);
});

test('expired activated this month counts in sales/cash but not liability', async () => {
  await GiftVoucher.create(
    buildVoucher({
      status: 'expired',
      amountOriginalCents: 5000,
      balanceRemainingCents: 5000
    })
  );

  const metrics = await aggregateGiftVoucherPulseMetrics();
  assert.equal(metrics.salesMTDCents, 5000);
  assert.equal(metrics.cashCollectedMTDCents, 5000);
  assert.equal(metrics.liabilityOutstandingCents, 0);
});

test('redemption event this month counts in redemptions, not cash', async () => {
  const voucher = await GiftVoucher.create(
    buildVoucher({
      amountOriginalCents: 5000,
      balanceRemainingCents: 2000,
      status: 'partially_redeemed'
    })
  );
  const redemption = await GiftVoucherRedemption.create({
    giftVoucherId: voucher._id,
    amountAppliedCents: 3000,
    status: 'confirmed',
    confirmedAt: monthActivatedAt()
  });
  await GiftVoucherEvent.create({
    giftVoucherId: voucher._id,
    type: 'redeemed_confirmed',
    actor: 'system',
    note: 'test redemption confirmed',
    previousBalanceCents: 5000,
    newBalanceCents: 2000,
    deltaCents: 0,
    metadata: { redemptionId: String(redemption._id) },
    createdAt: monthActivatedAt()
  });

  const metrics = await aggregateGiftVoucherPulseMetrics();
  assert.equal(metrics.redemptionsMTDCents, 3000);
  assert.equal(metrics.cashCollectedMTDCents, 5000);
});

test('dashboard booking pulse unchanged except gross booked alias; voucher pulse populated', async () => {
  const cabin = await Cabin.create({
    name: 'Pulse Cabin',
    description: 'd',
    location: 'Bachevo',
    capacity: 2,
    pricePerNight: 100,
    minNights: 2,
    propertyKind: 'cabin',
    imageUrl: 'https://example.com/cabin.jpg'
  });

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 5);
  const checkIn = futureCheckIn(35);
  const checkOut = futureCheckOut(checkIn);
  await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'Dash', lastName: 'Test', email: 'dash-pulse@test.com', phone: '+359800000099' },
    totalPrice: 200,
    totalValueCents: 20000,
    stripePaidAmountCents: 15000,
    status: 'confirmed',
    provenance: { source: 'guest_portal' },
    createdAt: monthStart
  });

  await GiftVoucher.create(
    buildVoucher({
      amountOriginalCents: 5000,
      balanceRemainingCents: 5000,
      physicalCardFeeCents: 0
    })
  );

  const model = await getDashboardReadModel();
  const pulse = model.dashboard.pulse;

  assert.equal(pulse.bookingsMTD, 1);
  assert.equal(pulse.bookingValueMTD, 200);
  assert.equal(pulse.grossBookedMTD, 200);
  assert.equal(pulse.giftVouchers.salesMTDCents, 5000);
  assert.equal(pulse.giftVouchers.cashCollectedMTDCents, 5000);
  assert.equal(pulse.cashCollected.bookingStripeCashMTDCents, 15000);
  assert.equal(pulse.cashCollected.voucherCashCollectedMTDCents, 5000);
  assert.equal(pulse.cashCollected.totalCashCollectedMTDCents, 20000);
});

test('total cash collected equals booking stripe cash + voucher cash', async () => {
  const cabin = await Cabin.create({
    name: 'Cash Cabin',
    description: 'd',
    location: 'Bachevo',
    capacity: 2,
    pricePerNight: 100,
    minNights: 2,
    propertyKind: 'cabin',
    imageUrl: 'https://example.com/cabin.jpg'
  });

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 8);
  const checkIn = futureCheckIn(40);
  const checkOut = futureCheckOut(checkIn);
  await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'Cash', lastName: 'Test', email: 'cash-pulse@test.com', phone: '+359800000098' },
    totalPrice: 300,
    totalValueCents: 30000,
    stripePaidAmountCents: 25000,
    status: 'confirmed',
    provenance: { source: 'guest_portal' },
    createdAt: monthStart
  });

  await GiftVoucher.create(
    buildVoucher({
      amountOriginalCents: 5000,
      balanceRemainingCents: 5000,
      physicalCardFeeCents: 500,
      deliveryMode: 'postal',
      deliveryAddress: {
        addressLine1: '1 Mountain Road',
        city: 'Bansko',
        postalCode: '2770',
        country: 'BG'
      }
    })
  );

  const model = await getDashboardReadModel();
  const { cashCollected } = model.dashboard.pulse;

  assert.equal(
    cashCollected.totalCashCollectedMTDCents,
    cashCollected.bookingStripeCashMTDCents + cashCollected.voucherCashCollectedMTDCents
  );
  assert.equal(cashCollected.bookingStripeCashMTDCents, 25000);
  assert.equal(cashCollected.voucherCashCollectedMTDCents, 5500);
  assert.equal(cashCollected.totalCashCollectedMTDCents, 30500);
});

test('guard: gross booked MTD + gift voucher sales MTD is not total revenue', async () => {
  const cabin = await Cabin.create({
    name: 'Guard Cabin',
    description: 'd',
    location: 'Bachevo',
    capacity: 2,
    pricePerNight: 100,
    minNights: 2,
    propertyKind: 'cabin',
    imageUrl: 'https://example.com/cabin.jpg'
  });

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 10);
  const checkIn = futureCheckIn(45);
  const checkOut = futureCheckOut(checkIn);
  await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'Guard', lastName: 'Test', email: 'guard-pulse@test.com', phone: '+359800000097' },
    totalPrice: 200,
    totalValueCents: 20000,
    giftVoucherAppliedCents: 5000,
    stripePaidAmountCents: 15000,
    status: 'confirmed',
    provenance: { source: 'guest_portal' },
    createdAt: monthStart
  });

  await GiftVoucher.create(
    buildVoucher({
      amountOriginalCents: 5000,
      balanceRemainingCents: 5000
    })
  );

  const model = await getDashboardReadModel();
  const pulse = model.dashboard.pulse;

  const grossBookedCents = Math.round(pulse.grossBookedMTD * 100);
  const misleadingRevenueSumCents = grossBookedCents + pulse.giftVouchers.salesMTDCents;

  assert.equal(grossBookedCents, 20000);
  assert.equal(pulse.giftVouchers.salesMTDCents, 5000);
  assert.equal(pulse.cashCollected.totalCashCollectedMTDCents, 20000);
  assert.equal(misleadingRevenueSumCents, 25000);
  assert.notEqual(misleadingRevenueSumCents, pulse.cashCollected.totalCashCollectedMTDCents);
});
