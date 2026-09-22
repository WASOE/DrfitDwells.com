/**
 * SP6 — future installment collection: provisioning, webhooks, settlement, grace, reminders.
 * Run: cd server && NODE_PATH="" node --test --test-concurrency=1 scripts/splitPaymentSp6Collection.test.cjs
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
  FUTURE_CHARGE_REMINDER_DAYS_BEFORE,
  RETRY_EXHAUSTED_GRACE_DAYS,
  RETRY_STATE_STABILIZATION_MS,
  INVOICE_FINALIZE_LOCAL_HOUR
} = require('../config/splitPaymentCollectionConfig');
const {
  dueDateFinalizeAtSofia,
  dueDateFinalizeUnixSeconds,
  isFinalizeTimestampInPast,
  isReminderDue
} = require('../services/splitPaymentInvoiceTime');
const {
  buildInvoiceIdempotencyKey,
  provisionInstallmentInvoice,
  invoiceMatchesInstallment,
  PROVISION_CODES,
  SplitInvoiceProvisioningError
} = require('../services/splitPaymentInvoiceProvisioningService');
const {
  processSplitInstallmentInvoiceEvent,
  invoiceProviderReference,
  assertInvoiceMatchesInstallment
} = require('../services/splitPaymentInvoiceWebhookService');
const {
  recomputeBookingSettlementFromInstallments
} = require('../services/bookingInstallmentSettlementService');
const {
  applyReplacementCardFromPaidInvoice
} = require('../services/splitPaymentReplacementCardService');
const {
  reconcileRetryExhaustionForInstallment,
  openCancellationReviewIfGraceExpired,
  clearGraceOnPaid
} = require('../services/splitPaymentGraceService');
const {
  sendSplitInstallmentReminder,
  composeFailureContent
} = require('../services/splitPaymentCollectionEmailService');
const emailService = require('../services/emailService');
const featureFlags = require('../utils/featureFlags');

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
    checkoutId: `chk_sp6_${new mongoose.Types.ObjectId().toString()}`,
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

function mockStripeForProvision({ invoiceId = 'in_1', itemId = 'ii_1' } = {}) {
  const store = {
    invoices: {},
    items: {},
    creates: 0,
    itemCreates: 0,
    updates: 0,
    idempotency: {},
    invoicePayments: []
  };
  const invoiceBase = () => ({
    id: invoiceId,
    object: 'invoice',
    status: 'draft',
    customer: 'cus_expected',
    default_payment_method: 'pm_card_1',
    currency: 'eur',
    amount_due: 30000,
    total: 30000,
    amount_paid: 0,
    metadata: {},
    lines: { data: [{ id: itemId, amount: 30000 }], total_count: 1 },
    auto_advance: false
  });
  store.invoices[invoiceId] = invoiceBase();
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
        const inv = {
          ...invoiceBase(),
          metadata: params.metadata || {},
          customer: params.customer,
          default_payment_method: params.default_payment_method,
          currency: params.currency,
          amount_due: 0,
          total: 0
        };
        store.invoices[inv.id] = inv;
        if (key) store.idempotency[key] = { ...inv };
        return inv;
      },
      retrieve: async (id) => {
        const inv = store.invoices[id];
        if (!inv) throw new Error('missing invoice');
        const lines = Object.values(store.items).filter((i) => i.invoice === id);
        return {
          ...inv,
          lines: {
            data: lines.length ? lines : [{ id: itemId, amount: 30000 }],
            total_count: lines.length || 1
          }
        };
      },
      update: async (id, params, opts) => {
        store.updates += 1;
        store.lastUpdateOpts = opts;
        const inv = store.invoices[id];
        Object.assign(inv, params, { status: 'draft' });
        if (params.auto_advance) inv.auto_advance = true;
        return inv;
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
          inv.metadata = params.metadata || inv.metadata;
        }
        if (key) store.idempotency[key] = { ...item };
        return item;
      }
    },
    invoicePayments: {
      list: async (params) => {
        const rows = (store.invoicePayments || []).filter((p) => {
          if (params.invoice && String(p.invoice) !== String(params.invoice)) return false;
          if (params.status && String(p.status) !== String(params.status)) return false;
          return true;
        });
        return { data: rows };
      }
    },
    paymentIntents: {
      retrieve: async (id) => ({
        id: id || 'pi_pay',
        status: 'succeeded',
        customer: 'cus_expected',
        payment_method: {
          id: 'pm_card_2',
          type: 'card',
          customer: 'cus_expected'
        }
      })
    },
    paymentMethods: {
      retrieve: async (id) => ({
        id,
        type: 'card',
        customer: 'cus_expected'
      })
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

test('operational defaults are centralized', () => {
  assert.equal(FUTURE_CHARGE_REMINDER_DAYS_BEFORE, 5);
  assert.equal(RETRY_EXHAUSTED_GRACE_DAYS, 7);
  assert.equal(RETRY_STATE_STABILIZATION_MS, 5 * 60 * 1000);
  assert.equal(INVOICE_FINALIZE_LOCAL_HOUR, 10);
  assert.equal(featureFlags.isSplitPaymentCollectionWorkerEnabled(), false);
});

test('finalize timestamp is deterministic Europe/Sofia 10:00', () => {
  const at = dueDateFinalizeAtSofia('2026-11-20');
  assert.ok(at instanceof Date);
  assert.equal(dueDateFinalizeUnixSeconds('2026-11-20'), Math.floor(at.getTime() / 1000));
  // Reminder window
  assert.equal(isReminderDue({ dueAtDateOnly: futureDue(3), now: new Date() }), true);
  assert.equal(isReminderDue({ dueAtDateOnly: futureDue(20), now: new Date() }), false);
});

test('provision creates draft invoice, one line, verifies, then schedules finalize', async () => {
  const booking = await makeBooking();
  const inst = await makeFutureInstallment(booking);
  const stripe = mockStripeForProvision();
  const result = await provisionInstallmentInvoice({
    installment: inst,
    booking,
    stripe
  });
  assert.equal(result.skipped, false);
  assert.equal(stripe.store.creates, 1);
  assert.equal(stripe.store.itemCreates, 1);
  assert.equal(stripe.store.updates, 1);
  assert.match(stripe.store.lastCreateOpts.idempotencyKey, /:create$/);
  assert.match(stripe.store.lastItemOpts.idempotencyKey, /:item$/);
  assert.match(stripe.store.lastUpdateOpts.idempotencyKey, /:schedule$/);
  const refreshed = await BookingInstallment.findById(inst._id);
  assert.equal(refreshed.stripeInvoiceId, 'in_1');
  assert.equal(refreshed.stripeInvoiceItemId, 'ii_1');
  assert.equal(refreshed.provisioningState, 'provisioned');
  assert.ok(refreshed.automaticallyFinalizesAt);
  assert.equal(
    refreshed.automaticallyFinalizesAt.getTime(),
    dueDateFinalizeAtSofia(inst.dueAtDateOnly).getTime()
  );
});

test('crash after invoice create — retry adopts same idempotent invoice', async () => {
  const booking = await makeBooking();
  const inst = await makeFutureInstallment(booking);
  const stripe = mockStripeForProvision({ invoiceId: 'in_crash' });
  const createKey = buildInvoiceIdempotencyKey(booking._id, 2, 'create');
  // Stripe create succeeds; DB never stores invoice id (crash).
  await stripe.invoices.create(
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
    { idempotencyKey: createKey }
  );
  assert.equal((await BookingInstallment.findById(inst._id)).stripeInvoiceId, null);
  const again = await provisionInstallmentInvoice({
    installment: await BookingInstallment.findById(inst._id),
    booking,
    stripe
  });
  assert.equal(again.skipped, false);
  assert.equal(again.invoice.id, 'in_crash');
  assert.equal(Object.keys(stripe.store.invoices).filter((k) => k === 'in_crash').length, 1);
  const row = await BookingInstallment.findById(inst._id);
  assert.equal(row.stripeInvoiceId, 'in_crash');
  assert.equal(row.provisioningState, 'provisioned');
});

test('conflicting existing invoice fails closed', async () => {
  const booking = await makeBooking();
  const inst = await makeFutureInstallment(booking, { stripeInvoiceId: 'in_bad' });
  const stripe = mockStripeForProvision({ invoiceId: 'in_bad' });
  stripe.store.invoices.in_bad = {
    id: 'in_bad',
    object: 'invoice',
    status: 'draft',
    customer: 'cus_other',
    currency: 'eur',
    amount_due: 99999,
    total: 99999,
    metadata: { bookingId: 'other', installmentSequence: '2' },
    default_payment_method: 'pm_card_1',
    lines: { data: [{ amount: 99999 }], total_count: 1 }
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

test('past-due unprovisioned installment goes review, not surprise charge', async () => {
  const booking = await makeBooking();
  const pastDue = '2020-01-15';
  assert.equal(isFinalizeTimestampInPast(pastDue, new Date()), true);
  const inst = await makeFutureInstallment(booking, { dueAtDateOnly: pastDue });
  const stripe = mockStripeForProvision();
  await assert.rejects(
    () => provisionInstallmentInvoice({ installment: inst, booking, stripe, now: new Date() }),
    (err) => err.code === PROVISION_CODES.PAST_DUE
  );
  assert.equal(stripe.store.creates, 0);
  const refreshed = await BookingInstallment.findById(inst._id);
  assert.equal(refreshed.provisioningState, 'past_due_needs_review');
});

test('invoice.paid marks installment paid; duplicate is idempotent; settlement recomputed', async () => {
  const booking = await makeBooking();
  await BookingInstallment.create({
    bookingId: booking._id,
    checkoutSessionId: 'chk_sp6',
    sequence: 1,
    amountCents: 20000,
    currency: 'EUR',
    amountType: 'percent_bps',
    dueRule: 'checkout',
    dueOffsetDays: 0,
    dueAtDateOnly: '2026-10-01',
    cancellationTreatment: 'stay_credit',
    status: 'paid',
    paidAt: new Date(),
    stripePaymentIntentId: 'pi_initial'
  });
  const inst = await makeFutureInstallment(booking, {
    stripeInvoiceId: 'in_paid',
    provisioningState: 'provisioned',
    status: 'processing'
  });
  const invoice = {
    id: 'in_paid',
    object: 'invoice',
    status: 'paid',
    customer: 'cus_expected',
    currency: 'eur',
    amount_paid: 30000,
    amount_due: 0,
    total: 30000,
    hosted_invoice_url: 'https://invoice.stripe.com/i/test',
    attempt_count: 1,
    metadata: {
      purpose: 'split_installment_collection',
      bookingId: String(booking._id),
      installmentSequence: '2',
      installmentId: String(inst._id)
    }
  };
  const event = { id: 'evt_paid_1', type: 'invoice.paid', data: { object: invoice } };
  const stripe = mockStripeForProvision();
  stripe.store.invoicePayments = [
    {
      id: 'inpay_paid',
      status: 'paid',
      invoice: 'in_paid',
      payment: { type: 'payment_intent', payment_intent: 'pi_inv_pay' }
    }
  ];
  const r1 = await processSplitInstallmentInvoiceEvent({ event, stripe });
  assert.equal(r1.outcome, 'paid');
  const after = await BookingInstallment.findById(inst._id);
  assert.equal(after.status, 'paid');
  assert.equal(after.hostedInvoiceUrl, 'https://invoice.stripe.com/i/test');
  const pay = await Payment.findOne({
    provider: 'stripe',
    providerReference: invoiceProviderReference('in_paid')
  });
  assert.ok(pay);
  assert.equal(pay.status, 'paid');
  assert.equal(pay.metadata.paymentIntentId, 'pi_inv_pay');
  const settled = await Booking.findById(booking._id);
  assert.equal(settled.stripePaidAmountCents, 50000);
  assert.equal(settled.paymentSettlementStatus, 'paid_in_full');

  const r2 = await processSplitInstallmentInvoiceEvent({ event, stripe });
  assert.equal(r2.idempotent, true);
  assert.equal(await Payment.countDocuments({ providerReference: invoiceProviderReference('in_paid') }), 1);
  const settled2 = await Booking.findById(booking._id);
  assert.equal(settled2.stripePaidAmountCents, 50000);
});

test('out-of-order payment_failed after paid cannot regress', async () => {
  const booking = await makeBooking();
  const inst = await makeFutureInstallment(booking, {
    stripeInvoiceId: 'in_x',
    status: 'paid',
    paidAt: new Date(),
    provisioningState: 'provisioned'
  });
  const event = {
    id: 'evt_fail_late',
    type: 'invoice.payment_failed',
    data: {
      object: {
        id: 'in_x',
        object: 'invoice',
        status: 'open',
        customer: 'cus_expected',
        currency: 'eur',
        amount_due: 30000,
        attempt_count: 2,
        next_payment_attempt: null,
        metadata: {
          purpose: 'split_installment_collection',
          bookingId: String(booking._id),
          installmentSequence: '2'
        }
      }
    }
  };
  const r = await processSplitInstallmentInvoiceEvent({ event });
  assert.equal(r.outcome, 'ignored_after_paid');
  const after = await BookingInstallment.findById(inst._id);
  assert.equal(after.status, 'paid');
});

test('wrong amount on invoice.paid fails closed', async () => {
  const booking = await makeBooking();
  const inst = await makeFutureInstallment(booking, {
    stripeInvoiceId: 'in_badamt',
    status: 'processing',
    provisioningState: 'provisioned'
  });
  const event = {
    id: 'evt_bad',
    type: 'invoice.paid',
    data: {
      object: {
        id: 'in_badamt',
        object: 'invoice',
        status: 'paid',
        customer: 'cus_expected',
        currency: 'eur',
        amount_paid: 1,
        total: 1,
        metadata: {
          purpose: 'split_installment_collection',
          bookingId: String(booking._id),
          installmentSequence: '2',
          installmentId: String(inst._id)
        }
      }
    }
  };
  await assert.rejects(() => processSplitInstallmentInvoiceEvent({ event }));
  const after = await BookingInstallment.findById(inst._id);
  assert.notEqual(after.status, 'paid');
});

test('payment_failed never starts grace immediately; worker + stabilization required', async () => {
  const booking = await makeBooking();
  const inst = await makeFutureInstallment(booking, {
    stripeInvoiceId: 'in_fail',
    status: 'processing',
    provisioningState: 'provisioned'
  });
  const withRetry = {
    id: 'evt_fr',
    type: 'invoice.payment_failed',
    data: {
      object: {
        id: 'in_fail',
        object: 'invoice',
        status: 'open',
        customer: 'cus_expected',
        currency: 'eur',
        amount_due: 30000,
        attempt_count: 1,
        next_payment_attempt: Math.floor(Date.now() / 1000) + 86400,
        hosted_invoice_url: 'https://invoice.stripe.com/i/recover',
        metadata: {
          purpose: 'split_installment_collection',
          bookingId: String(booking._id),
          installmentSequence: '2'
        }
      }
    }
  };
  const originalSend = emailService.sendEmail.bind(emailService);
  emailService.sendEmail = async () => ({ messageId: 'test' });
  try {
    const r1 = await processSplitInstallmentInvoiceEvent({ event: withRetry });
    assert.ok(r1.nextPaymentAttemptAt);
    assert.equal(r1.graceStarted, false);
    let row = await BookingInstallment.findById(inst._id);
    assert.equal(row.status, 'failed');
    assert.ok(row.nextPaymentAttemptAt);
    assert.notEqual(row.status, 'retry_exhausted');

    const noRetry = {
      ...withRetry,
      id: 'evt_fr2',
      data: {
        object: {
          ...withRetry.data.object,
          attempt_count: 3,
          next_payment_attempt: null
        }
      }
    };
    const r2 = await processSplitInstallmentInvoiceEvent({ event: noRetry });
    assert.equal(r2.graceStarted, false);
    row = await BookingInstallment.findById(inst._id);
    assert.equal(row.status, 'failed');
    assert.equal(row.graceEndsAt, null);
    assert.ok(row.retryExhaustionCandidateObservedAt);
    assert.ok(row.hostedInvoiceUrl.includes('invoice.stripe.com'));
  } finally {
    emailService.sendEmail = originalSend;
  }
});

test('action_required and finalization_failed handled', async () => {
  const booking = await makeBooking();
  const inst = await makeFutureInstallment(booking, {
    stripeInvoiceId: 'in_act',
    status: 'processing',
    provisioningState: 'provisioned'
  });
  emailService.sendEmail = async () => ({ messageId: 'test' });
  await processSplitInstallmentInvoiceEvent({
    event: {
      id: 'evt_act',
      type: 'invoice.payment_action_required',
      data: {
        object: {
          id: 'in_act',
          object: 'invoice',
          status: 'open',
          customer: 'cus_expected',
          currency: 'eur',
          amount_due: 30000,
          hosted_invoice_url: 'https://invoice.stripe.com/i/3ds',
          metadata: {
            purpose: 'split_installment_collection',
            bookingId: String(booking._id),
            installmentSequence: '2'
          }
        }
      }
    }
  });
  let row = await BookingInstallment.findById(inst._id);
  assert.equal(row.status, 'requires_action');

  await processSplitInstallmentInvoiceEvent({
    event: {
      id: 'evt_ff',
      type: 'invoice.finalization_failed',
      data: {
        object: {
          id: 'in_act',
          object: 'invoice',
          status: 'draft',
          customer: 'cus_expected',
          currency: 'eur',
          amount_due: 30000,
          last_finalization_error: { message: 'boom' },
          metadata: {
            purpose: 'split_installment_collection',
            bookingId: String(booking._id),
            installmentSequence: '2'
          }
        }
      }
    }
  });
  row = await BookingInstallment.findById(inst._id);
  assert.equal(row.provisioningState, 'failed');
  assert.equal(row.lastFailureCode, 'finalization_failed');
});

test('settlement recomputes paid cents; never double-counts', async () => {
  const booking = await makeBooking({ stripePaidAmountCents: 0 });
  await BookingInstallment.create({
    bookingId: booking._id,
    sequence: 1,
    amountCents: 20000,
    currency: 'EUR',
    amountType: 'percent_bps',
    dueRule: 'checkout',
    dueOffsetDays: 0,
    dueAtDateOnly: '2026-10-01',
    cancellationTreatment: 'stay_credit',
    status: 'paid'
  });
  await BookingInstallment.create({
    bookingId: booking._id,
    sequence: 2,
    amountCents: 30000,
    currency: 'EUR',
    amountType: 'remainder',
    dueRule: 'days_before_arrival',
    dueOffsetDays: 30,
    dueAtDateOnly: futureDue(20),
    cancellationTreatment: 'standard_policy',
    status: 'scheduled'
  });
  let r = await recomputeBookingSettlementFromInstallments({ bookingId: booking._id });
  assert.equal(r.paidCents, 20000);
  assert.equal(r.settlementStatus, 'partially_paid');
  await BookingInstallment.updateOne(
    { bookingId: booking._id, sequence: 2 },
    { $set: { status: 'paid' } }
  );
  r = await recomputeBookingSettlementFromInstallments({ bookingId: booking._id });
  assert.equal(r.paidCents, 50000);
  assert.equal(r.settlementStatus, 'paid_in_full');
  r = await recomputeBookingSettlementFromInstallments({ bookingId: booking._id });
  assert.equal(r.paidCents, 50000);
});

test('replacement card verified update; wrong customer rejected', async () => {
  const booking = await makeBooking();
  await makeFutureInstallment(booking, {
    stripeInvoiceId: 'in_draft2',
    stripeInvoiceStatus: 'draft',
    status: 'scheduled',
    sequence: 3,
    amountCents: 10000,
    dueAtDateOnly: futureDue(40)
  });
  const stripe = mockStripeForProvision();
  stripe.store.invoicePayments = [
    {
      id: 'inpay_1',
      status: 'paid',
      invoice: 'in_paid_pm',
      payment: { type: 'payment_intent', payment_intent: 'pi_pay' }
    }
  ];
  stripe.store.invoices.in_draft2 = {
    id: 'in_draft2',
    status: 'draft',
    customer: 'cus_expected'
  };
  stripe.invoices.retrieve = async (id) => ({
    id,
    status: 'draft',
    customer: 'cus_expected'
  });
  stripe.invoices.update = async (id, params) => {
    stripe.store.lastPmUpdate = { id, params };
    return { id, ...params, status: 'draft' };
  };

  const result = await applyReplacementCardFromPaidInvoice({
    invoice: {
      id: 'in_paid_pm',
      status: 'paid',
      customer: 'cus_expected'
    },
    booking,
    stripe
  });
  assert.equal(result.updated, true);
  assert.equal(result.paymentMethodId, 'pm_card_2');
  const refreshed = await Booking.findById(booking._id);
  assert.equal(refreshed.stripeReusablePaymentMethodId, 'pm_card_2');

  const badStripe = mockStripeForProvision();
  badStripe.store.invoicePayments = [
    {
      id: 'inpay_bad',
      status: 'paid',
      invoice: 'in_x',
      payment: { type: 'payment_intent', payment_intent: 'pi_pay' }
    }
  ];
  badStripe.paymentIntents.retrieve = async () => ({
    id: 'pi_pay',
    status: 'succeeded',
    customer: 'cus_expected',
    payment_method: { id: 'pm_card_2', type: 'card', customer: 'cus_expected' }
  });
  const retained = await applyReplacementCardFromPaidInvoice({
    invoice: { id: 'in_x', status: 'paid' },
    booking: { ...booking.toObject(), stripeCustomerId: 'cus_other', _id: booking._id },
    stripe: badStripe
  });
  assert.equal(retained.updated, false);
  assert.equal(retained.reason, 'no_verified_card_payment_intent');
});

test('reminder once; paid installment no reminder; rerun no duplicate', async () => {
  const booking = await makeBooking();
  const inst = await makeFutureInstallment(booking, { dueAtDateOnly: futureDue(2) });
  let sends = 0;
  emailService.sendEmail = async () => {
    sends += 1;
    return { messageId: `m${sends}` };
  };
  const r1 = await sendSplitInstallmentReminder({ booking, installment: inst });
  assert.equal(r1.sent, true);
  assert.equal(sends, 1);
  const after = await BookingInstallment.findById(inst._id);
  assert.ok(after.reminderSentAt);
  const r2 = await sendSplitInstallmentReminder({
    booking,
    installment: after
  });
  assert.equal(r2.sent, false);
  assert.equal(sends, 1);

  await BookingInstallment.updateOne(
    { _id: inst._id },
    { $set: { status: 'paid', reminderSentAt: null } }
  );
  const paid = await BookingInstallment.findById(inst._id);
  const r3 = await sendSplitInstallmentReminder({ booking, installment: paid });
  assert.equal(r3.reason, 'terminal');
  assert.equal(sends, 1);
});

test('grace: paid during grace clears review; unpaid after grace opens review only', async () => {
  const booking = await makeBooking();
  const observed = new Date(Date.now() - RETRY_STATE_STABILIZATION_MS - 1000);
  const inst = await makeFutureInstallment(booking, {
    status: 'failed',
    stripeInvoiceId: 'in_grace',
    nextPaymentAttemptAt: null,
    lastPaymentFailedAt: observed,
    retryExhaustionCandidateObservedAt: observed,
    provisioningState: 'provisioned'
  });
  const stripe = mockStripeForProvision({ invoiceId: 'in_grace' });
  stripe.store.invoices.in_grace = {
    id: 'in_grace',
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
  const exhausted = await reconcileRetryExhaustionForInstallment({
    booking,
    installment: inst,
    stripe,
    now: new Date(),
    graceDays: 7
  });
  assert.equal(exhausted.outcome, 'retry_exhausted');
  assert.equal(exhausted.installment.status, 'retry_exhausted');
  assert.ok(exhausted.installment.graceEndsAt);

  // Paid during grace => resolve, no open review
  await BookingInstallment.updateOne({ _id: inst._id }, { $set: { status: 'paid', graceEndsAt: null } });
  await clearGraceOnPaid({
    booking: await Booking.findById(booking._id),
    installment: await BookingInstallment.findById(inst._id)
  });
  let b = await Booking.findById(booking._id);
  assert.ok(!b.cancellationReview || b.cancellationReview.status !== 'open');

  // Unpaid after grace
  await BookingInstallment.updateOne(
    { _id: inst._id },
    {
      $set: {
        status: 'retry_exhausted',
        graceEndsAt: new Date(Date.now() - 1000)
      }
    }
  );
  const opened = await openCancellationReviewIfGraceExpired({
    installment: await BookingInstallment.findById(inst._id),
    now: new Date()
  });
  assert.equal(opened.opened, true);
  b = await Booking.findById(booking._id);
  assert.equal(b.cancellationReview.status, 'open');
  assert.equal(b.cancellationReview.reason, 'unpaid_split_installment');
  assert.equal(b.status, 'confirmed'); // never auto-cancelled
});

test('failure email uses Hosted Invoice Page; confirmation shows split schedule', async () => {
  const content = composeFailureContent({
    booking: { guestInfo: { firstName: 'Ada' } },
    installment: { amountCents: 30000 },
    cabin: { name: 'Cabin A' },
    reason: 'payment_failed',
    nextPaymentAttemptAt: null,
    hostedInvoiceUrl: 'https://invoice.stripe.com/i/abc'
  });
  assert.match(content.html, /invoice\.stripe\.com/);
  assert.doesNotMatch(content.html, /payment_link/i);

  const booking = await makeBooking();
  const email = emailService.generateBookingConfirmedEmail(booking, {
    name: 'Forest Cabin',
    location: 'Rhodope',
    arrivalWindowDefault: '15:00'
  });
  assert.match(email.text, /PAYMENT SCHEDULE/);
  assert.match(email.text, /Remaining balance/);
  assert.match(email.text, /automatic charge/i);
  assert.match(email.html, /Payment schedule/);

  const full = await makeBooking({
    paymentSettlementStatus: 'paid_in_full',
    chosenPaymentScheduleSnapshot: null,
    stripePaidAmountCents: 50000
  });
  const fullEmail = emailService.generateBookingConfirmedEmail(full, {
    name: 'Forest Cabin',
    location: 'Rhodope'
  });
  assert.doesNotMatch(fullEmail.text, /PAYMENT SCHEDULE/);
});

test('idempotency keys are stable per booking+sequence+op', () => {
  const a = buildInvoiceIdempotencyKey('b1', 2, 'create');
  const b = buildInvoiceIdempotencyKey('b1', 2, 'create');
  const c = buildInvoiceIdempotencyKey('b1', 2, 'item');
  assert.equal(a, b);
  assert.notEqual(a, c);
});
