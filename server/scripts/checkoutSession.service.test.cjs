/**
 * CheckoutSession service (C2B): snapshot, fingerprints, lifecycle — no Stripe.
 *
 * Run: node --test server/scripts/checkoutSession.service.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const CheckoutSession = require('../models/CheckoutSession');
const {
  CheckoutSessionError,
  CHECKOUT_SESSION_ERROR_CODES,
  normalizeCheckoutSessionInput,
  buildCommercialBoundaryKey,
  buildStayFingerprint,
  buildReplayFingerprint,
  buildQuoteSnapshot,
  hashQuoteSnapshot,
  createCheckoutSession,
  refreshCheckoutSessionQuote,
  getCheckoutSessionState,
  assertSessionUsable
} = require('../services/checkout/checkoutSessionService');

let mongoServer;

const ENTITY_ID = new mongoose.Types.ObjectId();

function buildFabricatedQuote(overrides = {}) {
  const checkInDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  const checkOutDate = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000);
  return {
    entityType: 'cabin',
    entity: {
      _id: ENTITY_ID,
      minNights: 1,
      capacity: 4,
      pricingModel: 'per_night'
    },
    checkInDate,
    checkOutDate,
    subtotalPrice: 200,
    discountAmount: 20,
    totalPrice: 180,
    appliedPromoCode: 'SAVE10',
    promo: { snapshot: { code: 'SAVE10', type: 'percent' } },
    voucherAppliedCents: 0,
    remainingDueCents: 18000,
    fullVoucherCoverage: false,
    ...overrides
  };
}

function baseInput(overrides = {}) {
  return {
    cabinId: String(ENTITY_ID),
    checkIn: '2026-06-10',
    checkOut: '2026-06-12',
    adults: 2,
    children: 0,
    experienceKeys: ['z', 'a'],
    transportMethod: 'Horse',
    romanticSetup: false,
    promoCode: ' save10 ',
    voucherCode: '',
    guestEmail: 'Guest@Example.com',
    ...overrides
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await CheckoutSession.syncIndexes();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await CheckoutSession.deleteMany({});
});

test('normalizeCheckoutSessionInput is stable and does not mutate original', () => {
  const raw = {
    cabinId: String(ENTITY_ID),
    checkIn: '2026-06-10',
    checkOut: '2026-06-12',
    adults: 2,
    experienceKeys: ['b', 'a'],
    promoCode: ' save10 ',
    guestEmail: 'Guest@Example.com'
  };
  const copy = JSON.parse(JSON.stringify(raw));
  const a = normalizeCheckoutSessionInput(raw);
  const b = normalizeCheckoutSessionInput(raw);
  assert.deepEqual(a, b);
  assert.deepEqual(raw, copy);
  assert.deepEqual(a.experienceKeys, ['a', 'b']);
  assert.equal(a.guestEmail, 'guest@example.com');
  assert.equal(a.promoCode, 'SAVE10');
});

test('commercialBoundaryKey changes when entity changes', () => {
  const base = normalizeCheckoutSessionInput(baseInput());
  const otherEntity = normalizeCheckoutSessionInput(
    baseInput({ cabinId: String(new mongoose.Types.ObjectId()) })
  );
  assert.notEqual(buildCommercialBoundaryKey(base), buildCommercialBoundaryKey(otherEntity));
});

test('commercialBoundaryKey changes when dates change', () => {
  const base = normalizeCheckoutSessionInput(baseInput());
  const otherDates = normalizeCheckoutSessionInput(
    baseInput({ checkIn: '2026-07-01', checkOut: '2026-07-05' })
  );
  assert.notEqual(buildCommercialBoundaryKey(base), buildCommercialBoundaryKey(otherDates));
});

test('commercialBoundaryKey unchanged for promo voucher guests extras', () => {
  const base = normalizeCheckoutSessionInput(baseInput());
  const changed = normalizeCheckoutSessionInput(
    baseInput({
      promoCode: 'OTHER',
      voucherCode: 'DD-GIFT',
      adults: 4,
      children: 1,
      experienceKeys: ['only-one'],
      transportMethod: 'Jeep',
      romanticSetup: true
    })
  );
  assert.equal(buildCommercialBoundaryKey(base), buildCommercialBoundaryKey(changed));
});

test('stayFingerprint includes email when present and differs from replayFingerprint', () => {
  const normalized = normalizeCheckoutSessionInput(baseInput());
  const stay = buildStayFingerprint(normalized);
  const replay = buildReplayFingerprint(normalized);
  assert.ok(stay);
  assert.ok(replay);
  assert.notEqual(stay, replay);
});

test('stayFingerprint is null without guest email', () => {
  const normalized = normalizeCheckoutSessionInput(baseInput({ guestEmail: '' }));
  assert.equal(buildStayFingerprint(normalized), null);
});

test('replayFingerprint changes when guest count changes', () => {
  const a = normalizeCheckoutSessionInput(baseInput({ adults: 2, children: 0 }));
  const b = normalizeCheckoutSessionInput(baseInput({ adults: 3, children: 1 }));
  assert.notEqual(buildReplayFingerprint(a), buildReplayFingerprint(b));
});

test('quoteSnapshot stores cents only and clamps stripeAmountCents', () => {
  const normalized = normalizeCheckoutSessionInput(baseInput());
  const snapshot = buildQuoteSnapshot({
    normalizedInput: normalized,
    quote: buildFabricatedQuote({ remainingDueCents: -50, totalPrice: 100 })
  });
  assert.equal(snapshot.subtotalCents, 20000);
  assert.equal(snapshot.discountAmountCents, 2000);
  assert.equal(snapshot.totalValueCents, 10000);
  assert.equal(snapshot.stripeAmountCents, 0);
  assert.equal(Number.isInteger(snapshot.stripeAmountCents), true);
});

test('hash stable with object key order differences', () => {
  const normalized = normalizeCheckoutSessionInput(baseInput());
  const snapshotA = buildQuoteSnapshot({ normalizedInput: normalized, quote: buildFabricatedQuote() });
  const snapshotB = {
    ...snapshotA,
    promoSnapshot: snapshotA.promoSnapshot
      ? { type: snapshotA.promoSnapshot.type, code: snapshotA.promoSnapshot.code }
      : null
  };
  assert.equal(hashQuoteSnapshot(snapshotA), hashQuoteSnapshot(snapshotB));
});

test('hash changes when pricing-relevant values change', () => {
  const normalized = normalizeCheckoutSessionInput(baseInput());
  const base = buildQuoteSnapshot({ normalizedInput: normalized, quote: buildFabricatedQuote() });
  const changed = buildQuoteSnapshot({
    normalizedInput: normalizeCheckoutSessionInput(baseInput({ adults: 4 })),
    quote: buildFabricatedQuote({ totalPrice: 220, remainingDueCents: 22000 })
  });
  assert.notEqual(hashQuoteSnapshot(base), hashQuoteSnapshot(changed));
});

test('create card-required session: payment_required, unpaid, stripeAmountCents > 0', async () => {
  const { session } = await createCheckoutSession({
    input: baseInput(),
    quote: buildFabricatedQuote()
  });
  assert.equal(session.status, 'payment_required');
  assert.equal(session.paymentStatus, 'unpaid');
  assert.ok(session.stripeAmountCents > 0);
  assert.equal(session.canonicalPaymentIntentId, null);
  assert.match(session.checkoutId, /^[A-Za-z0-9:_-]{8,128}$/);
});

test('create full-voucher session: voucher_only_reserved, not_required, no PI', async () => {
  const { session } = await createCheckoutSession({
    input: baseInput({ voucherCode: 'GIFT' }),
    quote: buildFabricatedQuote({
      totalPrice: 50,
      voucherAppliedCents: 5000,
      remainingDueCents: 0,
      fullVoucherCoverage: true
    })
  });
  assert.equal(session.status, 'voucher_only_reserved');
  assert.equal(session.paymentStatus, 'not_required');
  assert.equal(session.stripeAmountCents, 0);
  assert.equal(session.canonicalPaymentIntentId, null);
});

test('create zero-due non-voucher session: payment_not_required, not_required, no PI', async () => {
  const { session } = await createCheckoutSession({
    input: baseInput({ promoCode: 'FREE100' }),
    quote: buildFabricatedQuote({
      totalPrice: 0,
      discountAmount: 200,
      remainingDueCents: 0,
      fullVoucherCoverage: false,
      voucherAppliedCents: 0
    })
  });
  assert.equal(session.status, 'payment_not_required');
  assert.equal(session.paymentStatus, 'not_required');
  assert.equal(session.stripeAmountCents, 0);
  assert.equal(session.canonicalPaymentIntentId, null);
});

test('refresh same boundary updates hash and increments sessionVersion', async () => {
  const { session } = await createCheckoutSession({
    input: baseInput(),
    quote: buildFabricatedQuote()
  });
  const beforeHash = session.quoteSnapshotHash;
  const beforeVersion = session.sessionVersion;

  const result = await refreshCheckoutSessionQuote({
    checkoutId: session.checkoutId,
    input: baseInput({ promoCode: 'BIGGER' }),
    quote: buildFabricatedQuote({
      discountAmount: 40,
      totalPrice: 160,
      remainingDueCents: 16000
    })
  });

  assert.notEqual(result.quoteSnapshotHash, beforeHash);
  assert.equal(result.quoteSnapshotHashChanged, true);
  assert.equal(result.session.sessionVersion, beforeVersion + 1);
});

test('refresh same boundary guest count change does not supersede session', async () => {
  const { session } = await createCheckoutSession({
    input: baseInput(),
    quote: buildFabricatedQuote()
  });
  const result = await refreshCheckoutSessionQuote({
    checkoutId: session.checkoutId,
    input: baseInput({ adults: 4, children: 1 }),
    quote: buildFabricatedQuote({ totalPrice: 240, remainingDueCents: 24000 })
  });
  assert.equal(result.session.status, 'payment_required');
  assert.equal(result.session.checkoutId, session.checkoutId);
  const reloaded = await CheckoutSession.findOne({ checkoutId: session.checkoutId });
  assert.notEqual(reloaded.status, 'superseded');
});

test('refresh boundary change throws COMMERCIAL_BOUNDARY_CHANGED', async () => {
  const { session } = await createCheckoutSession({
    input: baseInput(),
    quote: buildFabricatedQuote()
  });
  await assert.rejects(
    () =>
      refreshCheckoutSessionQuote({
        checkoutId: session.checkoutId,
        input: baseInput({ checkIn: '2026-08-01', checkOut: '2026-08-05' }),
        quote: buildFabricatedQuote()
      }),
    (err) =>
      err instanceof CheckoutSessionError &&
      err.code === CHECKOUT_SESSION_ERROR_CODES.COMMERCIAL_BOUNDARY_CHANGED
  );
  const unchanged = await CheckoutSession.findOne({ checkoutId: session.checkoutId });
  assert.equal(unchanged.metadata.commercialBoundaryKey, session.metadata.commercialBoundaryKey);
});

test('refresh sets requiresPaymentIntentRefresh when hash changes and canonical PI exists', async () => {
  const { session } = await createCheckoutSession({
    input: baseInput(),
    quote: buildFabricatedQuote()
  });
  session.canonicalPaymentIntentId = 'pi_existing_123';
  await session.save();

  const result = await refreshCheckoutSessionQuote({
    checkoutId: session.checkoutId,
    input: baseInput({ promoCode: 'NEW' }),
    quote: buildFabricatedQuote({ totalPrice: 150, remainingDueCents: 15000 })
  });
  assert.equal(result.requiresPaymentIntentRefresh, true);
  assert.equal(result.session.canonicalPaymentIntentId, 'pi_existing_123');
});

test('expired session rejected by assertSessionUsable', async () => {
  const { session } = await createCheckoutSession({
    input: baseInput(),
    quote: buildFabricatedQuote()
  });
  session.expiresAt = new Date(Date.now() - 60_000);
  await session.save();
  assert.throws(() => assertSessionUsable(session), (err) => {
    assert.equal(err.code, CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_EXPIRED);
    return true;
  });
});

test('getCheckoutSessionState does not expose client_secret', async () => {
  const { session } = await createCheckoutSession({
    input: baseInput(),
    quote: buildFabricatedQuote()
  });
  session.metadata = { client_secret: 'must-not-leak', commercialBoundaryKey: 'x' };
  await session.save();

  const dto = getCheckoutSessionState(session);
  assert.ok(dto.checkoutId);
  assert.equal(Object.prototype.hasOwnProperty.call(dto, 'client_secret'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(dto, 'clientSecret'), false);
  assert.equal(dto.metadata, undefined);
});
