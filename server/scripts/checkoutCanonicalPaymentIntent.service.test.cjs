/**
 * Canonical PaymentIntent service (C2C) — mocked Stripe, MongoMemoryServer only.
 *
 * Run: node --test server/scripts/checkoutCanonicalPaymentIntent.service.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const CheckoutSession = require('../models/CheckoutSession');
const {
  ensureCanonicalPaymentIntent,
  assertCanonicalPaymentIntentForSession,
  supersedeCanonicalPaymentIntent,
  buildPaymentIntentIdempotencyKey,
  claimCreatedPaymentIntentOrReuseWinner,
  claimCanonicalPaymentIntent
} = require('../services/checkout/checkoutCanonicalPaymentIntentService');
const { hashQuoteSnapshot, buildQuoteSnapshot } = require('../services/checkout/checkoutSessionSnapshot');
const { normalizeCheckoutSessionInput } = require('../services/checkout/checkoutSessionService');
const {
  CheckoutSessionError,
  CHECKOUT_SESSION_ERROR_CODES
} = require('../services/checkout/checkoutSessionErrors');
const { createCheckoutSession, loadSessionOrThrow } = require('../services/checkout/checkoutSessionService');

let mongoServer;

const ENTITY_ID = new mongoose.Types.ObjectId();

function createFakeStripe() {
  const store = new Map();
  const idempotencyStore = new Map();
  let seq = 0;
  const calls = { create: 0, uniqueCreated: 0, retrieve: 0, cancel: 0, update: 0 };

  const client = {
    paymentIntents: {
      create: async (payload, options = {}) => {
        calls.create += 1;
        const idempotencyKey = options.idempotencyKey || null;
        if (idempotencyKey && idempotencyStore.has(idempotencyKey)) {
          return { ...idempotencyStore.get(idempotencyKey) };
        }
        const id = `pi_test_${++seq}`;
        calls.uniqueCreated += 1;
        const pi = {
          id,
          client_secret: `cs_secret_${id}`,
          amount: payload.amount,
          currency: payload.currency,
          metadata: { ...(payload.metadata || {}) },
          status: 'requires_payment_method',
          idempotencyKey
        };
        store.set(id, pi);
        if (idempotencyKey) {
          idempotencyStore.set(idempotencyKey, pi);
        }
        return pi;
      },
      retrieve: async (id) => {
        calls.retrieve += 1;
        const pi = store.get(String(id));
        if (!pi) {
          const err = new Error(`No such payment_intent: ${id}`);
          err.code = 'resource_missing';
          throw err;
        }
        return { ...pi };
      },
      cancel: async (id) => {
        calls.cancel += 1;
        const pi = store.get(String(id));
        if (pi) {
          pi.status = 'canceled';
        }
        return pi;
      },
      update: async (id, patch) => {
        calls.update += 1;
        const pi = store.get(String(id));
        if (pi && patch?.metadata) {
          pi.metadata = { ...pi.metadata, ...patch.metadata };
        }
        return pi;
      }
    },
    __store: store,
    __idempotencyStore: idempotencyStore,
    __calls: calls,
    getIdempotencyKey(checkoutId, quoteSnapshotHash) {
      return buildPaymentIntentIdempotencyKey(checkoutId, quoteSnapshotHash);
    },
    setStatus(id, status) {
      const pi = store.get(String(id));
      if (pi) pi.status = status;
    }
  };

  return client;
}

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
    appliedPromoCode: '',
    promo: { snapshot: null },
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
    experienceKeys: [],
    transportMethod: '',
    romanticSetup: false,
    promoCode: '',
    voucherCode: '',
    guestEmail: 'guest@example.com',
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

test('creates PI for card-due session and stores canonicalPaymentIntentId', async () => {
  const stripe = createFakeStripe();
  const dto = await ensureCanonicalPaymentIntent({
    input: baseInput(),
    quote: buildFabricatedQuote(),
    stripe
  });

  assert.equal(stripe.__calls.create, 1);
  assert.equal(stripe.__calls.uniqueCreated, 1);
  assert.ok(dto.canonicalPaymentIntentId);
  assert.ok(dto.clientSecret);
  assert.equal(dto.sessionStatus, 'pi_active');
  assert.equal(dto.paymentStatus, 'unpaid');

  const stored = await CheckoutSession.findOne({ checkoutId: dto.checkoutId }).lean();
  assert.equal(stored.canonicalPaymentIntentId, dto.canonicalPaymentIntentId);
  assert.equal(stored.client_secret, undefined);
  assert.equal(stored.clientSecret, undefined);
});

test('same checkoutId and quote reuses existing PI', async () => {
  const stripe = createFakeStripe();
  const input = baseInput();
  const quote = buildFabricatedQuote();

  const first = await ensureCanonicalPaymentIntent({ input, quote, stripe });
  const second = await ensureCanonicalPaymentIntent({
    checkoutId: first.checkoutId,
    input,
    quote,
    stripe
  });

  assert.equal(stripe.__calls.create, 1);
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.canonicalPaymentIntentId, first.canonicalPaymentIntentId);
});

test('browser refresh does not create second PI', async () => {
  const stripe = createFakeStripe();
  const input = baseInput();
  const quote = buildFabricatedQuote();
  const first = await ensureCanonicalPaymentIntent({ input, quote, stripe });

  stripe.__calls.create = 0;
  const refresh = await ensureCanonicalPaymentIntent({
    checkoutId: first.checkoutId,
    input,
    quote,
    stripe
  });

  assert.equal(stripe.__calls.create, 0);
  assert.equal(refresh.canonicalPaymentIntentId, first.canonicalPaymentIntentId);
});

test('failed card retry reuses existing PI', async () => {
  const stripe = createFakeStripe();
  const dto = await ensureCanonicalPaymentIntent({
    input: baseInput(),
    quote: buildFabricatedQuote(),
    stripe
  });
  stripe.setStatus(dto.canonicalPaymentIntentId, 'requires_payment_method');
  stripe.__calls.create = 0;

  const retry = await ensureCanonicalPaymentIntent({
    checkoutId: dto.checkoutId,
    input: baseInput(),
    quote: buildFabricatedQuote(),
    stripe
  });

  assert.equal(stripe.__calls.create, 0);
  assert.equal(retry.canonicalPaymentIntentId, dto.canonicalPaymentIntentId);
});

test('retry with another card reuses same PI', async () => {
  const stripe = createFakeStripe();
  const dto = await ensureCanonicalPaymentIntent({
    input: baseInput(),
    quote: buildFabricatedQuote(),
    stripe
  });
  stripe.setStatus(dto.canonicalPaymentIntentId, 'requires_confirmation');
  stripe.__calls.create = 0;

  const retry = await ensureCanonicalPaymentIntent({
    checkoutId: dto.checkoutId,
    input: baseInput(),
    quote: buildFabricatedQuote(),
    stripe
  });

  assert.equal(stripe.__calls.create, 0);
  assert.equal(retry.canonicalPaymentIntentId, dto.canonicalPaymentIntentId);
});

test('promo hash change supersedes old PI and creates new PI', async () => {
  const stripe = createFakeStripe();
  const input = baseInput();
  const first = await ensureCanonicalPaymentIntent({
    input,
    quote: buildFabricatedQuote(),
    stripe
  });
  const oldPi = first.canonicalPaymentIntentId;

  const second = await ensureCanonicalPaymentIntent({
    checkoutId: first.checkoutId,
    input: baseInput({ promoCode: 'BIGGER' }),
    quote: buildFabricatedQuote({
      discountAmount: 50,
      totalPrice: 150,
      remainingDueCents: 15000
    }),
    stripe
  });

  assert.equal(stripe.__calls.uniqueCreated, 2);
  assert.notEqual(second.canonicalPaymentIntentId, oldPi);
  const keys = [...stripe.__idempotencyStore.keys()];
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
  assert.ok(second.supersededPaymentIntentIds.includes(oldPi));
  const stored = await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean();
  const supersededCount = stored.supersededPaymentIntentIds.filter((id) => id === oldPi).length;
  assert.equal(supersededCount, 1);
});

test('voucher amount change supersedes old PI', async () => {
  const stripe = createFakeStripe();
  const redemptionId = new mongoose.Types.ObjectId();
  const voucherAdapter = async () => ({
    redemptionId: String(redemptionId),
    voucherAppliedCents: 5000,
    remainingDueCents: 13000,
    fullVoucherCoverage: false
  });
  const attachCalls = [];
  const attachPaymentIntent = async (payload) => {
    attachCalls.push(payload);
  };

  const first = await ensureCanonicalPaymentIntent({
    input: baseInput({ voucherCode: 'GIFT' }),
    quote: buildFabricatedQuote({
      voucherAppliedCents: 5000,
      remainingDueCents: 13000
    }),
    stripe,
    voucherAdapter,
    attachPaymentIntent
  });

  const second = await ensureCanonicalPaymentIntent({
    checkoutId: first.checkoutId,
    input: baseInput({ voucherCode: 'GIFT' }),
    quote: buildFabricatedQuote({
      voucherAppliedCents: 8000,
      remainingDueCents: 10000
    }),
    stripe,
    voucherAdapter,
    attachPaymentIntent
  });

  assert.equal(stripe.__calls.uniqueCreated, 2);
  assert.notEqual(second.canonicalPaymentIntentId, first.canonicalPaymentIntentId);
  assert.ok(second.supersededPaymentIntentIds.includes(first.canonicalPaymentIntentId));
});

test('partial voucher plus card creates one PI for remainder', async () => {
  const stripe = createFakeStripe();
  const redemptionId = new mongoose.Types.ObjectId();
  const attachCalls = [];
  const dto = await ensureCanonicalPaymentIntent({
    input: baseInput({ voucherCode: 'GIFT' }),
    quote: buildFabricatedQuote({
      voucherAppliedCents: 5000,
      remainingDueCents: 13000
    }),
    stripe,
    voucherAdapter: async () => ({
      redemptionId: String(redemptionId),
      voucherAppliedCents: 5000,
      remainingDueCents: 13000,
      fullVoucherCoverage: false
    }),
    attachPaymentIntent: async (payload) => {
      attachCalls.push(payload);
    }
  });

  assert.equal(stripe.__calls.create, 1);
  assert.equal(dto.stripeAmountCents, 13000);
  const pi = stripe.__store.get(dto.canonicalPaymentIntentId);
  assert.equal(pi.amount, 13000);
  assert.equal(attachCalls.length, 1);
  assert.equal(attachCalls[0].paymentIntentId, dto.canonicalPaymentIntentId);
  assert.equal(String(attachCalls[0].redemptionId), String(redemptionId));
});

test('full voucher creates no PI and supersedes old canonical PI', async () => {
  const stripe = createFakeStripe();
  const { session } = await createCheckoutSession({
    input: baseInput(),
    quote: buildFabricatedQuote()
  });
  session.canonicalPaymentIntentId = 'pi_old_full_voucher';
  session.status = 'pi_active';
  await session.save();
  stripe.__store.set('pi_old_full_voucher', {
    id: 'pi_old_full_voucher',
    client_secret: 'cs_old',
    amount: 18000,
    status: 'requires_payment_method',
    metadata: {}
  });

  const dto = await ensureCanonicalPaymentIntent({
    checkoutId: session.checkoutId,
    input: baseInput({ voucherCode: 'GIFT' }),
    quote: buildFabricatedQuote({
      totalPrice: 50,
      voucherAppliedCents: 5000,
      remainingDueCents: 0,
      fullVoucherCoverage: true
    }),
    stripe,
    voucherAdapter: async () => ({
      redemptionId: String(new mongoose.Types.ObjectId()),
      voucherAppliedCents: 5000,
      remainingDueCents: 0,
      fullVoucherCoverage: true
    })
  });

  assert.equal(dto.noPaymentRequired, true);
  assert.equal(dto.sessionStatus, 'voucher_only_reserved');
  assert.equal(dto.canonicalPaymentIntentId, null);
  assert.equal(stripe.__calls.create, 0);
  assert.ok(dto.supersededPaymentIntentIds.includes('pi_old_full_voucher'));
});

test('zero-due promo creates no PI', async () => {
  const stripe = createFakeStripe();
  const dto = await ensureCanonicalPaymentIntent({
    input: baseInput({ promoCode: 'FREE100' }),
    quote: buildFabricatedQuote({
      totalPrice: 0,
      remainingDueCents: 0,
      fullVoucherCoverage: false
    }),
    stripe
  });

  assert.equal(dto.noPaymentRequired, true);
  assert.equal(dto.sessionStatus, 'payment_not_required');
  assert.equal(dto.paymentStatus, 'not_required');
  assert.equal(dto.canonicalPaymentIntentId, null);
  assert.equal(stripe.__calls.create, 0);
});

test('assertCanonicalPaymentIntentForSession rejects superseded PI', async () => {
  const stripe = createFakeStripe();
  const dto = await ensureCanonicalPaymentIntent({
    input: baseInput(),
    quote: buildFabricatedQuote(),
    stripe
  });

  const session = await CheckoutSession.findOne({ checkoutId: dto.checkoutId });
  session.supersededPaymentIntentIds = [dto.canonicalPaymentIntentId];
  session.canonicalPaymentIntentId = 'pi_new_canonical';
  await session.save();

  await assert.rejects(
    () =>
      assertCanonicalPaymentIntentForSession({
        checkoutId: dto.checkoutId,
        paymentIntentId: dto.canonicalPaymentIntentId
      }),
    (err) =>
      err instanceof CheckoutSessionError &&
      err.code === CHECKOUT_SESSION_ERROR_CODES.SUPERSEDED_PAYMENT_INTENT
  );
});

test('assertCanonicalPaymentIntentForSession rejects wrong PI', async () => {
  const stripe = createFakeStripe();
  const dto = await ensureCanonicalPaymentIntent({
    input: baseInput(),
    quote: buildFabricatedQuote(),
    stripe
  });

  await assert.rejects(
    () =>
      assertCanonicalPaymentIntentForSession({
        checkoutId: dto.checkoutId,
        paymentIntentId: 'pi_wrong_id'
      }),
    (err) =>
      err instanceof CheckoutSessionError &&
      err.code === CHECKOUT_SESSION_ERROR_CODES.CANONICAL_PAYMENT_INTENT_MISMATCH
  );
});

test('assertCanonicalPaymentIntentForSession accepts canonical PI', async () => {
  const stripe = createFakeStripe();
  const dto = await ensureCanonicalPaymentIntent({
    input: baseInput(),
    quote: buildFabricatedQuote(),
    stripe
  });

  const result = await assertCanonicalPaymentIntentForSession({
    checkoutId: dto.checkoutId,
    paymentIntentId: dto.canonicalPaymentIntentId
  });
  assert.equal(result.ok, true);
  assert.equal(result.canonicalPaymentIntentId, dto.canonicalPaymentIntentId);
});

test('succeeded old PI is superseded without cancel', async () => {
  const stripe = createFakeStripe();
  const { session } = await createCheckoutSession({
    input: baseInput(),
    quote: buildFabricatedQuote()
  });
  session.canonicalPaymentIntentId = 'pi_succeeded_old';
  await session.save();
  stripe.__store.set('pi_succeeded_old', {
    id: 'pi_succeeded_old',
    client_secret: 'cs_succeeded',
    amount: 18000,
    status: 'succeeded',
    metadata: {}
  });

  const result = await supersedeCanonicalPaymentIntent({
    session,
    reason: 'test',
    stripe
  });

  assert.equal(result.supersededPaymentIntentId, 'pi_succeeded_old');
  assert.equal(result.cancelAttempted, false);
  assert.equal(stripe.__calls.cancel, 0);
  assert.equal(session.canonicalPaymentIntentId, null);
  assert.ok(session.supersededPaymentIntentIds.includes('pi_succeeded_old'));
});

test('idempotency key is stable for same checkoutId and quoteSnapshotHash', async () => {
  const input = baseInput();
  const quote = buildFabricatedQuote();
  const normalized = normalizeCheckoutSessionInput(input);
  const snapshot = buildQuoteSnapshot({ normalizedInput: normalized, quote });
  const hash = hashQuoteSnapshot(snapshot);
  const checkoutId = 'chk-idem-001';

  const keyA = buildPaymentIntentIdempotencyKey(checkoutId, hash);
  const keyB = buildPaymentIntentIdempotencyKey(checkoutId, hash);
  assert.equal(keyA, keyB);
  assert.equal(keyA, `checkout-session:${checkoutId}:pi:${hash}`);

  const changedSnapshot = buildQuoteSnapshot({
    normalizedInput: normalizeCheckoutSessionInput(baseInput({ promoCode: 'OTHER' })),
    quote: buildFabricatedQuote({ totalPrice: 150, remainingDueCents: 15000 })
  });
  const changedHash = hashQuoteSnapshot(changedSnapshot);
  const keyC = buildPaymentIntentIdempotencyKey(checkoutId, changedHash);
  assert.notEqual(keyA, keyC);
});

test('concurrent same checkoutId and quote hash creates one unique Stripe PI', async () => {
  const stripe = createFakeStripe();
  const { session } = await createCheckoutSession({
    input: baseInput(),
    quote: buildFabricatedQuote()
  });

  const input = baseInput();
  const quote = buildFabricatedQuote();
  const hash = session.quoteSnapshotHash;
  const expectedKey = buildPaymentIntentIdempotencyKey(session.checkoutId, hash);

  const [a, b] = await Promise.all([
    ensureCanonicalPaymentIntent({ checkoutId: session.checkoutId, input, quote, stripe }),
    ensureCanonicalPaymentIntent({ checkoutId: session.checkoutId, input, quote, stripe })
  ]);

  assert.equal(a.canonicalPaymentIntentId, b.canonicalPaymentIntentId);
  assert.ok(a.canonicalPaymentIntentId);
  assert.equal(stripe.__calls.uniqueCreated, 1);
  assert.ok(stripe.__idempotencyStore.has(expectedKey));
  assert.equal(stripe.__idempotencyStore.get(expectedKey).id, a.canonicalPaymentIntentId);

  const stored = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
  assert.equal(stored.canonicalPaymentIntentId, a.canonicalPaymentIntentId);

  const allPiIds = [...stripe.__store.keys()];
  const unclaimed = allPiIds.filter((id) => id !== stored.canonicalPaymentIntentId);
  assert.deepEqual(unclaimed, []);
});

test('claim loses with different created PI cancels orphan and reuses winner', async () => {
  const stripe = createFakeStripe();
  const input = baseInput();
  const quote = buildFabricatedQuote();
  const { session: created } = await createCheckoutSession({ input, quote });
  const winnerDto = await ensureCanonicalPaymentIntent({
    checkoutId: created.checkoutId,
    input,
    quote,
    stripe
  });
  const piBId = winnerDto.canonicalPaymentIntentId;
  assert.ok(piBId);

  const session = await loadSessionOrThrow(created.checkoutId);
  const piA = await stripe.paymentIntents.create(
    {
      amount: session.stripeAmountCents,
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      metadata: { checkoutId: session.checkoutId, quoteSnapshotHash: session.quoteSnapshotHash }
    },
    { idempotencyKey: `test-orphan-a:${session.checkoutId}` }
  );
  assert.notEqual(piA.id, piBId);

  const cancelCallsBefore = stripe.__calls.cancel;
  const claimResult = await claimCreatedPaymentIntentOrReuseWinner({
    session,
    stripe,
    pi: piA,
    versionForClaim: session.sessionVersion,
    redemptionId: null,
    attachPaymentIntent: null
  });

  assert.equal(claimResult.pi.id, piBId);
  assert.equal(claimResult.idempotentReplay, true);
  assert.equal(String(claimResult.session.canonicalPaymentIntentId), piBId);
  assert.notEqual(String(claimResult.session.canonicalPaymentIntentId), piA.id);

  assert.ok(stripe.__calls.cancel > cancelCallsBefore);
  assert.equal(stripe.__store.get(piA.id).status, 'canceled');

  const stored = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
  assert.equal(stored.canonicalPaymentIntentId, piBId);
  const supersededA = (stored.supersededPaymentIntentIds || []).filter((id) => id === piA.id);
  assert.equal(supersededA.length, 0);
});

test('claim loses with different created PI does not attach orphan to voucher', async () => {
  const stripe = createFakeStripe();
  const redemptionId = new mongoose.Types.ObjectId();
  const attachCalls = [];
  const attachPaymentIntent = async (payload) => {
    attachCalls.push(payload);
  };
  const input = baseInput({ voucherCode: 'GIFT' });
  const quote = buildFabricatedQuote({
    voucherAppliedCents: 5000,
    remainingDueCents: 13000
  });
  const voucherAdapter = async () => ({
    redemptionId: String(redemptionId),
    voucherAppliedCents: 5000,
    remainingDueCents: 13000,
    fullVoucherCoverage: false
  });

  const { session: created } = await createCheckoutSession({ input, quote });
  const winnerDto = await ensureCanonicalPaymentIntent({
    checkoutId: created.checkoutId,
    input,
    quote,
    stripe,
    voucherAdapter,
    attachPaymentIntent
  });
  const piBId = winnerDto.canonicalPaymentIntentId;
  attachCalls.length = 0;

  const session = await loadSessionOrThrow(created.checkoutId);
  const piA = await stripe.paymentIntents.create(
    {
      amount: session.stripeAmountCents,
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      metadata: { checkoutId: session.checkoutId, quoteSnapshotHash: session.quoteSnapshotHash }
    },
    { idempotencyKey: `test-orphan-voucher-a:${session.checkoutId}` }
  );
  assert.notEqual(piA.id, piBId);

  const claimResult = await claimCreatedPaymentIntentOrReuseWinner({
    session,
    stripe,
    pi: piA,
    versionForClaim: session.sessionVersion,
    redemptionId: String(redemptionId),
    attachPaymentIntent
  });

  assert.equal(claimResult.pi.id, piBId);
  assert.ok(attachCalls.every((call) => call.paymentIntentId !== piA.id));
  assert.equal(attachCalls.length, 1);
  assert.equal(attachCalls[0].paymentIntentId, piBId);
});

test('claim loses with different non-cancellable PI records conflict state', async () => {
  const stripe = createFakeStripe();
  const input = baseInput();
  const quote = buildFabricatedQuote();
  const { session: created } = await createCheckoutSession({ input, quote });
  const winnerDto = await ensureCanonicalPaymentIntent({
    checkoutId: created.checkoutId,
    input,
    quote,
    stripe
  });
  const piBId = winnerDto.canonicalPaymentIntentId;
  assert.ok(piBId);

  const session = await loadSessionOrThrow(created.checkoutId);
  const piA = await stripe.paymentIntents.create(
    {
      amount: session.stripeAmountCents,
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      metadata: { checkoutId: session.checkoutId }
    },
    { idempotencyKey: `test-orphan-noncancel:${session.checkoutId}` }
  );
  stripe.setStatus(piA.id, 'succeeded');
  assert.notEqual(piA.id, piBId);

  let claimResult;
  let conflictError = null;
  try {
    claimResult = await claimCreatedPaymentIntentOrReuseWinner({
      session,
      stripe,
      pi: piA,
      versionForClaim: session.sessionVersion,
      redemptionId: null,
      attachPaymentIntent: null
    });
  } catch (err) {
    if (err instanceof CheckoutSessionError
      && err.code === CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_CONCURRENCY_CONFLICT) {
      conflictError = err;
    } else {
      throw err;
    }
  }

  const stored = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
  assert.equal(stored.canonicalPaymentIntentId, piBId);

  const supersededA = (stored.supersededPaymentIntentIds || []).filter((id) => id === piA.id);

  if (conflictError) {
    assert.equal(conflictError.details?.winnerCanonicalPaymentIntentId, piBId);
    assert.equal(conflictError.details?.createdPaymentIntentId, piA.id);
    assert.ok(
      supersededA.length === 1 || supersededA.length === 0,
      'PI A recorded in superseded or surfaced via conflict'
    );
    return;
  }

  assert.equal(claimResult.pi.id, piBId);
  assert.equal(claimResult.idempotentReplay, true);
  assert.equal(supersededA.length, 1);
  assert.equal(stripe.__calls.cancel, 0);
});

test('claim loses with non-cancellable orphan does not attach orphan to voucher', async () => {
  const stripe = createFakeStripe();
  const redemptionId = new mongoose.Types.ObjectId();
  const attachCalls = [];
  const attachPaymentIntent = async (payload) => {
    attachCalls.push(payload);
  };
  const input = baseInput({ voucherCode: 'GIFT' });
  const quote = buildFabricatedQuote({
    voucherAppliedCents: 5000,
    remainingDueCents: 13000
  });
  const voucherAdapter = async () => ({
    redemptionId: String(redemptionId),
    voucherAppliedCents: 5000,
    remainingDueCents: 13000,
    fullVoucherCoverage: false
  });

  const { session: created } = await createCheckoutSession({ input, quote });
  const winnerDto = await ensureCanonicalPaymentIntent({
    checkoutId: created.checkoutId,
    input,
    quote,
    stripe,
    voucherAdapter,
    attachPaymentIntent
  });
  const piBId = winnerDto.canonicalPaymentIntentId;
  attachCalls.length = 0;

  const session = await loadSessionOrThrow(created.checkoutId);
  const piA = await stripe.paymentIntents.create(
    {
      amount: session.stripeAmountCents,
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      metadata: { checkoutId: session.checkoutId }
    },
    { idempotencyKey: `test-orphan-voucher-noncancel:${session.checkoutId}` }
  );
  stripe.setStatus(piA.id, 'succeeded');
  assert.notEqual(piA.id, piBId);

  const claimResult = await claimCreatedPaymentIntentOrReuseWinner({
    session,
    stripe,
    pi: piA,
    versionForClaim: session.sessionVersion,
    redemptionId: String(redemptionId),
    attachPaymentIntent
  });

  assert.equal(claimResult.pi.id, piBId);
  assert.ok(attachCalls.every((call) => call.paymentIntentId !== piA.id));
  if (attachCalls.length > 0) {
    assert.equal(attachCalls[0].paymentIntentId, piBId);
  }
  const stored = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
  assert.equal(stored.canonicalPaymentIntentId, piBId);
  const supersededA = (stored.supersededPaymentIntentIds || []).filter((id) => id === piA.id);
  assert.equal(supersededA.length, 1);
});

test('voucher attach failure throws VOUCHER_PAYMENT_INTENT_ATTACH_FAILED', async () => {
  const stripe = createFakeStripe();
  const redemptionId = new mongoose.Types.ObjectId();

  await assert.rejects(
    () =>
      ensureCanonicalPaymentIntent({
        input: baseInput({ voucherCode: 'GIFT' }),
        quote: buildFabricatedQuote({
          voucherAppliedCents: 5000,
          remainingDueCents: 13000
        }),
        stripe,
        voucherAdapter: async () => ({
          redemptionId: String(redemptionId),
          voucherAppliedCents: 5000,
          remainingDueCents: 13000,
          fullVoucherCoverage: false
        }),
        attachPaymentIntent: async () => {
          throw new Error('attach failed');
        }
      }),
    (err) =>
      err instanceof CheckoutSessionError &&
      err.code === CHECKOUT_SESSION_ERROR_CODES.VOUCHER_PAYMENT_INTENT_ATTACH_FAILED
  );
});

test('retry after voucher attach failure reuses canonical PI and attaches it', async () => {
  const stripe = createFakeStripe();
  const redemptionId = new mongoose.Types.ObjectId();
  const input = baseInput({ voucherCode: 'GIFT' });
  const quote = buildFabricatedQuote({
    voucherAppliedCents: 5000,
    remainingDueCents: 13000
  });
  const voucherAdapter = async () => ({
    redemptionId: String(redemptionId),
    voucherAppliedCents: 5000,
    remainingDueCents: 13000,
    fullVoucherCoverage: false
  });
  const attachCalls = [];
  let attachFailsOnce = true;
  const attachPaymentIntent = async (payload) => {
    attachCalls.push(payload);
    if (attachFailsOnce) {
      attachFailsOnce = false;
      throw new Error('attach failed');
    }
  };

  await assert.rejects(
    () =>
      ensureCanonicalPaymentIntent({
        input,
        quote,
        stripe,
        voucherAdapter,
        attachPaymentIntent
      }),
    (err) =>
      err instanceof CheckoutSessionError &&
      err.code === CHECKOUT_SESSION_ERROR_CODES.VOUCHER_PAYMENT_INTENT_ATTACH_FAILED
  );

  assert.equal(stripe.__calls.uniqueCreated, 1);
  assert.equal(attachCalls.length, 1);

  const storedAfterFail = await CheckoutSession.findOne({}).sort({ createdAt: -1 }).lean();
  assert.ok(storedAfterFail?.canonicalPaymentIntentId);
  assert.equal(attachCalls[0].paymentIntentId, storedAfterFail.canonicalPaymentIntentId);
  assert.equal(storedAfterFail.client_secret, undefined);
  assert.equal(storedAfterFail.clientSecret, undefined);

  const retry = await ensureCanonicalPaymentIntent({
    checkoutId: storedAfterFail.checkoutId,
    input,
    quote,
    stripe,
    voucherAdapter,
    attachPaymentIntent
  });

  assert.equal(retry.canonicalPaymentIntentId, storedAfterFail.canonicalPaymentIntentId);
  assert.equal(retry.idempotentReplay, true);
  assert.equal(stripe.__calls.uniqueCreated, 1);
  assert.equal(stripe.__calls.create, 1);
  assert.equal(attachCalls.length, 2);
  assert.equal(attachCalls[1].paymentIntentId, storedAfterFail.canonicalPaymentIntentId);
  assert.ok(attachCalls.every((call) => call.paymentIntentId === storedAfterFail.canonicalPaymentIntentId));

  const storedAfterRetry = await CheckoutSession.findOne({
    checkoutId: storedAfterFail.checkoutId
  }).lean();
  assert.equal(storedAfterRetry.canonicalPaymentIntentId, storedAfterFail.canonicalPaymentIntentId);
  assert.deepEqual(storedAfterRetry.supersededPaymentIntentIds || [], []);
  assert.equal(storedAfterRetry.client_secret, undefined);
});

test('claimCanonicalPaymentIntent increments sessionVersion', async () => {
  const stripe = createFakeStripe();
  const input = baseInput();
  const quote = buildFabricatedQuote();
  const { session } = await createCheckoutSession({ input, quote });
  const versionBefore = session.sessionVersion;

  const pi = await stripe.paymentIntents.create(
    {
      amount: session.stripeAmountCents,
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      metadata: {}
    },
    { idempotencyKey: `test-version-inc:${session.checkoutId}` }
  );

  const claimed = await claimCanonicalPaymentIntent({
    checkoutId: session.checkoutId,
    expectedSessionVersion: versionBefore,
    paymentIntentId: pi.id
  });

  assert.ok(claimed);
  assert.equal(claimed.sessionVersion, versionBefore + 1);
  assert.equal(claimed.canonicalPaymentIntentId, pi.id);
});
