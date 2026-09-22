/**
 * SP7 — stay credit, cancellation settlement, date transfer, PaymentTerm ops, ops read model.
 * Run: cd server && NODE_PATH="" node --test --test-concurrency=1 scripts/splitPaymentSp7Lifecycle.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const BookingInstallment = require('../models/BookingInstallment');
const StayCredit = require('../models/StayCredit');
const PaymentTermTemplate = require('../models/PaymentTermTemplate');
const RatePlan = require('../models/RatePlan');
const {
  issueStayCreditForPaidInstallment,
  reserveStayCredit,
  consumeStayCreditReservation,
  releaseStayCreditReservation,
  computeCardObligationAfterStayCredit,
  StayCreditError
} = require('../services/stayCreditService');
const StayCreditReservation = require('../models/StayCreditReservation');
const {
  settleSplitBookingCancellation,
  neutralizeStripeInvoice,
  isWithinCancellationWindow
} = require('../services/splitCancellationSettlementService');
const {
  transferSplitBookingDates,
  recomputeDueAtDateOnly,
  SplitDateTransferError
} = require('../services/splitDateTransferService');
const {
  createDraftPaymentTermTemplate,
  updateDraftPaymentTermTemplate,
  activatePaymentTermTemplate,
  retirePaymentTermTemplate,
  clonePaymentTermTemplate,
  PaymentTermManagementError,
  MGMT_CODES
} = require('../services/paymentTermManagementService');
const {
  resolvePaymentTermTemplate,
  assertActivePaymentTermTemplate
} = require('../services/paymentTermService');
const {
  addCancellationReviewNote,
  resolveCancellationReview
} = require('../services/splitCancellationReviewService');
const {
  mapSplitPaymentPanel
} = require('../services/ops/readModels/reservationDetailReadModel');
const { buildSplitPaymentOffer } = require('../services/paymentScheduleService');

let mongoServer;
const ENTITY_ID = new mongoose.Types.ObjectId();

function futureDue(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function policySnapshotFullRefund() {
  return {
    code: 'normal-stay',
    version: 1,
    currency: 'EUR',
    correctionWindowHours: 24,
    correctionWindowMinDaysBeforeArrival: 7,
    refundTiers: [
      { minDaysBeforeArrival: 30, refundPercent: 100 },
      { minDaysBeforeArrival: 14, refundPercent: 50 },
      { minDaysBeforeArrival: 0, refundPercent: 0 }
    ],
    noShowRefundPercent: 0,
    earlyDepartureRefundPercent: 0,
    organizerCancellationRule: { allowFullRefundOrReplacement: true, requiresManualExecution: true }
  };
}

function policySnapshotNoRefund() {
  return {
    ...policySnapshotFullRefund(),
    correctionWindowHours: 0,
    refundTiers: [{ minDaysBeforeArrival: 0, refundPercent: 0 }]
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
    stripePaidAmountCents: 20000,
    paymentSettlementStatus: 'partially_paid',
    chosenPaymentScheduleSnapshot: {
      totalCents: 50000,
      currency: 'EUR',
      allowDateTransfer: true,
      bookingDateOnly: futureDue(-5),
      installments: [
        { sequence: 1, amountCents: 20000, dueAtDateOnly: futureDue(-5) },
        { sequence: 2, amountCents: 30000, dueAtDateOnly: futureDue(20) }
      ]
    },
    chosenPaymentScheduleSnapshotHash: 'hash',
    cabinId: ENTITY_ID,
    status: 'confirmed',
    checkoutId: `chk_${new mongoose.Types.ObjectId()}`,
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

async function makeInstallments(booking, opts = {}) {
  const paid = await BookingInstallment.create({
    bookingId: booking._id,
    sequence: 1,
    amountCents: 20000,
    currency: 'EUR',
    amountType: 'percent_bps',
    dueRule: 'checkout',
    dueOffsetDays: 0,
    dueAtDateOnly: futureDue(-5),
    cancellationTreatment: opts.firstTreatment || 'stay_credit',
    status: 'paid',
    paidAt: new Date(),
    provisioningState: 'unprovisioned'
  });
  const future = await BookingInstallment.create({
    bookingId: booking._id,
    sequence: 2,
    amountCents: 30000,
    currency: 'EUR',
    amountType: 'remainder',
    dueRule: 'days_before_arrival',
    dueOffsetDays: 30,
    dueAtDateOnly: futureDue(20),
    cancellationTreatment: opts.secondTreatment || 'standard_policy',
    status: opts.futureStatus || 'scheduled',
    stripeInvoiceId: opts.invoiceId || 'in_future',
    stripeInvoiceStatus: opts.invoiceStatus || 'draft',
    provisioningState: 'provisioned',
    ...opts.futureOverrides
  });
  return { paid, future };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await Booking.syncIndexes();
  await BookingInstallment.syncIndexes();
  await StayCredit.syncIndexes();
  await StayCreditReservation.syncIndexes();
  await PaymentTermTemplate.syncIndexes();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Booking.deleteMany({});
  await BookingInstallment.deleteMany({});
  await StayCredit.deleteMany({});
  await PaymentTermTemplate.deleteMany({});
  await RatePlan.deleteMany({});
});

// ——— Stay credit ———

test('eligible cancellation issues exact full reservation-payment stay credit once', async () => {
  const booking = await makeBooking();
  const { paid } = await makeInstallments(booking);
  const window = isWithinCancellationWindow({ booking, now: new Date() });
  assert.equal(window.withinWindow, true);

  const r1 = await issueStayCreditForPaidInstallment({ booking, installment: paid });
  assert.equal(r1.idempotentReplay, false);
  assert.equal(r1.stayCredit.issuedCents, 20000);
  assert.equal(r1.stayCredit.remainingCents, 20000);
  assert.equal(r1.stayCredit.cashConvertible, false);

  const r2 = await issueStayCreditForPaidInstallment({ booking, installment: paid });
  assert.equal(r2.idempotentReplay, true);
  assert.equal(String(r2.stayCredit._id), String(r1.stayCredit._id));
  assert.equal(await StayCredit.countDocuments({ originBookingId: booking._id }), 1);
});

test('outside cancellation window / forfeit create no automatic stay credit path', async () => {
  const booking = await makeBooking({
    resourceFinalizationSnapshot: { cancellationPolicy: policySnapshotNoRefund() },
    checkIn: new Date(Date.now() + 2 * 86400000)
  });
  await makeInstallments(booking, { firstTreatment: 'stay_credit', secondTreatment: 'forfeit' });
  const result = await settleSplitBookingCancellation({
    booking,
    reason: 'guest cancel',
    actorId: 'ops',
    stripe: { invoices: { retrieve: async () => ({ id: 'in_future', status: 'draft' }), del: async () => ({}) } }
  });
  assert.equal(result.stayCreditIssuedCents, 0);
  const stayAlloc = result.allocations.find((a) => a.sequence === 1);
  assert.equal(stayAlloc.retainedCents, 20000);
  assert.equal(await StayCredit.countDocuments({}), 0);
  const forfeit = result.allocations.find((a) => a.sequence === 2 && a.voided);
  assert.ok(forfeit);
});

test('standard_policy follows cash-refund path; no double credit+refund', async () => {
  const booking = await makeBooking();
  await makeInstallments(booking, {
    firstTreatment: 'standard_policy',
    secondTreatment: 'standard_policy',
    futureStatus: 'paid',
    futureOverrides: { paidAt: new Date(), stripeInvoiceId: null }
  });
  // Mark seq2 paid with same amount
  await BookingInstallment.updateOne(
    { bookingId: booking._id, sequence: 2 },
    { $set: { status: 'paid', paidAt: new Date() } }
  );
  booking.stripePaidAmountCents = 50000;
  await booking.save();

  const result = await settleSplitBookingCancellation({
    booking: await Booking.findById(booking._id),
    reason: 'cancel',
    actorId: 'ops'
  });
  assert.equal(result.stayCreditIssuedCents, 0);
  assert.ok(result.cashRefundCents > 0);
  assert.equal(
    result.cashRefundCents + result.retainedCents + result.stayCreditIssuedCents,
    50000
  );
  for (const a of result.allocations.filter((x) => x.paidCents > 0)) {
    assert.equal(a.cashRefundCents + a.retainedCents + a.stayCreditIssuedCents, a.paidCents);
    assert.ok(!(a.cashRefundCents > 0 && a.stayCreditIssuedCents > 0));
  }
});

test('partial + concurrent reservation cannot overspend', async () => {
  const booking = await makeBooking();
  const { paid } = await makeInstallments(booking);
  const { stayCredit } = await issueStayCreditForPaidInstallment({ booking, installment: paid });

  const a = await reserveStayCredit({
    code: stayCredit.code,
    amountCents: 12000,
    checkoutSessionId: 'chk_partial_a',
    guestEmail: 'ada@example.com',
    expiresAt: new Date(Date.now() + 3600000)
  });
  assert.equal(a.reservation.amountCents, 12000);
  const after = await StayCredit.findById(stayCredit._id);
  assert.equal(after.remainingCents, 8000);

  await assert.rejects(
    () =>
      reserveStayCredit({
        code: stayCredit.code,
        amountCents: 9000,
        checkoutSessionId: 'chk_partial_b',
        guestEmail: 'ada@example.com',
        expiresAt: new Date(Date.now() + 3600000)
      }),
    (err) => err instanceof StayCreditError && err.code === 'INSUFFICIENT_BALANCE'
  );

  const [c1, c2] = await Promise.all([
    reserveStayCredit({
      code: stayCredit.code,
      amountCents: 5000,
      checkoutSessionId: 'chk_partial_c1',
      guestEmail: 'ada@example.com',
      expiresAt: new Date(Date.now() + 3600000)
    }).catch((e) => e),
    reserveStayCredit({
      code: stayCredit.code,
      amountCents: 5000,
      checkoutSessionId: 'chk_partial_c2',
      guestEmail: 'ada@example.com',
      expiresAt: new Date(Date.now() + 3600000)
    }).catch((e) => e)
  ]);
  const ok = [c1, c2].filter((x) => x && x.reservation);
  const fail = [c1, c2].filter((x) => x instanceof StayCreditError);
  assert.ok(ok.length >= 1);
  assert.ok(fail.length >= 1 || ok.every((x) => x.stayCredit.remainingCents >= 0));
  const final = await StayCredit.findById(stayCredit._id);
  assert.ok(final.remainingCents >= 0);
  assert.ok(final.remainingCents <= 8000);
});

test('applying stay credit disables split offer and reduces card obligation', () => {
  const obligation = computeCardObligationAfterStayCredit({
    totalCents: 50000,
    stayCreditRemainingCents: 20000,
    applyCents: 20000
  });
  assert.equal(obligation.cardObligationCents, 30000);
  assert.equal(obligation.splitDisabled, true);

  const offer = buildSplitPaymentOffer({
    totalCents: 30000,
    currency: 'EUR',
    bookingDateOnly: futureDue(0),
    arrivalDateOnly: futureDue(40),
    stayCreditAppliedCents: 20000,
    template: {
      code: 'split-a',
      internalName: 'Split',
      version: 1,
      status: 'active',
      currency: 'EUR',
      scheduleKind: 'percent_split',
      allowDateTransfer: false,
      legs: [
        {
          sequence: 1,
          amountType: 'percent_bps',
          amountValue: 4000,
          dueRule: 'checkout',
          dueOffsetDays: 0,
          cancellationTreatment: 'stay_credit'
        },
        {
          sequence: 2,
          amountType: 'remainder',
          amountValue: null,
          dueRule: 'days_before_arrival',
          dueOffsetDays: 30,
          cancellationTreatment: 'standard_policy'
        }
      ]
    }
  });
  assert.equal(offer.eligible, false);
  assert.equal(offer.reason, 'ACCOMMODATION_VOUCHER_APPLIED');
});

// ——— Cancellation / invoices ———

test('unpaid installments voided; draft neutralized; paid invoice untouched; replay converges', async () => {
  const booking = await makeBooking();
  await makeInstallments(booking, { invoiceId: 'in_draft', invoiceStatus: 'draft' });
  const store = { deleted: 0, voided: [] };
  const stripe = {
    invoices: {
      retrieve: async (id) => {
        if (store.voided.includes(id) || store.deleted) return { id, status: 'void' };
        return { id, status: 'draft' };
      },
      del: async (id) => {
        store.deleted += 1;
        store.voided.push(id);
        return { id, status: 'void' };
      },
      voidInvoice: async (id) => {
        store.voided.push(id);
        return { id, status: 'void' };
      }
    }
  };

  const first = await settleSplitBookingCancellation({
    booking,
    reason: 'cancel',
    actorId: 'ops',
    stripe
  });
  assert.equal(first.idempotentReplay, false);
  assert.ok(first.stayCreditIssuedCents === 20000);
  const fut = await BookingInstallment.findOne({ bookingId: booking._id, sequence: 2 });
  assert.equal(fut.status, 'voided');

  // paid invoice must not be voided
  const paidInst = await BookingInstallment.findOne({ bookingId: booking._id, sequence: 1 });
  const neutPaid = await neutralizeStripeInvoice({
    installment: { ...paidInst.toObject(), stripeInvoiceId: 'in_paid' },
    stripe: {
      invoices: {
        retrieve: async () => ({ id: 'in_paid', status: 'paid' })
      }
    }
  });
  assert.equal(neutPaid.reason, 'paid_untouched');

  const second = await settleSplitBookingCancellation({
    booking: await Booking.findById(booking._id),
    reason: 'cancel',
    actorId: 'ops',
    stripe
  });
  assert.equal(second.idempotentReplay, true);
});

test('finalized unpaid invoice voided safely', async () => {
  const booking = await makeBooking();
  const { future } = await makeInstallments(booking, {
    invoiceId: 'in_open',
    invoiceStatus: 'open',
    futureStatus: 'failed'
  });
  const stripe = {
    invoices: {
      retrieve: async () => ({ id: 'in_open', status: 'open' }),
      voidInvoice: async () => ({ id: 'in_open', status: 'void' })
    }
  };
  const neut = await neutralizeStripeInvoice({ installment: future, stripe });
  assert.equal(neut.neutralized, true);
  const row = await BookingInstallment.findById(future._id);
  assert.equal(row.status, 'voided');
});

// ——— Date transfer ———

test('date transfer: disallow / first ok / second rejected / amounts unchanged / due recalc', async () => {
  const booking = await makeBooking({
    chosenPaymentScheduleSnapshot: {
      totalCents: 50000,
      currency: 'EUR',
      allowDateTransfer: false,
      bookingDateOnly: '2026-09-01',
      installments: []
    }
  });
  await makeInstallments(booking);
  await assert.rejects(
    () =>
      transferSplitBookingDates({
        bookingId: booking._id,
        newCheckIn: new Date('2026-12-01'),
        newCheckOut: new Date('2026-12-03'),
        skipAvailabilityCheck: true
      }),
    (e) => e.code === 'DATE_TRANSFER_DISALLOWED'
  );

  booking.chosenPaymentScheduleSnapshot.allowDateTransfer = true;
  booking.chosenPaymentScheduleSnapshot.bookingDateOnly = '2026-09-01';
  booking.markModified('chosenPaymentScheduleSnapshot');
  await booking.save();

  const stripe = {
    invoices: {
      retrieve: async () => ({
        id: 'in_future',
        status: 'draft',
        customer: null,
        currency: 'eur',
        amount_due: 30000,
        total: 30000,
        metadata: { bookingId: String(booking._id) }
      }),
      update: async (id, params) => ({ id, status: 'draft', ...params, currency: 'eur', amount_due: 30000, customer: 'cus_x', metadata: { bookingId: String(booking._id) } })
    }
  };

  // Fix booking customer for verify — skip by making invoiceMatches soft: provide customer on booking
  booking.stripeCustomerId = 'cus_x';
  await booking.save();

  const r1 = await transferSplitBookingDates({
    bookingId: booking._id,
    newCheckIn: new Date('2026-12-20'),
    newCheckOut: new Date('2026-12-22'),
    skipAvailabilityCheck: true,
    stripe,
    actorId: 'ops'
  });
  assert.equal(r1.idempotentReplay, false);
  assert.equal(r1.dateTransferCount, 1);
  const fut = await BookingInstallment.findOne({ bookingId: booking._id, sequence: 2 });
  assert.equal(fut.amountCents, 30000);
  // days_before_arrival 30 from 2026-12-20 => 2026-11-20
  assert.equal(fut.dueAtDateOnly, '2026-11-20');

  await assert.rejects(
    () =>
      transferSplitBookingDates({
        bookingId: booking._id,
        newCheckIn: new Date('2027-01-10'),
        newCheckOut: new Date('2027-01-12'),
        skipAvailabilityCheck: true,
        stripe
      }),
    (e) => e instanceof SplitDateTransferError && e.code === 'DATE_TRANSFER_LIMIT'
  );
});

test('days_after_booking retains original booking anchor; finalized invoice blocks; past due blocks', async () => {
  assert.equal(
    recomputeDueAtDateOnly(
      { dueRule: 'days_after_booking', dueOffsetDays: 10, dueAtDateOnly: '2026-09-11' },
      { bookingDateOnly: '2026-09-01', newArrivalDateOnly: '2026-12-01' }
    ),
    '2026-09-11'
  );

  const booking = await makeBooking();
  await makeInstallments(booking, { invoiceStatus: 'open' });
  await assert.rejects(
    () =>
      transferSplitBookingDates({
        bookingId: booking._id,
        newCheckIn: new Date('2026-12-20'),
        newCheckOut: new Date('2026-12-22'),
        skipAvailabilityCheck: true,
        stripe: {
          invoices: {
            retrieve: async () => ({ id: 'in_future', status: 'open' })
          }
        }
      }),
    (e) => e.code === 'INVOICE_NOT_SCHEDULABLE'
  );

  const b2 = await makeBooking();
  await makeInstallments(b2, {
    invoiceId: 'in_past_due_case',
    invoiceStatus: 'draft',
    futureOverrides: { dueOffsetDays: 1, dueRule: 'days_before_arrival' }
  });
  await BookingInstallment.updateOne(
    { bookingId: b2._id, sequence: 2 },
    { $set: { dueOffsetDays: 1, dueRule: 'days_before_arrival', stripeInvoiceId: null } }
  );
  await assert.rejects(
    () =>
      transferSplitBookingDates({
        bookingId: b2._id,
        newCheckIn: new Date(Date.now() + 86400000),
        newCheckOut: new Date(Date.now() + 2 * 86400000),
        skipAvailabilityCheck: true,
        now: new Date()
      }),
    (e) => e.code === 'NEW_DUE_DATE_PAST'
  );
});

test('availability required when checker not skipped', async () => {
  const booking = await makeBooking();
  await makeInstallments(booking, { invoiceId: null });
  await assert.rejects(
    () =>
      transferSplitBookingDates({
        bookingId: booking._id,
        newCheckIn: new Date('2026-12-20'),
        newCheckOut: new Date('2026-12-22'),
        skipAvailabilityCheck: false,
        availabilityCheckFn: async () => false
      }),
    (e) => e.code === 'AVAILABILITY_REQUIRED'
  );
});

// ——— PaymentTerm Ops ———

test('PaymentTerm draft editable; active/retired immutable; activate/retire/clone; historical resolve', async () => {
  const draft = await createDraftPaymentTermTemplate({
    operator: 'ops@test',
    input: {
      code: 'split-stay',
      internalName: 'Split stay',
      version: 1,
      scheduleKind: 'percent_split',
      allowDateTransfer: true,
      legs: [
        {
          sequence: 1,
          amountType: 'percent_bps',
          amountValue: 3000,
          dueRule: 'checkout',
          dueOffsetDays: 0,
          cancellationTreatment: 'stay_credit'
        },
        {
          sequence: 2,
          amountType: 'remainder',
          amountValue: null,
          dueRule: 'days_before_arrival',
          dueOffsetDays: 30,
          cancellationTreatment: 'standard_policy'
        }
      ]
    }
  });
  assert.equal(draft.status, 'draft');

  const updated = await updateDraftPaymentTermTemplate({
    id: draft.id,
    operator: 'ops@test',
    input: { internalName: 'Split stay v1' },
    expectedRevision: draft.revision
  });
  assert.equal(updated.internalName, 'Split stay v1');

  const active = await activatePaymentTermTemplate({ id: draft.id, operator: 'ops@test' });
  assert.equal(active.status, 'active');

  await assert.rejects(
    () =>
      updateDraftPaymentTermTemplate({
        id: draft.id,
        operator: 'ops@test',
        input: { internalName: 'nope' }
      }),
    (e) => e instanceof PaymentTermManagementError && e.code === MGMT_CODES.IMMUTABLE_TEMPLATE
  );

  const cloned = await clonePaymentTermTemplate({ id: draft.id, operator: 'ops@test' });
  assert.equal(cloned.version, 2);
  assert.equal(cloned.status, 'draft');

  const retired = await retirePaymentTermTemplate({ id: draft.id, operator: 'ops@test' });
  assert.equal(retired.status, 'retired');

  await assert.rejects(
    () =>
      updateDraftPaymentTermTemplate({
        id: draft.id,
        operator: 'ops@test',
        input: { internalName: 'nope2' }
      }),
    (e) => e.code === MGMT_CODES.IMMUTABLE_TEMPLATE
  );

  const historical = await resolvePaymentTermTemplate('split-stay', 1);
  assert.equal(historical.status, 'retired');
  assert.equal(historical.version, 1);

  await assert.rejects(
    () => assertActivePaymentTermTemplate('split-stay', 1),
    (e) => e.code === 'PAYMENT_TERM_NOT_ACTIVE'
  );
});

// ——— Ops read model / review ———

test('ops split panel read model; review resolve does not cancel; no raw PM leakage', async () => {
  const booking = await makeBooking({
    stripeReusablePaymentMethodId: 'pm_secret',
    stripeCustomerId: 'cus_secret',
    cancellationReview: {
      status: 'open',
      reason: 'unpaid_split_installment',
      installmentSequence: 2,
      openedAt: new Date()
    }
  });
  const { paid, future } = await makeInstallments(booking);
  await issueStayCreditForPaidInstallment({ booking, installment: paid });

  const panel = mapSplitPaymentPanel(
    booking.toObject(),
    [paid.toObject(), future.toObject()],
    await StayCredit.find({ originBookingId: booking._id })
  );
  assert.equal(panel.paymentChoice, 'split');
  assert.ok(panel.installments.length === 2);
  const json = JSON.stringify(panel);
  assert.doesNotMatch(json, /pm_secret|cus_secret/);

  const beforeStatus = booking.status;
  const resolved = await resolveCancellationReview({
    bookingId: booking._id,
    note: 'Guest will pay via hosted invoice',
    actorId: 'ops'
  });
  assert.equal(resolved.bookingStatus, beforeStatus);
  assert.equal(resolved.bookingStatus, 'confirmed');
  assert.equal(resolved.cancellationReview.status, 'resolved');

  await addCancellationReviewNote({
    bookingId: booking._id,
    text: 'should fail — already resolved'
  }).then(
    () => assert.fail('expected failure'),
    (err) => assert.equal(err.code, 'REVIEW_NOT_OPEN')
  );
});
