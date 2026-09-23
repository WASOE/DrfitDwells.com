'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildEnsureQuoteFromPublicResult,
  formatV2CreatePaymentIntentResponse,
  resolvePublicSplitPaymentPreview
} = require('../routes/checkoutSessionRouteAdapter');
const { resolveSplitPaymentOfferForCheckout } = require('../services/paymentScheduleService');
const { formatPublicSplitOffer } = require('../services/splitPaymentChoiceService');

const ratePlan = {
  code: 'winter-cabin-stay-2026-27',
  version: 2,
  paymentTermCode: 'split-40-60-30d',
  paymentTermVersion: 1
};
const paymentTerm = {
  code: 'split-40-60-30d',
  internalName: '40 / 60',
  version: 1,
  status: 'active',
  currency: 'EUR',
  scheduleKind: 'percent_split',
  allowDateTransfer: false,
  legs: [
    { sequence: 1, amountType: 'percent_bps', amountValue: 4000, dueRule: 'checkout', dueOffsetDays: 0, cancellationTreatment: 'stay_credit' },
    { sequence: 2, amountType: 'remainder', amountValue: null, dueRule: 'days_before_arrival', dueOffsetDays: 30, cancellationTreatment: 'standard_policy' }
  ]
};

function modelFor(value) {
  return { findOne: () => ({ lean: async () => value }) };
}

function quote(overrides = {}) {
  return {
    entityType: 'cabinType',
    entity: { _id: 'a-frame' },
    checkInDate: new Date('2026-12-10T00:00:00.000Z'),
    checkOutDate: new Date('2026-12-18T00:00:00.000Z'),
    subtotalPrice: 600,
    discountAmount: 0,
    totalPrice: 600,
    remainingDueCents: 60000,
    voucherAppliedCents: 0,
    stayCreditAppliedCents: 0,
    fullVoucherCoverage: false,
    ratePlan: { code: ratePlan.code, version: 2, type: 'seasonal_stay', currency: 'EUR' },
    ...overrides
  };
}

const deps = {
  isSplitPaymentEnabled: () => true,
  RatePlan: modelFor(ratePlan),
  PaymentTermTemplate: modelFor(paymentTerm)
};

test('winter v2 quote keeps its pin and produces the public 40/60 offer', async () => {
  const adapted = buildEnsureQuoteFromPublicResult(quote());
  assert.deepEqual(adapted.ratePlan, quote().ratePlan);

  const resolved = await resolveSplitPaymentOfferForCheckout({
    quote: adapted,
    quoteSnapshot: { checkInDateOnly: '2026-12-10', currency: 'EUR', voucherAppliedCents: 0, stayCreditAppliedCents: 0 },
    stripeAmountCents: 60000,
    bookingDateOnly: '2026-09-23',
    deps
  });
  assert.equal(resolved.eligibility.eligible, true);
  assert.deepEqual(resolved.splitPaymentOfferSnapshot.installments.map((row) => row.amountCents), [24000, 36000]);
  assert.equal(resolved.splitPaymentOfferSnapshot.installments[1].dueAtDateOnly, '2026-11-10');

  const publicOffer = formatPublicSplitOffer({
    splitPaymentOfferSnapshot: resolved.splitPaymentOfferSnapshot,
    splitPaymentOfferSnapshotHash: resolved.splitPaymentOfferSnapshotHash
  });
  const response = formatV2CreatePaymentIntentResponse({
    checkoutId: 'chk_hotfix', flowVersion: 'v2', stripeAmountCents: 60000,
    paymentChoice: 'full', splitPaymentOffer: publicOffer
  });
  assert.equal(response.paymentChoice, 'full');
  assert.deepEqual(response.splitPaymentOffer.installments.map((row) => row.amountCents), [24000, 36000]);
});

test('quote preview is server-derived and stays absent for an ineligible voucher quote', async () => {
  const preview = await resolvePublicSplitPaymentPreview(quote(), {
    bookingDateOnly: '2026-09-23', paymentScheduleDeps: deps
  });
  assert.deepEqual(preview, {
    initialAmountCents: 24000,
    initialPercentBps: 4000,
    balanceAmountCents: 36000,
    balanceDueAtDateOnly: '2026-11-10',
    balanceDueOffsetDays: 30
  });

  const ineligible = await resolvePublicSplitPaymentPreview(
    quote({ voucherAppliedCents: 1000, remainingDueCents: 59000 }),
    { bookingDateOnly: '2026-09-23', paymentScheduleDeps: deps }
  );
  assert.equal(ineligible, null);
});
