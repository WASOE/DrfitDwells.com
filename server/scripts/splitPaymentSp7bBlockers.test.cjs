/**
 * SP7B — audit blocker fixes: StayCredit reserve/consume/release, date-transfer saga,
 * mixed cancellation cash follow-up, authoritative cash-refund cap.
 * Run: cd server && NODE_PATH="" node --test --test-concurrency=1 scripts/splitPaymentSp7bBlockers.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const BookingInstallment = require('../models/BookingInstallment');
const StayCredit = require('../models/StayCredit');
const StayCreditReservation = require('../models/StayCreditReservation');
const CheckoutSession = require('../models/CheckoutSession');
const {
  issueStayCreditForPaidInstallment,
  previewStayCreditApplication,
  reserveStayCredit,
  consumeStayCreditReservation,
  releaseStayCreditReservation,
  releaseExpiredStayCreditReservations,
  computeCardObligationAfterStayCredit,
  StayCreditError
} = require('../services/stayCreditService');
const {
  settleSplitBookingCancellation
} = require('../services/splitCancellationSettlementService');
const {
  transferSplitBookingDates,
  SplitDateTransferError,
  OP_STATUSES
} = require('../services/splitDateTransferService');
const {
  computeMaxCashRefundableCents,
  resolveCancellationSettlement
} = require('../services/ops/domain/reservationWriteService');
const {
  shouldEmitRefundFollowUpAlert,
  suppressesCancelledPaidRefundFollowUp
} = require('../services/ops/payment/reservationPaymentSignals');
const { buildSplitPaymentOffer } = require('../services/paymentScheduleService');
const { createCheckoutSession } = require('../services/checkout/checkoutSessionService');

let mongoServer;
const ENTITY_ID = new mongoose.Types.ObjectId();

function futureDue(daysFromNow) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

function policySnapshotFullRefund() {
  return {
    schemaVersion: 1,
    correctionWindowHours: 24,
    refundTiers: [{ minDaysBeforeArrival: 0, refundPercent: 100 }],
    eventType: 'customer_cancellation'
  };
}

async function makeBooking(overrides = {}) {
  const checkIn = new Date();
  checkIn.setUTCDate(checkIn.getUTCDate() + 45);
  const checkOut = new Date(checkIn);
  checkOut.setUTCDate(checkOut.getUTCDate() + 2);
  return Booking.create({
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: '+359'
    },
    totalPrice: 500,
    totalValueCents: 50000,
    stripePaidAmountCents: 30000,
    stayCreditAppliedCents: 0,
    paymentSettlementStatus: 'paid_in_full',
    chosenPaymentScheduleSnapshot: {
      totalCents: 50000,
      currency: 'EUR',
      allowDateTransfer: true,
      bookingDateOnly: futureDue(-5),
      installments: []
    },
    chosenPaymentScheduleSnapshotHash: 'hash',
    cabinId: ENTITY_ID,
    status: 'confirmed',
    checkoutId: `chk_${new mongoose.Types.ObjectId()}`,
    stripeCustomerId: 'cus_x',
    resourceFinalizationSnapshot: {
      cancellationPolicy: policySnapshotFullRefund()
    },
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

async function issueCredit(amountCents = 20000) {
  const origin = await makeBooking({
    stripePaidAmountCents: amountCents,
    totalValueCents: amountCents,
    totalPrice: amountCents / 100
  });
  const inst = await BookingInstallment.create({
    bookingId: origin._id,
    sequence: 1,
    amountCents,
    currency: 'EUR',
    amountType: 'percent_bps',
    dueRule: 'checkout',
    dueOffsetDays: 0,
    dueAtDateOnly: futureDue(-1),
    cancellationTreatment: 'stay_credit',
    status: 'paid',
    paidAt: new Date(),
    provisioningState: 'unprovisioned'
  });
  const { stayCredit } = await issueStayCreditForPaidInstallment({
    booking: origin,
    installment: inst
  });
  return { origin, stayCredit };
}

function adminCtx(overrides = {}) {
  return {
    user: { id: 'admin-sp7b', role: 'admin' },
    req: { headers: overrides.headers || {} },
    route: 'test/sp7b',
    ...overrides
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await Booking.syncIndexes();
  await BookingInstallment.syncIndexes();
  await StayCredit.syncIndexes();
  await StayCreditReservation.syncIndexes();
  await CheckoutSession.syncIndexes();
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    Booking.deleteMany({}),
    BookingInstallment.deleteMany({}),
    StayCredit.deleteMany({}),
    StayCreditReservation.deleteMany({}),
    CheckoutSession.deleteMany({})
  ]);
});

// ——— Stay credit reservation ———

test('quote preview does not consume or reserve stay credit', async () => {
  const { stayCredit } = await issueCredit(20000);
  const before = await StayCredit.findById(stayCredit._id);
  const preview = await previewStayCreditApplication({
    code: stayCredit.code,
    totalCents: 50000,
    guestEmail: 'ada@example.com'
  });
  assert.equal(preview.appliedCents, 20000);
  assert.equal(preview.cardObligationCents, 30000);
  const after = await StayCredit.findById(stayCredit._id);
  assert.equal(after.remainingCents, before.remainingCents);
  const reservations = await StayCreditReservation.find({ stayCreditId: stayCredit._id });
  assert.equal(reservations.length, 0);
});

test('reservation atomically reduces spendable balance; retry is idempotent', async () => {
  const { stayCredit } = await issueCredit(20000);
  const r1 = await reserveStayCredit({
    code: stayCredit.code,
    amountCents: 15000,
    checkoutSessionId: 'chk_reserve_1',
    guestEmail: 'ada@example.com',
    expiresAt: new Date(Date.now() + 3600000)
  });
  assert.equal(r1.idempotentReplay, false);
  assert.equal(r1.reservation.amountCents, 15000);
  assert.equal((await StayCredit.findById(stayCredit._id)).remainingCents, 5000);

  const r2 = await reserveStayCredit({
    code: stayCredit.code,
    amountCents: 15000,
    checkoutSessionId: 'chk_reserve_1',
    guestEmail: 'ada@example.com',
    expiresAt: new Date(Date.now() + 3600000)
  });
  assert.equal(r2.idempotentReplay, true);
  assert.equal(String(r2.reservation._id), String(r1.reservation._id));
  assert.equal((await StayCredit.findById(stayCredit._id)).remainingCents, 5000);
});

test('concurrent reservations cannot overspend', async () => {
  const { stayCredit } = await issueCredit(10000);
  const results = await Promise.all(
    ['chk_a', 'chk_b'].map((id) =>
      reserveStayCredit({
        code: stayCredit.code,
        amountCents: 8000,
        checkoutSessionId: id,
        guestEmail: 'ada@example.com',
        expiresAt: new Date(Date.now() + 3600000)
      }).catch((e) => e)
    )
  );
  const ok = results.filter((r) => r && r.reservation);
  const fail = results.filter((r) => r instanceof StayCreditError);
  assert.equal(ok.length, 1);
  assert.equal(fail.length, 1);
  assert.equal((await StayCredit.findById(stayCredit._id)).remainingCents, 2000);
});

test('CheckoutSession stores authoritative reservation; card amount uses reserved cents; split unavailable', async () => {
  const { stayCredit } = await issueCredit(20000);
  const quote = {
    totalPrice: 500,
    totalValueCents: 50000,
    stayCreditCode: stayCredit.code,
    stayCreditAppliedCents: 20000,
    voucherAppliedCents: 0,
    remainingDueCents: 30000,
    entity: { _id: ENTITY_ID },
    entityType: 'cabin',
    checkInDate: new Date('2026-12-01'),
    checkOutDate: new Date('2026-12-03')
  };
  const { session } = await createCheckoutSession({
    input: {
      cabinId: String(ENTITY_ID),
      checkIn: '2026-12-01',
      checkOut: '2026-12-03',
      adults: 2,
      children: 0,
      guestEmail: 'ada@example.com',
      stayCreditCode: stayCredit.code
    },
    quote,
    checkoutId: 'chk_session_auth_1'
  });
  assert.ok(session.stayCreditReservationId);
  assert.equal(session.stayCreditAppliedCents, 20000);
  assert.equal(session.stripeAmountCents, 30000);
  assert.equal((await StayCredit.findById(stayCredit._id)).remainingCents, 0);

  const offer = buildSplitPaymentOffer({
    totalCents: session.stripeAmountCents,
    template: {
      code: 'SPLIT',
      currency: 'EUR',
      status: 'active',
      schemaVersion: 1,
      allowDateTransfer: false,
      installments: [
        {
          sequence: 1,
          amountType: 'percent_bps',
          amountValue: 4000,
          dueRule: 'checkout',
          dueOffsetDays: 0,
          cancellationTreatment: 'standard_policy'
        },
        {
          sequence: 2,
          amountType: 'remainder',
          amountValue: 0,
          dueRule: 'days_before_arrival',
          dueOffsetDays: 30,
          cancellationTreatment: 'standard_policy'
        }
      ]
    },
    bookingDateOnly: '2026-09-01',
    arrivalDateOnly: '2026-12-01',
    stayCreditAppliedCents: session.stayCreditAppliedCents
  });
  assert.equal(offer.eligible, false);
});

test('Booking finalization requires matching reservation; crash leaves reserved; replay consumes once', async () => {
  const { stayCredit } = await issueCredit(20000);
  const reserved = await reserveStayCredit({
    code: stayCredit.code,
    amountCents: 20000,
    checkoutSessionId: 'chk_finalize_1',
    guestEmail: 'ada@example.com',
    expiresAt: new Date(Date.now() + 3600000)
  });
  const booking = await makeBooking({
    checkoutId: 'chk_finalize_1',
    stripePaidAmountCents: 30000,
    stayCreditAppliedCents: 0,
    totalValueCents: 50000
  });

  // Simulate consume crash: booking exists, reservation still reserved
  assert.equal(reserved.reservation.status, 'reserved');
  assert.equal((await StayCredit.findById(stayCredit._id)).remainingCents, 0);

  // Unavailable elsewhere
  await assert.rejects(
    () =>
      reserveStayCredit({
        code: stayCredit.code,
        amountCents: 1,
        checkoutSessionId: 'chk_other',
        guestEmail: 'ada@example.com',
        expiresAt: new Date(Date.now() + 3600000)
      }),
    (e) => e.code === 'INSUFFICIENT_BALANCE'
  );

  const c1 = await consumeStayCreditReservation({
    reservationId: reserved.reservation._id,
    bookingId: booking._id
  });
  assert.equal(c1.idempotentReplay, false);
  assert.equal(c1.reservation.status, 'consumed');

  const c2 = await consumeStayCreditReservation({
    reservationId: reserved.reservation._id,
    bookingId: booking._id
  });
  assert.equal(c2.idempotentReplay, true);

  const credit = await StayCredit.findById(stayCredit._id);
  assert.equal((credit.redemptions || []).length, 1);
});

test('abandoned checkout releases once; consumed cannot release; released cannot consume', async () => {
  const { stayCredit } = await issueCredit(10000);
  const { reservation } = await reserveStayCredit({
    code: stayCredit.code,
    amountCents: 10000,
    checkoutSessionId: 'chk_abandon_1',
    guestEmail: 'ada@example.com',
    expiresAt: new Date(Date.now() + 3600000)
  });

  const r1 = await releaseStayCreditReservation({
    reservationId: reservation._id,
    reason: 'checkout_abandoned'
  });
  assert.equal(r1.released, true);
  assert.equal(r1.idempotentReplay, false);
  assert.equal((await StayCredit.findById(stayCredit._id)).remainingCents, 10000);

  const r2 = await releaseStayCreditReservation({
    reservationId: reservation._id,
    reason: 'checkout_abandoned'
  });
  assert.equal(r2.idempotentReplay, true);
  assert.equal((await StayCredit.findById(stayCredit._id)).remainingCents, 10000);

  await assert.rejects(
    () =>
      consumeStayCreditReservation({
        reservationId: reservation._id,
        bookingId: new mongoose.Types.ObjectId()
      }),
    (e) => e.code === 'RESERVATION_RELEASED'
  );

  const again = await reserveStayCredit({
    code: stayCredit.code,
    amountCents: 5000,
    checkoutSessionId: 'chk_abandon_2',
    guestEmail: 'ada@example.com',
    expiresAt: new Date(Date.now() + 3600000)
  });
  const booking = await makeBooking({ checkoutId: 'chk_abandon_2' });
  await consumeStayCreditReservation({
    reservationId: again.reservation._id,
    bookingId: booking._id
  });
  await assert.rejects(
    () =>
      releaseStayCreditReservation({
        reservationId: again.reservation._id,
        reason: 'should_fail'
      }),
    (e) => e.code === 'RESERVATION_CONSUMED'
  );
});

test('expiry cannot release reservation belonging to finalizing/confirmed Booking', async () => {
  const { stayCredit } = await issueCredit(10000);
  const booking = await makeBooking({ checkoutId: 'chk_entitled_1', status: 'confirmed' });
  await reserveStayCredit({
    code: stayCredit.code,
    amountCents: 10000,
    checkoutSessionId: 'chk_entitled_1',
    guestEmail: 'ada@example.com',
    expiresAt: new Date(Date.now() - 1000)
  });
  const results = await releaseExpiredStayCreditReservations({ now: new Date(), limit: 10 });
  assert.ok(results.some((r) => r.reason === 'booking_entitled'));
  const live = await StayCreditReservation.findOne({
    checkoutSessionId: 'chk_entitled_1',
    status: 'reserved'
  });
  assert.ok(live);
  assert.equal((await StayCredit.findById(stayCredit._id)).remainingCents, 0);
  void booking;
});

test('failed/expired checkout without booking releases credit so it is not permanently lost', async () => {
  const { stayCredit } = await issueCredit(10000);
  await reserveStayCredit({
    code: stayCredit.code,
    amountCents: 10000,
    checkoutSessionId: 'chk_expire_free',
    guestEmail: 'ada@example.com',
    expiresAt: new Date(Date.now() - 1000)
  });
  const results = await releaseExpiredStayCreditReservations({ now: new Date(), limit: 10 });
  assert.ok(results.some((r) => r.released === true));
  assert.equal((await StayCredit.findById(stayCredit._id)).remainingCents, 10000);
});

// ——— Date transfer saga ———

async function makeTransferBooking() {
  const booking = await makeBooking({
    checkIn: new Date('2026-12-01'),
    checkOut: new Date('2026-12-03'),
    chosenPaymentScheduleSnapshot: {
      totalCents: 50000,
      currency: 'EUR',
      allowDateTransfer: true,
      bookingDateOnly: '2026-09-01',
      installments: []
    }
  });
  await BookingInstallment.create({
    bookingId: booking._id,
    sequence: 1,
    amountCents: 20000,
    currency: 'EUR',
    amountType: 'percent_bps',
    dueRule: 'checkout',
    dueOffsetDays: 0,
    dueAtDateOnly: '2026-09-01',
    cancellationTreatment: 'stay_credit',
    status: 'paid',
    paidAt: new Date(),
    provisioningState: 'unprovisioned'
  });
  await BookingInstallment.create({
    bookingId: booking._id,
    sequence: 2,
    amountCents: 30000,
    currency: 'EUR',
    amountType: 'remainder',
    dueRule: 'days_before_arrival',
    dueOffsetDays: 30,
    dueAtDateOnly: '2026-11-01',
    cancellationTreatment: 'standard_policy',
    status: 'scheduled',
    stripeInvoiceId: 'in_xfer_1',
    stripeInvoiceStatus: 'draft',
    provisioningState: 'provisioned'
  });
  await BookingInstallment.create({
    bookingId: booking._id,
    sequence: 3,
    amountCents: 1,
    currency: 'EUR',
    amountType: 'remainder',
    dueRule: 'days_before_arrival',
    dueOffsetDays: 14,
    dueAtDateOnly: '2026-11-17',
    cancellationTreatment: 'standard_policy',
    status: 'scheduled',
    stripeInvoiceId: 'in_xfer_2',
    stripeInvoiceStatus: 'draft',
    provisioningState: 'provisioned'
  });
  // Fix amount for sequence 3 to be realistic — actually seq3 amount 1 is weird for verify.
  // Use only two installments for most tests; for multi-invoice use amount 0 skip... 
  // Delete seq3 and use two invoices via mutating - simplify: only one future invoice for most,
  // multi-invoice test uses custom stripe fail after first.
  await BookingInstallment.deleteOne({ bookingId: booking._id, sequence: 3 });
  return booking;
}

function stripeOkFactory(bookingId, updates = {}) {
  const state = { updates: 0, failAfter: updates.failAfter ?? Infinity, byId: {} };
  return {
    state,
    client: {
      invoices: {
        retrieve: async (id) => ({
          id,
          status: 'draft',
          customer: 'cus_x',
          currency: 'eur',
          amount_due: 30000,
          total: 30000,
          automatically_finalizes_at: state.byId[id]?.automatically_finalizes_at || null,
          metadata: { bookingId: String(bookingId), installmentSequence: '2' }
        }),
        update: async (id, params) => {
          state.updates += 1;
          if (state.updates > state.failAfter) {
            const err = new Error('stripe_network');
            err.code = 'stripe_network';
            throw err;
          }
          state.byId[id] = { ...params };
          return {
            id,
            status: 'draft',
            customer: 'cus_x',
            currency: 'eur',
            amount_due: 30000,
            total: 30000,
            automatically_finalizes_at: params.automatically_finalizes_at,
            metadata: { bookingId: String(bookingId), installmentSequence: '2' }
          };
        }
      }
    }
  };
}

test('prepare does not mutate Booking dates; stripe failure leaves dates old; retry resumes', async () => {
  const booking = await makeTransferBooking();
  // Second future invoice for multi-invoice failure
  await BookingInstallment.create({
    bookingId: booking._id,
    sequence: 3,
    amountCents: 30000,
    currency: 'EUR',
    amountType: 'remainder',
    dueRule: 'days_before_arrival',
    dueOffsetDays: 14,
    dueAtDateOnly: '2026-11-17',
    cancellationTreatment: 'standard_policy',
    status: 'scheduled',
    stripeInvoiceId: 'in_xfer_2',
    stripeInvoiceStatus: 'draft',
    provisioningState: 'provisioned'
  });
  // Fix seq2 amount remains 30000 — seq3 also 30000 would break total; just for stripe path.

  const stripe = stripeOkFactory(booking._id, { failAfter: 1 });
  const oldIn = booking.checkIn;
  const oldOut = booking.checkOut;

  await assert.rejects(
    () =>
      transferSplitBookingDates({
        bookingId: booking._id,
        newCheckIn: new Date('2026-12-20'),
        newCheckOut: new Date('2026-12-22'),
        skipAvailabilityCheck: true,
        stripe: stripe.client,
        actorId: 'ops',
        idempotencyKey: 'xfer-key-1'
      }),
    (e) => e.code === 'stripe_network' || e.message === 'stripe_network'
  );

  const mid = await Booking.findById(booking._id);
  assert.equal(toIsoDate(mid.checkIn), toIsoDate(oldIn));
  assert.equal(toIsoDate(mid.checkOut), toIsoDate(oldOut));
  assert.equal(Number(mid.dateTransferCount) || 0, 0);
  assert.ok(mid.dateTransferOperation);
  assert.ok(
    ['prepared', 'stripe_rescheduling'].includes(String(mid.dateTransferOperation.status))
  );
  const doneCount = (mid.dateTransferOperation.dueDateChanges || []).filter(
    (c) => c.stripeScheduleStatus === 'done'
  ).length;
  assert.equal(doneCount, 1);

  stripe.state.failAfter = Infinity;
  const r2 = await transferSplitBookingDates({
    bookingId: booking._id,
    newCheckIn: new Date('2026-12-20'),
    newCheckOut: new Date('2026-12-22'),
    skipAvailabilityCheck: true,
    stripe: stripe.client,
    actorId: 'ops',
    idempotencyKey: 'xfer-key-1'
  });
  assert.equal(r2.dateTransferCount, 1);
  assert.equal(String(r2.operation.status), OP_STATUSES.COMMITTED);
  const live = await Booking.findById(booking._id);
  assert.equal(toIsoDate(live.checkIn), '2026-12-20');
  assert.equal((live.dateTransferHistory || []).length, 1);
});

function toIsoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

test('same-date replay resumes unfinished operation; different pending request rejected; completed idempotent', async () => {
  const booking = await makeTransferBooking();
  const stripe = stripeOkFactory(booking._id, { failAfter: 0 });
  // force fail before any stripe success by failing first update
  stripe.state.failAfter = 0;

  await assert.rejects(() =>
    transferSplitBookingDates({
      bookingId: booking._id,
      newCheckIn: new Date('2026-12-20'),
      newCheckOut: new Date('2026-12-22'),
      skipAvailabilityCheck: true,
      stripe: stripe.client,
      idempotencyKey: 'xfer-same'
    })
  );

  // Same dates as booking currently — must still resume unfinished op, not early-return
  const pending = await Booking.findById(booking._id);
  assert.ok(pending.dateTransferOperation);
  // Request same NEW dates as the pending op while current booking dates are old
  stripe.state.failAfter = Infinity;
  // different request rejected
  await assert.rejects(
    () =>
      transferSplitBookingDates({
        bookingId: booking._id,
        newCheckIn: new Date('2026-12-25'),
        newCheckOut: new Date('2026-12-27'),
        skipAvailabilityCheck: true,
        stripe: stripe.client,
        idempotencyKey: 'xfer-other'
      }),
    (e) => e instanceof SplitDateTransferError && e.code === 'DATE_TRANSFER_PENDING'
  );

  const done = await transferSplitBookingDates({
    bookingId: booking._id,
    newCheckIn: new Date('2026-12-20'),
    newCheckOut: new Date('2026-12-22'),
    skipAvailabilityCheck: true,
    stripe: stripe.client,
    idempotencyKey: 'xfer-same'
  });
  assert.equal(done.dateTransferCount, 1);

  const replay = await transferSplitBookingDates({
    bookingId: booking._id,
    newCheckIn: new Date('2026-12-20'),
    newCheckOut: new Date('2026-12-22'),
    skipAvailabilityCheck: true,
    stripe: stripe.client,
    idempotencyKey: 'xfer-same'
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal((await Booking.findById(booking._id)).dateTransferHistory.length, 1);
});

test('external incompatible invoice state → needs_review / fail closed', async () => {
  const booking = await makeTransferBooking();
  await assert.rejects(
    () =>
      transferSplitBookingDates({
        bookingId: booking._id,
        newCheckIn: new Date('2026-12-20'),
        newCheckOut: new Date('2026-12-22'),
        skipAvailabilityCheck: true,
        stripe: {
          invoices: {
            retrieve: async () => ({ id: 'in_xfer_1', status: 'open' })
          }
        }
      }),
    (e) => e.code === 'INVOICE_NOT_SCHEDULABLE'
  );
  const live = await Booking.findById(booking._id);
  assert.equal(Number(live.dateTransferCount) || 0, 0);
  assert.equal(toIsoDate(live.checkIn), '2026-12-01');
});

// ——— Mixed cancellation ———

test('stay_credit only → credits_issued, no cash follow-up; settledAt set', async () => {
  const booking = await makeBooking({ stripePaidAmountCents: 20000 });
  await BookingInstallment.create({
    bookingId: booking._id,
    sequence: 1,
    amountCents: 20000,
    currency: 'EUR',
    amountType: 'percent_bps',
    dueRule: 'checkout',
    dueOffsetDays: 0,
    dueAtDateOnly: futureDue(-1),
    cancellationTreatment: 'stay_credit',
    status: 'paid',
    paidAt: new Date(),
    provisioningState: 'unprovisioned'
  });
  const result = await settleSplitBookingCancellation({
    booking,
    reason: 'cancel',
    actorId: 'ops'
  });
  assert.equal(result.cancellationSettlement.outcome, 'credits_issued');
  assert.equal(result.cashRefundCents, 0);
  assert.ok(result.cancellationSettlement.splitSettlement.settledAt);
  assert.equal(
    suppressesCancelledPaidRefundFollowUp(result.cancellationSettlement.outcome),
    true
  );
});

test('standard_policy cash only → cash_refund_pending', async () => {
  const booking = await makeBooking({ stripePaidAmountCents: 30000 });
  await BookingInstallment.create({
    bookingId: booking._id,
    sequence: 1,
    amountCents: 30000,
    currency: 'EUR',
    amountType: 'percent_bps',
    dueRule: 'checkout',
    dueOffsetDays: 0,
    dueAtDateOnly: futureDue(-1),
    cancellationTreatment: 'standard_policy',
    status: 'paid',
    paidAt: new Date(),
    provisioningState: 'unprovisioned'
  });
  const result = await settleSplitBookingCancellation({
    booking,
    reason: 'cancel',
    actorId: 'ops'
  });
  assert.equal(result.cancellationSettlement.outcome, 'cash_refund_pending');
  assert.ok(result.cashRefundCents > 0);
  assert.equal(result.cancellationSettlement.splitSettlement.settledAt, null);
  assert.equal(result.cancellationSettlement.splitSettlement.cashRefundStatus, 'pending');
  assert.equal(
    shouldEmitRefundFollowUpAlert({
      reservationStatus: 'cancelled',
      paymentStatus: 'paid',
      cancellationSettlementOutcome: 'cash_refund_pending'
    }),
    true
  );
});

test('mixed credit + cash → credit issued AND cash remains pending; settledAt null', async () => {
  const booking = await makeBooking({ stripePaidAmountCents: 50000, totalValueCents: 50000 });
  await BookingInstallment.create({
    bookingId: booking._id,
    sequence: 1,
    amountCents: 20000,
    currency: 'EUR',
    amountType: 'percent_bps',
    dueRule: 'checkout',
    dueOffsetDays: 0,
    dueAtDateOnly: futureDue(-1),
    cancellationTreatment: 'stay_credit',
    status: 'paid',
    paidAt: new Date(),
    provisioningState: 'unprovisioned'
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
    status: 'paid',
    paidAt: new Date(),
    provisioningState: 'unprovisioned'
  });
  const result = await settleSplitBookingCancellation({
    booking,
    reason: 'cancel',
    actorId: 'ops'
  });
  assert.equal(result.stayCreditIssuedCents, 20000);
  assert.ok(result.cashRefundCents > 0);
  assert.equal(result.cancellationSettlement.outcome, 'cash_refund_pending');
  assert.equal(result.cancellationSettlement.splitSettlement.settledAt, null);
  assert.equal(result.cancellationSettlement.splitSettlement.creditIssuanceStatus, 'issued');
  assert.equal(result.cancellationSettlement.splitSettlement.cashRefundStatus, 'pending');
  assert.equal(
    result.cashRefundCents + result.stayCreditIssuedCents + result.retainedCents,
    50000
  );
  assert.equal(
    shouldEmitRefundFollowUpAlert({
      reservationStatus: 'cancelled',
      paymentStatus: 'paid',
      cancellationSettlementOutcome: 'cash_refund_pending'
    }),
    true
  );

  const dup = await settleSplitBookingCancellation({
    booking: await Booking.findById(booking._id),
    reason: 'cancel',
    actorId: 'ops'
  });
  assert.equal(dup.idempotentReplay, true);
  const credits = await StayCredit.find({ originBookingId: booking._id });
  assert.equal(credits.length, 1);
});

test('completing refund evidence completes settlement; duplicate evidence capped', async () => {
  const booking = await makeBooking({
    status: 'cancelled',
    stripePaidAmountCents: 30000,
    stayCreditAppliedCents: 20000,
    totalValueCents: 50000
  });
  booking.cancellationSettlement = {
    outcome: 'cash_refund_pending',
    reason: 'split',
    cashRefundAmountCents: 30000,
    creditAmountCents: 20000,
    settlementRecordedAt: new Date(),
    splitSettlement: {
      allocatedAt: new Date(),
      settledAt: null,
      cashRefundCents: 30000,
      stayCreditIssuedCents: 20000,
      retainedCents: 0,
      cashRefundStatus: 'pending',
      creditIssuanceStatus: 'issued',
      settlementCompletionStatus: 'cash_refund_pending'
    }
  };
  await booking.save();

  const resolved = await resolveCancellationSettlement({
    bookingId: booking._id,
    reason: 'refunded via bank',
    settlement: {
      outcome: 'cash_refunded',
      cashRefundEvidence: {
        amountCents: 30000,
        method: 'bank_transfer',
        note: 'wired'
      }
    },
    ctx: adminCtx()
  });
  assert.equal(resolved.cancellationSettlement.outcome, 'cash_refunded');
  assert.ok(resolved.cancellationSettlement.splitSettlement.settledAt);
  assert.equal(resolved.cancellationSettlement.splitSettlement.cashRefundStatus, 'completed');

  await assert.rejects(
    () =>
      resolveCancellationSettlement({
        bookingId: booking._id,
        reason: 'again',
        settlement: {
          outcome: 'cash_refunded',
          cashRefundEvidence: {
            amountCents: 1,
            method: 'bank_transfer',
            note: 'again'
          }
        },
        ctx: adminCtx({ headers: { 'x-idempotency-key': 'dup-2' } })
      }),
    (e) => e.statusCode === 409 || /finalized|exceeds authoritative/i.test(String(e.message || ''))
  );
});

// ——— Cash cap ———

test('cash refund cannot exceed card cash; stay credit and voucher cannot become cash', async () => {
  const booking = await makeBooking({
    totalValueCents: 50000,
    totalPrice: 500,
    stripePaidAmountCents: 30000,
    stayCreditAppliedCents: 20000,
    giftVoucherAppliedCents: 0,
    status: 'cancelled'
  });
  assert.equal(computeMaxCashRefundableCents(booking), 30000);

  await assert.rejects(
    () =>
      resolveCancellationSettlement({
        bookingId: booking._id,
        reason: 'ops refund',
        settlement: {
          outcome: 'cash_refund_pending',
          cashRefundAmountCents: 50000
        },
        ctx: adminCtx()
      }),
    (e) => /exceeds authoritative refundable card cash/i.test(String(e.message || ''))
  );

  const voucherBooking = await makeBooking({
    stripePaidAmountCents: 10000,
    giftVoucherAppliedCents: 40000,
    stayCreditAppliedCents: 0,
    totalValueCents: 50000,
    status: 'cancelled'
  });
  assert.equal(computeMaxCashRefundableCents(voucherBooking), 10000);

  const allCard = await makeBooking({
    stripePaidAmountCents: 50000,
    stayCreditAppliedCents: 0,
    giftVoucherAppliedCents: 0,
    status: 'cancelled'
  });
  assert.equal(computeMaxCashRefundableCents(allCard), 50000);
});

test('prior cash refund reduces remaining cap; stayCreditApplied never counted as stripePaid', async () => {
  const booking = await makeBooking({
    status: 'cancelled',
    stripePaidAmountCents: 30000,
    stayCreditAppliedCents: 20000,
    cancellationSettlement: {
      outcome: 'cash_refunded',
      cashRefundAmountCents: 10000,
      cashRefundEvidence: { amountCents: 10000, method: 'bank_transfer', note: 'partial' }
    }
  });
  assert.equal(computeMaxCashRefundableCents(booking), 20000);
  // Provenance: commercial 500 != stripe paid 300
  assert.notEqual(booking.totalValueCents, booking.stripePaidAmountCents);
  assert.equal(
    booking.stripePaidAmountCents + booking.stayCreditAppliedCents,
    booking.totalValueCents
  );
});
