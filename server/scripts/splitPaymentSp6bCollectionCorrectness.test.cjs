/**
 * SP6B — collection correctness: authoritative retry exhaustion, InvoicePayment
 * provenance, crash/idempotency, ledger settlement vs card PI.
 * Run: cd server && NODE_PATH="" node --test --test-concurrency=1 scripts/splitPaymentSp6bCollectionCorrectness.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const BookingInstallment = require('../models/BookingInstallment');
const Payment = require('../models/Payment');
const EmailDeliveryState = require('../models/EmailDeliveryState');
const {
  RETRY_EXHAUSTED_GRACE_DAYS,
  RETRY_STATE_STABILIZATION_MS
} = require('../config/splitPaymentCollectionConfig');
const {
  buildInvoiceIdempotencyKey,
  provisionInstallmentInvoice,
  claimInstallmentForProvisioning,
  PROVISION_CODES,
  SplitInvoiceProvisioningError
} = require('../services/splitPaymentInvoiceProvisioningService');
const {
  processSplitInstallmentInvoiceEvent,
  invoiceProviderReference
} = require('../services/splitPaymentInvoiceWebhookService');
const {
  applyReplacementCardFromPaidInvoice,
  resolveInvoicePaymentProvenance
} = require('../services/splitPaymentReplacementCardService');
const {
  reconcileRetryExhaustionForInstallment,
  openCancellationReviewIfGraceExpired,
  clearGraceOnPaid
} = require('../services/splitPaymentGraceService');
const emailService = require('../services/emailService');

let mongoServer;
const ENTITY_ID = new mongoose.Types.ObjectId();

function futureDue(daysFromNow) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

async function makeBooking(overrides = {}) {
  return Booking.create({
    checkIn: new Date('2026-12-20'),
    checkOut: new Date('2026-12-22'),
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: '+359888'
    },
    totalPrice: 500,
    stripePaidAmountCents: 20000,
    totalValueCents: 50000,
    paymentSettlementStatus: 'partially_paid',
    chosenPaymentScheduleSnapshot: {
      totalCents: 50000,
      currency: 'EUR',
      installments: [
        { sequence: 1, amountCents: 20000, dueAtDateOnly: '2026-10-01' },
        { sequence: 2, amountCents: 30000, dueAtDateOnly: futureDue(20) }
      ]
    },
    chosenPaymentScheduleSnapshotHash: 'schedhash',
    stripePaymentIntentId: `pi_initial_${new mongoose.Types.ObjectId().toString()}`,
    stripeCustomerId: 'cus_expected',
    stripeReusablePaymentMethodId: 'pm_card_1',
    cabinId: ENTITY_ID,
    status: 'confirmed',
    checkoutId: `chk_sp6b_${new mongoose.Types.ObjectId().toString()}`,
    legalAcceptance: {
      termsVersion: '1',
      activityRiskVersion: '1',
      acceptedAt: new Date(),
      firstName: 'Ada',
      lastName: 'Lovelace'
    },
    ...overrides
  });
}

async function makeFutureInstallment(booking, overrides = {}) {
  return BookingInstallment.create({
    bookingId: booking._id,
    checkoutSessionId: booking.checkoutId,
    sequence: 2,
    amountCents: 30000,
    currency: 'EUR',
    amountType: 'remainder',
    dueRule: 'days_before_arrival',
    dueOffsetDays: 30,
    dueAtDateOnly: futureDue(20),
    cancellationTreatment: 'standard_policy',
    status: 'scheduled',
    provisioningState: 'unprovisioned',
    ...overrides
  });
}

/**
 * Stripe mock with real idempotency-key replay for create/item.
 */
function mockStripeIdempotent({ invoiceId = 'in_1', itemId = 'ii_1' } = {}) {
  const store = {
    invoices: {},
    items: {},
    creates: 0,
    itemCreates: 0,
    updates: 0,
    idempotency: {},
    invoicePayments: [],
    retrieveCount: 0
  };

  function invoiceBase(overrides = {}) {
    return {
      id: invoiceId,
      object: 'invoice',
      status: 'draft',
      customer: 'cus_expected',
      default_payment_method: 'pm_card_1',
      currency: 'eur',
      amount_due: 30000,
      total: 30000,
      amount_paid: 0,
      amount_remaining: 30000,
      metadata: {},
      lines: { data: [{ id: itemId, amount: 30000 }], total_count: 1 },
      auto_advance: false,
      next_payment_attempt: null,
      attempt_count: 0,
      ...overrides
    };
  }

  return {
    store,
    invoices: {
      create: async (params, opts) => {
        const key = opts?.idempotencyKey;
        if (key && store.idempotency[key]) {
          store.creates += 1;
          store.lastCreateOpts = opts;
          return { ...store.idempotency[key] };
        }
        store.creates += 1;
        store.lastCreateOpts = opts;
        const inv = invoiceBase({
          metadata: params.metadata || {},
          customer: params.customer,
          default_payment_method: params.default_payment_method,
          currency: params.currency,
          amount_due: 0,
          total: 0,
          amount_remaining: 0
        });
        store.invoices[inv.id] = inv;
        if (key) store.idempotency[key] = { ...inv };
        return { ...inv };
      },
      retrieve: async (id) => {
        store.retrieveCount += 1;
        const inv = store.invoices[id];
        if (!inv) throw new Error('missing invoice');
        return {
          ...inv,
          lines: {
            data: Object.values(store.items).filter((i) => i.invoice === id),
            total_count: Object.values(store.items).filter((i) => i.invoice === id).length || 1
          }
        };
      },
      update: async (id, params, opts) => {
        store.updates += 1;
        store.lastUpdateOpts = opts;
        const inv = store.invoices[id];
        Object.assign(inv, params);
        return { ...inv };
      }
    },
    invoiceItems: {
      create: async (params, opts) => {
        const key = opts?.idempotencyKey;
        if (key && store.idempotency[key]) {
          store.itemCreates += 1;
          store.lastItemOpts = opts;
          return { ...store.idempotency[key] };
        }
        store.itemCreates += 1;
        store.lastItemOpts = opts;
        const item = { id: itemId, ...params };
        store.items[item.id] = item;
        const inv = store.invoices[params.invoice];
        if (inv) {
          inv.amount_due = params.amount;
          inv.total = params.amount;
          inv.amount_remaining = params.amount;
          inv.metadata = params.metadata || inv.metadata;
        }
        if (key) store.idempotency[key] = { ...item };
        return { ...item };
      }
    },
    invoicePayments: {
      list: async (params) => {
        const rows = store.invoicePayments.filter((p) => {
          if (params.invoice && String(p.invoice) !== String(params.invoice)) return false;
          if (params.status && String(p.status) !== String(params.status)) return false;
          return true;
        });
        return { data: rows };
      }
    },
    paymentIntents: {
      retrieve: async (id) => {
        if (store.paymentIntents?.[id]) return store.paymentIntents[id];
        return {
          id,
          status: 'succeeded',
          customer: 'cus_expected',
          payment_method: {
            id: 'pm_card_2',
            type: 'card',
            customer: 'cus_expected'
          }
        };
      }
    },
    paymentMethods: {
      retrieve: async (id) => ({ id, type: 'card', customer: 'cus_expected' })
    }
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await Booking.syncIndexes();
  await BookingInstallment.syncIndexes();
  await Payment.syncIndexes();
  await EmailDeliveryState.syncIndexes();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Booking.deleteMany({});
  await BookingInstallment.deleteMany({});
  await Payment.deleteMany({});
  await EmailDeliveryState.deleteMany({});
});

test('stabilization interval is centralized and conservative', () => {
  assert.equal(RETRY_EXHAUSTED_GRACE_DAYS, 7);
  assert.equal(RETRY_STATE_STABILIZATION_MS, 5 * 60 * 1000);
});

// ——— Crash / idempotency ———

test('INVOICE CREATE CRASH: same idempotency key recovers single commercial invoice', async () => {
  const booking = await makeBooking();
  const inst = await makeFutureInstallment(booking);
  const stripe = mockStripeIdempotent({ invoiceId: 'in_crash_create' });

  const createKey = buildInvoiceIdempotencyKey(booking._id, 2, 'create');
  const fullMeta = {
    purpose: 'split_installment_collection',
    bookingId: String(booking._id),
    checkoutSessionId: booking.checkoutId,
    installmentSequence: '2',
    installmentId: String(inst._id),
    scheduleHash: 'schedhash',
    expectedAmountCents: '30000',
    expectedCurrency: 'eur',
    dueAtDateOnly: inst.dueAtDateOnly
  };
  // 1) create succeeds with the same payload the worker would send
  const created = await stripe.invoices.create(
    {
      customer: 'cus_expected',
      currency: 'eur',
      default_payment_method: 'pm_card_1',
      metadata: fullMeta
    },
    { idempotencyKey: createKey }
  );
  assert.equal(created.id, 'in_crash_create');
  // 2) DB persist fails — no stripeInvoiceId stored
  assert.equal((await BookingInstallment.findById(inst._id)).stripeInvoiceId, null);

  // 3–6) worker runs again — same idempotency key returns same invoice
  const outcome = await provisionInstallmentInvoice({
    installment: await BookingInstallment.findById(inst._id),
    booking,
    stripe
  });
  assert.equal(outcome.skipped, false);
  assert.equal(outcome.invoice.id, 'in_crash_create');
  assert.equal(Object.keys(stripe.store.invoices).length, 1);
  const row = await BookingInstallment.findById(inst._id);
  assert.equal(row.stripeInvoiceId, 'in_crash_create');
  assert.equal(row.provisioningState, 'provisioned');
});

test('INVOICE ITEM CRASH: same item idempotency key recovers single line', async () => {
  const booking = await makeBooking();
  const inst = await makeFutureInstallment(booking);
  const stripe = mockStripeIdempotent({ invoiceId: 'in_item_crash', itemId: 'ii_only' });

  // Seed invoice id as if create persisted then crash before item id stored
  const inv = await stripe.invoices.create(
    {
      customer: 'cus_expected',
      currency: 'eur',
      default_payment_method: 'pm_card_1',
      metadata: {
        purpose: 'split_installment_collection',
        bookingId: String(booking._id),
        installmentSequence: '2',
        installmentId: String(inst._id),
        expectedAmountCents: '30000',
        expectedCurrency: 'eur',
        dueAtDateOnly: inst.dueAtDateOnly,
        scheduleHash: 'schedhash',
        checkoutSessionId: booking.checkoutId
      }
    },
    { idempotencyKey: buildInvoiceIdempotencyKey(booking._id, 2, 'create') }
  );
  // Attach item once then "lose" local item id
  await stripe.invoiceItems.create(
    {
      customer: 'cus_expected',
      invoice: inv.id,
      amount: 30000,
      currency: 'eur',
      metadata: inv.metadata
    },
    { idempotencyKey: buildInvoiceIdempotencyKey(booking._id, 2, 'item') }
  );
  await BookingInstallment.updateOne(
    { _id: inst._id },
    {
      $set: {
        stripeInvoiceId: inv.id,
        stripeInvoiceItemId: null,
        provisioningState: 'unprovisioned'
      }
    }
  );

  const outcome = await provisionInstallmentInvoice({
    installment: await BookingInstallment.findById(inst._id),
    booking,
    stripe
  });
  assert.equal(outcome.invoiceItem.id, 'ii_only');
  assert.equal(Object.keys(stripe.store.items).length, 1);
  const row = await BookingInstallment.findById(inst._id);
  assert.equal(row.stripeInvoiceItemId, 'ii_only');
  assert.equal(row.provisioningState, 'provisioned');
});

test('CONCURRENT CLAIM: CAS barrier allows only one provisioner', async () => {
  const booking = await makeBooking();
  const inst = await makeFutureInstallment(booking);
  const a = await claimInstallmentForProvisioning({
    installmentId: inst._id,
    workerId: 'worker-a'
  });
  const b = await claimInstallmentForProvisioning({
    installmentId: inst._id,
    workerId: 'worker-b'
  });
  assert.ok(a);
  assert.equal(a.provisioningClaimedBy, 'worker-a');
  assert.equal(b, null);
});

test('CONFLICT: wrong amount/customer/currency/metadata fails closed', async () => {
  const booking = await makeBooking();
  const inst = await makeFutureInstallment(booking, {
    stripeInvoiceId: 'in_bad',
    provisioningState: 'provisioned',
    automaticallyFinalizesAt: new Date()
  });
  const stripe = mockStripeIdempotent({ invoiceId: 'in_bad' });
  stripe.store.invoices.in_bad = {
    id: 'in_bad',
    object: 'invoice',
    status: 'draft',
    customer: 'cus_other',
    currency: 'usd',
    amount_due: 1,
    total: 1,
    metadata: { bookingId: 'other', installmentSequence: '9' },
    default_payment_method: 'pm_card_1',
    lines: { data: [{ amount: 1 }], total_count: 1 }
  };
  await assert.rejects(
    () =>
      provisionInstallmentInvoice({
        installment: inst,
        booking,
        stripe
      }),
    (err) => err instanceof SplitInvoiceProvisioningError && err.code === PROVISION_CODES.CONFLICT
  );
});

// ——— Retry exhaustion ———

function failEvent(booking, inst, invoiceOverrides = {}) {
  return {
    id: `evt_fail_${Math.random().toString(16).slice(2)}`,
    type: 'invoice.payment_failed',
    data: {
      object: {
        id: inst.stripeInvoiceId || 'in_fail',
        object: 'invoice',
        status: 'open',
        customer: 'cus_expected',
        currency: 'eur',
        amount_due: 30000,
        amount_remaining: 30000,
        total: 30000,
        attempt_count: 1,
        next_payment_attempt: null,
        hosted_invoice_url: 'https://invoice.stripe.com/i/recover',
        metadata: {
          purpose: 'split_installment_collection',
          bookingId: String(booking._id),
          installmentSequence: '2',
          installmentId: String(inst._id)
        },
        ...invoiceOverrides
      }
    }
  };
}

test('payment_failed WITH next attempt => no grace', async () => {
  const booking = await makeBooking();
  const inst = await makeFutureInstallment(booking, {
    stripeInvoiceId: 'in_fail_next',
    status: 'processing',
    provisioningState: 'provisioned'
  });
  emailService.sendEmail = async () => ({ messageId: 't' });
  const next = Math.floor(Date.now() / 1000) + 86400;
  const r = await processSplitInstallmentInvoiceEvent({
    event: failEvent(booking, inst, { id: 'in_fail_next', next_payment_attempt: next })
  });
  assert.equal(r.graceStarted, false);
  const row = await BookingInstallment.findById(inst._id);
  assert.equal(row.status, 'failed');
  assert.ok(row.nextPaymentAttemptAt);
  assert.equal(row.graceEndsAt, null);
  assert.notEqual(row.status, 'retry_exhausted');
});

test('payment_failed WITHOUT next attempt => no immediate grace', async () => {
  const booking = await makeBooking();
  const inst = await makeFutureInstallment(booking, {
    stripeInvoiceId: 'in_fail_none',
    status: 'processing',
    provisioningState: 'provisioned'
  });
  emailService.sendEmail = async () => ({ messageId: 't' });
  const r = await processSplitInstallmentInvoiceEvent({
    event: failEvent(booking, inst, { id: 'in_fail_none', next_payment_attempt: null })
  });
  assert.equal(r.graceStarted, false);
  const row = await BookingInstallment.findById(inst._id);
  assert.equal(row.status, 'failed');
  assert.equal(row.graceEndsAt, null);
  assert.notEqual(row.status, 'retry_exhausted');
  assert.ok(row.lastPaymentFailedAt);
  assert.ok(row.retryExhaustionCandidateObservedAt);
});

test('later invoice.updated WITH next attempt => no grace', async () => {
  const booking = await makeBooking();
  const inst = await makeFutureInstallment(booking, {
    stripeInvoiceId: 'in_upd',
    status: 'failed',
    provisioningState: 'provisioned',
    lastPaymentFailedAt: new Date(),
    retryExhaustionCandidateObservedAt: new Date(),
    nextPaymentAttemptAt: null
  });
  const next = Math.floor(Date.now() / 1000) + 3600;
  const r = await processSplitInstallmentInvoiceEvent({
    event: {
      id: 'evt_upd',
      type: 'invoice.updated',
      data: {
        object: {
          id: 'in_upd',
          object: 'invoice',
          status: 'open',
          customer: 'cus_expected',
          currency: 'eur',
          amount_due: 30000,
          total: 30000,
          attempt_count: 2,
          next_payment_attempt: next,
          metadata: {
            purpose: 'split_installment_collection',
            bookingId: String(booking._id),
            installmentSequence: '2',
            installmentId: String(inst._id)
          }
        }
      }
    }
  });
  assert.equal(r.graceStarted, false);
  const row = await BookingInstallment.findById(inst._id);
  assert.ok(row.nextPaymentAttemptAt);
  assert.equal(row.retryExhaustionCandidateObservedAt, null);
  assert.notEqual(row.status, 'retry_exhausted');
});

test('worker fresh retrieve WITH next attempt => no grace', async () => {
  const booking = await makeBooking();
  const observed = new Date(Date.now() - RETRY_STATE_STABILIZATION_MS - 1000);
  const inst = await makeFutureInstallment(booking, {
    stripeInvoiceId: 'in_w_next',
    status: 'failed',
    provisioningState: 'provisioned',
    lastPaymentFailedAt: observed,
    retryExhaustionCandidateObservedAt: observed,
    nextPaymentAttemptAt: null
  });
  const stripe = mockStripeIdempotent({ invoiceId: 'in_w_next' });
  stripe.store.invoices.in_w_next = {
    id: 'in_w_next',
    object: 'invoice',
    status: 'open',
    customer: 'cus_expected',
    currency: 'eur',
    amount_due: 30000,
    total: 30000,
    amount_remaining: 30000,
    attempt_count: 2,
    next_payment_attempt: Math.floor(Date.now() / 1000) + 86400,
    metadata: {
      purpose: 'split_installment_collection',
      bookingId: String(booking._id),
      installmentSequence: '2',
      installmentId: String(inst._id)
    }
  };
  const r = await reconcileRetryExhaustionForInstallment({
    installment: inst,
    booking,
    stripe,
    now: new Date()
  });
  assert.equal(r.outcome, 'retry_scheduled');
  assert.equal(r.graceStarted, false);
  const row = await BookingInstallment.findById(inst._id);
  assert.notEqual(row.status, 'retry_exhausted');
  assert.ok(row.nextPaymentAttemptAt);
});

test('worker retrieve without next BEFORE stabilization => no grace', async () => {
  const booking = await makeBooking();
  const observed = new Date(Date.now() - 60_000); // 1 min < 5 min
  const inst = await makeFutureInstallment(booking, {
    stripeInvoiceId: 'in_w_early',
    status: 'failed',
    provisioningState: 'provisioned',
    lastPaymentFailedAt: observed,
    retryExhaustionCandidateObservedAt: observed,
    nextPaymentAttemptAt: null
  });
  const stripe = mockStripeIdempotent({ invoiceId: 'in_w_early' });
  stripe.store.invoices.in_w_early = {
    id: 'in_w_early',
    object: 'invoice',
    status: 'open',
    customer: 'cus_expected',
    currency: 'eur',
    amount_due: 30000,
    total: 30000,
    amount_remaining: 30000,
    attempt_count: 3,
    next_payment_attempt: null,
    metadata: {
      purpose: 'split_installment_collection',
      bookingId: String(booking._id),
      installmentSequence: '2',
      installmentId: String(inst._id)
    }
  };
  const r = await reconcileRetryExhaustionForInstallment({
    installment: inst,
    booking,
    stripe,
    now: new Date()
  });
  assert.equal(r.outcome, 'stabilizing');
  assert.equal(r.graceStarted, false);
  const row = await BookingInstallment.findById(inst._id);
  assert.notEqual(row.status, 'retry_exhausted');
});

test('worker retrieve without next AFTER stabilization => retry_exhausted + 7-day grace', async () => {
  const booking = await makeBooking();
  const observed = new Date(Date.now() - RETRY_STATE_STABILIZATION_MS - 5000);
  const inst = await makeFutureInstallment(booking, {
    stripeInvoiceId: 'in_w_done',
    status: 'failed',
    provisioningState: 'provisioned',
    lastPaymentFailedAt: observed,
    retryExhaustionCandidateObservedAt: observed,
    nextPaymentAttemptAt: null
  });
  const stripe = mockStripeIdempotent({ invoiceId: 'in_w_done' });
  const meta = {
    purpose: 'split_installment_collection',
    bookingId: String(booking._id),
    installmentSequence: '2',
    installmentId: String(inst._id)
  };
  stripe.store.invoices.in_w_done = {
    id: 'in_w_done',
    object: 'invoice',
    status: 'open',
    customer: 'cus_expected',
    currency: 'eur',
    amount_due: 30000,
    total: 30000,
    amount_remaining: 30000,
    attempt_count: 4,
    next_payment_attempt: null,
    metadata: meta
  };
  const now = new Date();
  const r = await reconcileRetryExhaustionForInstallment({
    installment: inst,
    booking,
    stripe,
    now
  });
  assert.equal(r.outcome, 'retry_exhausted');
  assert.equal(r.graceStarted, true);
  const row = await BookingInstallment.findById(inst._id);
  assert.equal(row.status, 'retry_exhausted');
  assert.ok(row.graceEndsAt);
  const delta = row.graceEndsAt.getTime() - now.getTime();
  assert.ok(Math.abs(delta - RETRY_EXHAUSTED_GRACE_DAYS * 86400000) < 5000);
});

test('paid before/during stabilization => paid, no grace', async () => {
  const booking = await makeBooking();
  const observed = new Date(Date.now() - 60_000);
  const inst = await makeFutureInstallment(booking, {
    stripeInvoiceId: 'in_paid_stab',
    status: 'failed',
    provisioningState: 'provisioned',
    lastPaymentFailedAt: observed,
    retryExhaustionCandidateObservedAt: observed
  });
  await BookingInstallment.updateOne({ _id: inst._id }, { $set: { status: 'paid', paidAt: new Date() } });
  const stripe = mockStripeIdempotent({ invoiceId: 'in_paid_stab' });
  stripe.store.invoices.in_paid_stab = {
    id: 'in_paid_stab',
    status: 'paid',
    customer: 'cus_expected',
    currency: 'eur',
    amount_paid: 30000,
    amount_due: 0,
    metadata: {
      bookingId: String(booking._id),
      installmentSequence: '2',
      installmentId: String(inst._id)
    }
  };
  const r = await reconcileRetryExhaustionForInstallment({
    installment: await BookingInstallment.findById(inst._id),
    booking,
    stripe,
    now: new Date()
  });
  assert.equal(r.outcome, 'paid');
  const row = await BookingInstallment.findById(inst._id);
  assert.equal(row.status, 'paid');
  assert.equal(row.graceEndsAt, null);
});

test('paid during grace => grace cleared/resolved; stale events cannot regress', async () => {
  const booking = await makeBooking();
  const inst = await makeFutureInstallment(booking, {
    stripeInvoiceId: 'in_grace_pay',
    status: 'retry_exhausted',
    provisioningState: 'provisioned',
    graceEndsAt: new Date(Date.now() + 86400000),
    lastPaymentFailedAt: new Date()
  });
  await Booking.updateOne(
    { _id: booking._id },
    {
      $set: {
        cancellationReview: {
          status: 'open',
          reason: 'unpaid_split_installment',
          installmentSequence: 2,
          installmentId: inst._id,
          openedAt: new Date()
        }
      }
    }
  );
  const stripe = mockStripeIdempotent({ invoiceId: 'in_grace_pay' });
  stripe.store.invoicePayments = [
    {
      id: 'inpay_1',
      object: 'invoice_payment',
      status: 'paid',
      invoice: 'in_grace_pay',
      payment: { type: 'payment_intent', payment_intent: 'pi_ok' }
    }
  ];
  stripe.store.paymentIntents = {
    pi_ok: {
      id: 'pi_ok',
      status: 'succeeded',
      customer: 'cus_expected',
      payment_method: { id: 'pm_card_2', type: 'card', customer: 'cus_expected' }
    }
  };
  await processSplitInstallmentInvoiceEvent({
    event: {
      id: 'evt_pay_grace',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_grace_pay',
          object: 'invoice',
          status: 'paid',
          customer: 'cus_expected',
          currency: 'eur',
          amount_paid: 30000,
          total: 30000,
          metadata: {
            purpose: 'split_installment_collection',
            bookingId: String(booking._id),
            installmentSequence: '2',
            installmentId: String(inst._id)
          }
        }
      }
    },
    stripe
  });
  let row = await BookingInstallment.findById(inst._id);
  assert.equal(row.status, 'paid');
  assert.equal(row.graceEndsAt, null);
  await clearGraceOnPaid({
    booking: await Booking.findById(booking._id),
    installment: row
  });
  const b = await Booking.findById(booking._id);
  assert.equal(b.cancellationReview.status, 'resolved');

  emailService.sendEmail = async () => ({ messageId: 't' });
  const late = await processSplitInstallmentInvoiceEvent({
    event: failEvent(booking, row, { id: 'in_grace_pay', next_payment_attempt: null })
  });
  assert.equal(late.outcome, 'ignored_after_paid');
  row = await BookingInstallment.findById(inst._id);
  assert.equal(row.status, 'paid');
});

test('grace expiry => cancellationReview only; no cancel/inventory release', async () => {
  const booking = await makeBooking();
  const inst = await makeFutureInstallment(booking, {
    status: 'retry_exhausted',
    graceEndsAt: new Date(Date.now() - 1000)
  });
  const opened = await openCancellationReviewIfGraceExpired({
    installment: inst,
    now: new Date()
  });
  assert.equal(opened.opened, true);
  const b = await Booking.findById(booking._id);
  assert.equal(b.cancellationReview.status, 'open');
  assert.equal(b.status, 'confirmed');
});

// ——— InvoicePayment / replacement card / ledger ———

test('paid InvoicePayment → PI → verified card updates reusable PM; draft only', async () => {
  const booking = await makeBooking();
  const draft = await makeFutureInstallment(booking, {
    stripeInvoiceId: 'in_draft_future',
    stripeInvoiceStatus: 'draft',
    status: 'scheduled',
    sequence: 3,
    amountCents: 10000,
    dueAtDateOnly: futureDue(40)
  });
  const paidInst = await makeFutureInstallment(booking, {
    sequence: 2,
    stripeInvoiceId: 'in_paid_pm',
    status: 'processing',
    provisioningState: 'provisioned'
  });
  const stripe = mockStripeIdempotent({ invoiceId: 'in_paid_pm' });
  stripe.store.invoices.in_draft_future = {
    id: 'in_draft_future',
    status: 'draft',
    customer: 'cus_expected'
  };
  stripe.store.invoices.in_paid_final = {
    id: 'in_paid_final',
    status: 'paid',
    customer: 'cus_expected'
  };
  await BookingInstallment.create({
    bookingId: booking._id,
    checkoutSessionId: booking.checkoutId,
    sequence: 4,
    amountCents: 5000,
    currency: 'EUR',
    amountType: 'fixed_cents',
    dueRule: 'days_before_arrival',
    dueOffsetDays: 10,
    dueAtDateOnly: futureDue(50),
    cancellationTreatment: 'standard_policy',
    status: 'paid',
    stripeInvoiceId: 'in_paid_final',
    stripeInvoiceStatus: 'paid',
    provisioningState: 'provisioned'
  });
  stripe.store.invoicePayments = [
    {
      id: 'inpay_card',
      status: 'paid',
      invoice: 'in_paid_pm',
      payment: { type: 'payment_intent', payment_intent: 'pi_card' }
    }
  ];
  stripe.store.paymentIntents = {
    pi_card: {
      id: 'pi_card',
      status: 'succeeded',
      customer: 'cus_expected',
      payment_method: { id: 'pm_new', type: 'card', customer: 'cus_expected' }
    }
  };
  let draftUpdated = false;
  let paidTouched = false;
  const origRetrieve = stripe.invoices.retrieve;
  stripe.invoices.retrieve = async (id) => {
    if (id === 'in_draft_future') return { id, status: 'draft', customer: 'cus_expected' };
    if (id === 'in_paid_final') {
      paidTouched = true;
      return { id, status: 'paid', customer: 'cus_expected' };
    }
    return origRetrieve(id);
  };
  stripe.invoices.update = async (id, params) => {
    if (id === 'in_draft_future') draftUpdated = true;
    if (id === 'in_paid_final') throw new Error('must not update paid invoice');
    return { id, ...params, status: 'draft' };
  };

  const result = await applyReplacementCardFromPaidInvoice({
    invoice: { id: 'in_paid_pm', status: 'paid', customer: 'cus_expected' },
    booking,
    stripe
  });
  assert.equal(result.updated, true);
  assert.equal(result.paymentMethodId, 'pm_new');
  assert.equal(result.paymentIntentId, 'pi_card');
  assert.ok(draftUpdated);
  assert.equal(paidTouched, false);
  const b = await Booking.findById(booking._id);
  assert.equal(b.stripeReusablePaymentMethodId, 'pm_new');
  void draft;
  void paidInst;
});

test('wrong Customer / non-card / unpaid InvoicePayment rejected or ignored', async () => {
  const booking = await makeBooking();
  const stripe = mockStripeIdempotent();

  stripe.store.invoicePayments = [
    {
      id: 'inpay_wrong_cus',
      status: 'paid',
      invoice: 'in_x',
      payment: { type: 'payment_intent', payment_intent: 'pi_wrong' }
    }
  ];
  stripe.store.paymentIntents = {
    pi_wrong: {
      id: 'pi_wrong',
      status: 'succeeded',
      customer: 'cus_other',
      payment_method: { id: 'pm_x', type: 'card', customer: 'cus_other' }
    }
  };
  let r = await applyReplacementCardFromPaidInvoice({
    invoice: { id: 'in_x', status: 'paid' },
    booking,
    stripe
  });
  assert.equal(r.updated, false);
  assert.equal(r.reason, 'no_verified_card_payment_intent');

  stripe.store.invoicePayments = [
    {
      id: 'inpay_sepa',
      status: 'paid',
      invoice: 'in_y',
      payment: { type: 'payment_intent', payment_intent: 'pi_sepa' }
    }
  ];
  stripe.store.paymentIntents = {
    pi_sepa: {
      id: 'pi_sepa',
      status: 'succeeded',
      customer: 'cus_expected',
      payment_method: { id: 'pm_sepa', type: 'sepa_debit', customer: 'cus_expected' }
    }
  };
  r = await applyReplacementCardFromPaidInvoice({
    invoice: { id: 'in_y', status: 'paid' },
    booking,
    stripe
  });
  assert.equal(r.updated, false);

  stripe.store.invoicePayments = [
    {
      id: 'inpay_open',
      status: 'open',
      invoice: 'in_z',
      payment: { type: 'payment_intent', payment_intent: 'pi_open' }
    }
  ];
  r = await applyReplacementCardFromPaidInvoice({
    invoice: { id: 'in_z', status: 'open' },
    booking,
    stripe
  });
  assert.equal(r.updated, false);
});

test('invoice settled without PaymentIntent does not fabricate replacement card; PM retained', async () => {
  const booking = await makeBooking({ stripeReusablePaymentMethodId: 'pm_keep' });
  const inst = await makeFutureInstallment(booking, {
    stripeInvoiceId: 'in_out_of_band',
    status: 'processing',
    provisioningState: 'provisioned'
  });
  const stripe = mockStripeIdempotent({ invoiceId: 'in_out_of_band' });
  stripe.store.invoicePayments = [
    {
      id: 'inpay_record',
      status: 'paid',
      invoice: 'in_out_of_band',
      payment: { type: 'payment_record', payment_record: 'pr_1' }
    }
  ];
  const event = {
    id: 'evt_oob',
    type: 'invoice.paid',
    data: {
      object: {
        id: 'in_out_of_band',
        object: 'invoice',
        status: 'paid',
        customer: 'cus_expected',
        currency: 'eur',
        amount_paid: 30000,
        total: 30000,
        metadata: {
          purpose: 'split_installment_collection',
          bookingId: String(booking._id),
          installmentSequence: '2',
          installmentId: String(inst._id)
        }
        // deliberately no payment_intent
      }
    }
  };
  const r = await processSplitInstallmentInvoiceEvent({ event, stripe });
  assert.equal(r.outcome, 'paid');
  assert.equal(r.paymentIntentId, null);
  const row = await BookingInstallment.findById(inst._id);
  assert.equal(row.status, 'paid');
  assert.equal(row.verifiedSettlementPaymentIntentId, null);
  const b = await Booking.findById(booking._id);
  assert.equal(b.stripeReusablePaymentMethodId, 'pm_keep');
  const pay = await Payment.findOne({
    providerReference: invoiceProviderReference('in_out_of_band')
  });
  assert.equal(pay.status, 'paid');
  assert.equal(pay.metadata.settlementKind, 'invoice_settled_other');
  assert.equal(pay.metadata.paymentIntentId, null);
  assert.ok(pay.metadata.invoicePaymentId);
});

test('duplicate paid webhook remains idempotent with InvoicePayment provenance', async () => {
  const booking = await makeBooking();
  const inst = await makeFutureInstallment(booking, {
    stripeInvoiceId: 'in_dup',
    status: 'processing',
    provisioningState: 'provisioned'
  });
  const stripe = mockStripeIdempotent({ invoiceId: 'in_dup' });
  stripe.store.invoicePayments = [
    {
      id: 'inpay_dup',
      status: 'paid',
      invoice: 'in_dup',
      payment: { type: 'payment_intent', payment_intent: 'pi_dup' }
    }
  ];
  stripe.store.paymentIntents = {
    pi_dup: {
      id: 'pi_dup',
      status: 'succeeded',
      customer: 'cus_expected',
      payment_method: { id: 'pm_dup', type: 'card', customer: 'cus_expected' }
    }
  };
  const event = {
    id: 'evt_dup',
    type: 'invoice.paid',
    data: {
      object: {
        id: 'in_dup',
        object: 'invoice',
        status: 'paid',
        customer: 'cus_expected',
        currency: 'eur',
        amount_paid: 30000,
        total: 30000,
        metadata: {
          purpose: 'split_installment_collection',
          bookingId: String(booking._id),
          installmentSequence: '2',
          installmentId: String(inst._id)
        }
      }
    }
  };
  const r1 = await processSplitInstallmentInvoiceEvent({ event, stripe });
  const r2 = await processSplitInstallmentInvoiceEvent({ event, stripe });
  assert.equal(r1.outcome, 'paid');
  assert.equal(r2.idempotent, true);
  assert.equal(await Payment.countDocuments({ providerReference: invoiceProviderReference('in_dup') }), 1);
  const pay = await Payment.findOne({ providerReference: invoiceProviderReference('in_dup') });
  assert.equal(pay.metadata.paymentIntentId, 'pi_dup');
  assert.equal(pay.metadata.settlementKind, 'card_payment_intent');
});

test('resolveInvoicePaymentProvenance ignores open payments', async () => {
  const stripe = mockStripeIdempotent();
  stripe.store.invoicePayments = [
    {
      id: 'inpay_open2',
      status: 'open',
      invoice: 'in_a',
      payment: { type: 'payment_intent', payment_intent: 'pi_a' }
    }
  ];
  const prov = await resolveInvoicePaymentProvenance({
    stripe,
    invoice: { id: 'in_a', status: 'open' },
    expectedCustomer: 'cus_expected'
  });
  assert.equal(prov.paymentIntentId, null);
  assert.equal(prov.settlementKind, 'invoice_settled_other');
});
