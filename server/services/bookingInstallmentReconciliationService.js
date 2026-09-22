/**
 * SP5B — Idempotent BookingInstallment reconciliation for split bookings.
 * Converges the complete expected installment set on every finalize replay path.
 */
'use strict';

const { getPaymentChoice } = require('./splitPaymentChoiceService');

class BookingInstallmentReconciliationError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'BookingInstallmentReconciliationError';
    this.code = code;
    this.details = details;
  }
}

const RECONCILE_CODES = Object.freeze({
  NOT_SPLIT: 'INSTALLMENT_RECONCILE_NOT_SPLIT',
  SCHEDULE_MISSING: 'INSTALLMENT_RECONCILE_SCHEDULE_MISSING',
  SCHEDULE_INVALID: 'INSTALLMENT_RECONCILE_SCHEDULE_INVALID',
  CONFLICT: 'INSTALLMENT_RECONCILE_CONFLICT',
  INCOMPLETE: 'INSTALLMENT_RECONCILE_INCOMPLETE',
  DUPLICATE_SEQUENCE: 'INSTALLMENT_RECONCILE_DUPLICATE_SEQUENCE',
  TOTAL_MISMATCH: 'INSTALLMENT_RECONCILE_TOTAL_MISMATCH',
  BOOKING_REQUIRED: 'INSTALLMENT_RECONCILE_BOOKING_REQUIRED'
});

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

/**
 * Frozen chosen schedule is the session offer snapshot (copied onto Booking at create).
 */
function getFrozenChosenSchedule(session, booking = null) {
  const fromSession = session && session.splitPaymentOfferSnapshot;
  if (fromSession && Array.isArray(fromSession.installments) && fromSession.installments.length) {
    return fromSession;
  }
  const fromBooking = booking && booking.chosenPaymentScheduleSnapshot;
  if (fromBooking && Array.isArray(fromBooking.installments) && fromBooking.installments.length) {
    return fromBooking;
  }
  return null;
}

function assertChosenScheduleIntegrity(session, booking = null) {
  if (!session || getPaymentChoice(session) !== 'split') {
    throw new BookingInstallmentReconciliationError(
      RECONCILE_CODES.NOT_SPLIT,
      'Session is not a split payment choice'
    );
  }
  const schedule = getFrozenChosenSchedule(session, booking);
  if (!schedule || !Array.isArray(schedule.installments) || schedule.installments.length < 2) {
    throw new BookingInstallmentReconciliationError(
      RECONCILE_CODES.SCHEDULE_MISSING,
      'Frozen chosen payment schedule is missing or incomplete'
    );
  }
  const sequences = schedule.installments.map((i) => Number(i.sequence));
  const unique = new Set(sequences);
  if (unique.size !== sequences.length) {
    throw new BookingInstallmentReconciliationError(
      RECONCILE_CODES.SCHEDULE_INVALID,
      'Frozen schedule has duplicate installment sequences'
    );
  }
  if (!sequences.includes(1)) {
    throw new BookingInstallmentReconciliationError(
      RECONCILE_CODES.SCHEDULE_INVALID,
      'Frozen schedule is missing installment sequence 1'
    );
  }
  return schedule;
}

function buildExpectedRows({ booking, session, paymentIntentId, schedule, now }) {
  const bookingId = booking._id;
  const checkoutSessionId = session.checkoutId ? String(session.checkoutId) : null;
  const currency = String(
    schedule.currency || session.currency || booking.currency || 'EUR'
  ).toUpperCase();
  const rows = [];
  for (const inst of schedule.installments) {
    const sequence = Number(inst.sequence);
    const isInitial = sequence === 1;
    rows.push({
      bookingId,
      checkoutSessionId,
      sequence,
      amountCents: Math.trunc(Number(inst.amountCents)),
      currency,
      status: isInitial ? 'paid' : 'scheduled',
      dueAtDateOnly: String(inst.dueAtDateOnly),
      amountType: String(inst.amountType),
      dueRule: String(inst.dueRule),
      dueOffsetDays: Number(inst.dueOffsetDays) || 0,
      cancellationTreatment: String(inst.cancellationTreatment),
      stripePaymentIntentId: isInitial && paymentIntentId ? String(paymentIntentId) : null,
      paidAt: isInitial ? now : null,
      revision: 1,
      provisioningState: isInitial ? 'provisioned' : 'unprovisioned'
    });
  }
  return rows;
}

function conflictFields(existing, expected) {
  const mismatches = [];
  const checks = [
    ['amountCents', Number(existing.amountCents), Number(expected.amountCents)],
    ['dueAtDateOnly', dateOnly(existing.dueAtDateOnly), expected.dueAtDateOnly],
    [
      'cancellationTreatment',
      String(existing.cancellationTreatment || ''),
      expected.cancellationTreatment
    ],
    ['amountType', String(existing.amountType || ''), expected.amountType],
    ['dueRule', String(existing.dueRule || ''), expected.dueRule],
    ['dueOffsetDays', Number(existing.dueOffsetDays) || 0, expected.dueOffsetDays],
    ['currency', String(existing.currency || '').toUpperCase(), expected.currency]
  ];
  for (const [field, actual, want] of checks) {
    if (actual !== want) mismatches.push({ field, actual, expected: want });
  }
  if (String(existing.status || '') !== expected.status) {
    mismatches.push({
      field: 'status',
      actual: existing.status || null,
      expected: expected.status
    });
  }
  if (expected.sequence === 1) {
    const existingPi = existing.stripePaymentIntentId
      ? String(existing.stripePaymentIntentId)
      : null;
    if (expected.stripePaymentIntentId && existingPi && existingPi !== expected.stripePaymentIntentId) {
      mismatches.push({
        field: 'stripePaymentIntentId',
        actual: existingPi,
        expected: expected.stripePaymentIntentId
      });
    }
  }
  return mismatches;
}

/**
 * Ensure the complete expected BookingInstallment set exists for a split booking.
 * Idempotent by { bookingId, sequence }. Never silently overwrites conflicts.
 */
async function reconcileBookingInstallmentsForSplit({
  booking,
  session,
  paymentIntentId = null,
  BookingInstallmentModel,
  now = new Date()
} = {}) {
  if (!booking?._id) {
    throw new BookingInstallmentReconciliationError(
      RECONCILE_CODES.BOOKING_REQUIRED,
      'booking is required for installment reconciliation'
    );
  }
  if (!session || getPaymentChoice(session) !== 'split') {
    return { reconciled: false, reason: 'not_split', count: 0 };
  }
  if (String(booking.paymentSettlementStatus || '') !== 'partially_paid') {
    return { reconciled: false, reason: 'not_partially_paid', count: 0 };
  }
  if (!BookingInstallmentModel) {
    throw new BookingInstallmentReconciliationError(
      RECONCILE_CODES.BOOKING_REQUIRED,
      'BookingInstallmentModel is required'
    );
  }

  const schedule = assertChosenScheduleIntegrity(session, booking);
  const expectedRows = buildExpectedRows({
    booking,
    session,
    paymentIntentId:
      paymentIntentId ||
      booking.stripePaymentIntentId ||
      session.canonicalPaymentIntentId ||
      null,
    schedule,
    now
  });

  for (const expected of expectedRows) {
    const existing = await BookingInstallmentModel.findOne({
      bookingId: expected.bookingId,
      sequence: expected.sequence
    });

    if (!existing) {
      try {
        await BookingInstallmentModel.create(expected);
      } catch (err) {
        if (err && (err.code === 11000 || String(err.code) === '11000')) {
          const raced = await BookingInstallmentModel.findOne({
            bookingId: expected.bookingId,
            sequence: expected.sequence
          });
          if (!raced) throw err;
          const mismatches = conflictFields(raced, expected);
          if (mismatches.length) {
            throw new BookingInstallmentReconciliationError(
              RECONCILE_CODES.CONFLICT,
              `Existing BookingInstallment sequence ${expected.sequence} conflicts with expected schedule`,
              { sequence: expected.sequence, mismatches }
            );
          }
          continue;
        }
        throw err;
      }
      continue;
    }

    const mismatches = conflictFields(existing, expected);
    if (mismatches.length) {
      throw new BookingInstallmentReconciliationError(
        RECONCILE_CODES.CONFLICT,
        `Existing BookingInstallment sequence ${expected.sequence} conflicts with expected schedule`,
        { sequence: expected.sequence, mismatches }
      );
    }

    // Heal missing PI / paidAt on initial installment when commercial fields already match.
    if (expected.sequence === 1) {
      const patch = {};
      if (
        expected.stripePaymentIntentId &&
        !existing.stripePaymentIntentId
      ) {
        patch.stripePaymentIntentId = expected.stripePaymentIntentId;
      }
      if (String(existing.status || '') === 'paid' && !existing.paidAt && expected.paidAt) {
        patch.paidAt = expected.paidAt;
      }
      if (Object.keys(patch).length) {
        await BookingInstallmentModel.updateOne({ _id: existing._id }, { $set: patch });
      }
    }
  }

  const all = await BookingInstallmentModel.find({ bookingId: booking._id }).lean();
  const bySequence = new Map();
  for (const row of all) {
    const seq = Number(row.sequence);
    if (bySequence.has(seq)) {
      throw new BookingInstallmentReconciliationError(
        RECONCILE_CODES.DUPLICATE_SEQUENCE,
        `Duplicate BookingInstallment sequence ${seq}`,
        { sequence: seq }
      );
    }
    bySequence.set(seq, row);
  }

  for (const expected of expectedRows) {
    if (!bySequence.has(expected.sequence)) {
      throw new BookingInstallmentReconciliationError(
        RECONCILE_CODES.INCOMPLETE,
        `Missing BookingInstallment sequence ${expected.sequence} after reconciliation`,
        { sequence: expected.sequence }
      );
    }
  }

  const expectedTotal = expectedRows.reduce((s, r) => s + r.amountCents, 0);
  const actualTotal = expectedRows.reduce((s, r) => {
    const row = bySequence.get(r.sequence);
    return s + Math.trunc(Number(row.amountCents) || 0);
  }, 0);
  if (actualTotal !== expectedTotal) {
    throw new BookingInstallmentReconciliationError(
      RECONCILE_CODES.TOTAL_MISMATCH,
      'BookingInstallment total does not match frozen schedule total',
      { expectedTotal, actualTotal }
    );
  }

  if (all.length !== expectedRows.length) {
    throw new BookingInstallmentReconciliationError(
      RECONCILE_CODES.INCOMPLETE,
      'BookingInstallment set count does not match frozen schedule',
      { expectedCount: expectedRows.length, actualCount: all.length }
    );
  }

  return {
    reconciled: true,
    count: expectedRows.length,
    totalAmountCents: expectedTotal
  };
}

function sessionNeedsSplitInstallmentReconciliation(session) {
  return getPaymentChoice(session) === 'split' && Boolean(getFrozenChosenSchedule(session));
}

module.exports = {
  RECONCILE_CODES,
  BookingInstallmentReconciliationError,
  reconcileBookingInstallmentsForSplit,
  sessionNeedsSplitInstallmentReconciliation,
  getFrozenChosenSchedule,
  assertChosenScheduleIntegrity,
  conflictFields,
  buildExpectedRows
};
