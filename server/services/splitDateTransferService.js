/**
 * SP7B — resumable date transfer: prepare → stripe_rescheduling → stripe_rescheduled → commit.
 * Booking arrival/departure and dateTransferCount stay unchanged until commit.
 * Same-date early-return must not bypass an unfinished operation.
 */
'use strict';

const Stripe = require('stripe');
const moment = require('moment-timezone');
const crypto = require('crypto');
const { STRIPE_API_VERSION } = require('../config/stripeApiVersion');
const { PROPERTY_TIMEZONE, formatSofiaDateOnly } = require('../utils/dateTime');
const Booking = require('../models/Booking');
const BookingInstallment = require('../models/BookingInstallment');
const {
  dueDateFinalizeAtSofia,
  dueDateFinalizeUnixSeconds,
  isFinalizeTimestampInPast
} = require('./splitPaymentInvoiceTime');
const { invoiceMatchesInstallment } = require('./splitPaymentInvoiceProvisioningService');
const { INVOICE_PROVISIONING_OPERATION_VERSION } = require('../config/splitPaymentCollectionConfig');

const OP_STATUSES = {
  PREPARED: 'prepared',
  STRIPE_RESCHEDULING: 'stripe_rescheduling',
  STRIPE_RESCHEDULED: 'stripe_rescheduled',
  COMMITTED: 'committed',
  NEEDS_REVIEW: 'needs_review'
};

const TERMINAL_OK = new Set([OP_STATUSES.COMMITTED]);
const PENDING = new Set([
  OP_STATUSES.PREPARED,
  OP_STATUSES.STRIPE_RESCHEDULING,
  OP_STATUSES.STRIPE_RESCHEDULED
]);

class SplitDateTransferError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'SplitDateTransferError';
    this.code = code;
    this.details = details;
  }
}

function getStripe(stripeOverride) {
  if (stripeOverride) return stripeOverride;
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION });
}

function toDateOnly(value) {
  if (value instanceof Date) return formatSofiaDateOnly(value);
  const s = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return formatSofiaDateOnly(new Date(value));
}

function addDays(dateOnly, days) {
  return moment
    .tz(dateOnly, 'YYYY-MM-DD', true, PROPERTY_TIMEZONE)
    .startOf('day')
    .add(Number(days), 'days')
    .format('YYYY-MM-DD');
}

function recomputeDueAtDateOnly(installment, { bookingDateOnly, newArrivalDateOnly }) {
  const rule = String(installment.dueRule || '');
  const offset = Number(installment.dueOffsetDays) || 0;
  if (rule === 'checkout') return installment.dueAtDateOnly;
  if (rule === 'days_after_booking') {
    return addDays(bookingDateOnly, offset);
  }
  if (rule === 'days_before_arrival') {
    return addDays(newArrivalDateOnly, -offset);
  }
  return installment.dueAtDateOnly;
}

function datesMatch(a, b) {
  return toDateOnly(a) === toDateOnly(b);
}

async function assertAvailability({
  booking,
  newCheckIn,
  newCheckOut,
  availabilityCheckFn = null
}) {
  if (typeof availabilityCheckFn === 'function') {
    const ok = await availabilityCheckFn({ booking, newCheckIn, newCheckOut });
    if (!ok) {
      throw new SplitDateTransferError(
        'AVAILABILITY_REQUIRED',
        'Requested dates are not available'
      );
    }
    return;
  }
  throw new SplitDateTransferError(
    'AVAILABILITY_CHECK_REQUIRED',
    'Authoritative availability check is required for date transfer'
  );
}

function buildOperationId() {
  return crypto.randomBytes(12).toString('hex');
}

async function persistOperation(BookingModel, bookingId, operation) {
  await BookingModel.updateOne(
    { _id: bookingId },
    { $set: { dateTransferOperation: operation } }
  );
  return operation;
}

async function prepareDateTransferOperation({
  booking,
  newCheckIn,
  newCheckOut,
  actorId,
  idempotencyKey,
  now,
  BookingInstallmentModel,
  stripeClient
}) {
  const bookingDateOnly =
    booking.chosenPaymentScheduleSnapshot?.bookingDateOnly ||
    toDateOnly(booking.createdAt) ||
    toDateOnly(now);
  const newArrivalDateOnly = toDateOnly(newCheckIn);

  const installments = await BookingInstallmentModel.find({ bookingId: booking._id }).sort({
    sequence: 1
  });
  const dueDateChanges = [];

  for (const inst of installments) {
    if (String(inst.status) === 'paid') continue;
    if (['voided', 'cancelled', 'waived'].includes(String(inst.status))) continue;

    const oldDue = inst.dueAtDateOnly;
    const newDue = recomputeDueAtDateOnly(inst, {
      bookingDateOnly,
      newArrivalDateOnly
    });

    if (Number(inst.sequence) >= 2 && isFinalizeTimestampInPast(newDue, now)) {
      throw new SplitDateTransferError(
        'NEW_DUE_DATE_PAST',
        'Recalculated future due date is already due/past — automatic transfer not eligible',
        { installmentId: String(inst._id), newDue }
      );
    }

    let stripeInvoiceId = inst.stripeInvoiceId ? String(inst.stripeInvoiceId) : null;
    if (stripeInvoiceId && stripeClient?.invoices?.retrieve) {
      const inv = await stripeClient.invoices.retrieve(stripeInvoiceId);
      const status = String(inv.status || '');
      if (status !== 'draft') {
        throw new SplitDateTransferError(
          'INVOICE_NOT_SCHEDULABLE',
          'Affected invoice is already finalized/payable — automatic transfer blocked',
          { invoiceId: inv.id, status }
        );
      }
    }

    dueDateChanges.push({
      installmentId: String(inst._id),
      sequence: inst.sequence,
      stripeInvoiceId,
      oldDueAtDateOnly: oldDue,
      newDueAtDateOnly: newDue,
      amountCents: inst.amountCents,
      stripeScheduleStatus: 'pending'
    });
  }

  return {
    operationId: buildOperationId(),
    idempotencyKey,
    status: OP_STATUSES.PREPARED,
    actorId: String(actorId),
    oldCheckIn: booking.checkIn,
    oldCheckOut: booking.checkOut,
    newCheckIn,
    newCheckOut,
    dueDateChanges,
    error: null,
    preparedAt: now,
    stripeReschedulingAt: null,
    stripeRescheduledAt: null,
    committedAt: null,
    needsReviewAt: null
  };
}

async function rescheduleStripeInvoices({
  operation,
  booking,
  stripeClient,
  BookingInstallmentModel,
  BookingModel,
  now
}) {
  const next = {
    ...operation,
    status: OP_STATUSES.STRIPE_RESCHEDULING,
    stripeReschedulingAt: operation.stripeReschedulingAt || now,
    dueDateChanges: (operation.dueDateChanges || []).map((c) => ({ ...c }))
  };
  await persistOperation(BookingModel, booking._id, next);

  for (const change of next.dueDateChanges) {
    if (change.stripeScheduleStatus === 'done') continue;

    const finalizeUnix = dueDateFinalizeUnixSeconds(change.newDueAtDateOnly);

    if (change.stripeInvoiceId && stripeClient?.invoices?.update) {
      try {
        const scheduleKey = `dd:split-inv:v${INVOICE_PROVISIONING_OPERATION_VERSION}:${booking._id}:${change.sequence}:xfer-schedule:${change.newDueAtDateOnly}`;
        const updatedInv = await stripeClient.invoices.update(
          String(change.stripeInvoiceId),
          {
            auto_advance: true,
            automatically_finalizes_at: finalizeUnix
          },
          { idempotencyKey: scheduleKey }
        );

        // Adopt already-correct schedule (idempotent retry).
        const liveFinalize = Number(updatedInv.automatically_finalizes_at) || 0;
        if (liveFinalize && liveFinalize !== finalizeUnix) {
          // External drift — fail closed to needs_review
          next.status = OP_STATUSES.NEEDS_REVIEW;
          next.needsReviewAt = now;
          next.error = {
            code: 'INVOICE_SCHEDULE_DRIFT',
            message: 'Invoice finalize timestamp does not match expected transfer schedule',
            invoiceId: change.stripeInvoiceId,
            expected: finalizeUnix,
            actual: liveFinalize
          };
          await persistOperation(BookingModel, booking._id, next);
          throw new SplitDateTransferError(
            'NEEDS_REVIEW',
            'Invoice state incompatible with date transfer — needs review',
            next.error
          );
        }

        const inst = await BookingInstallmentModel.findById(change.installmentId);
        if (inst) {
          const mismatches = invoiceMatchesInstallment(updatedInv, {
            booking,
            installment: {
              ...(inst.toObject ? inst.toObject() : inst),
              dueAtDateOnly: change.newDueAtDateOnly
            }
          });
          const critical = mismatches.filter((m) =>
            ['customer', 'currency', 'amount', 'metadata.bookingId'].includes(m.field)
          );
          if (critical.length) {
            next.status = OP_STATUSES.NEEDS_REVIEW;
            next.needsReviewAt = now;
            next.error = {
              code: 'INVOICE_VERIFY_FAILED',
              mismatches: critical
            };
            await persistOperation(BookingModel, booking._id, next);
            throw new SplitDateTransferError(
              'NEEDS_REVIEW',
              'Rescheduled invoice no longer matches installment obligation',
              next.error
            );
          }
        }
      } catch (err) {
        if (err instanceof SplitDateTransferError) throw err;
        // Leave operation pending for resume; Booking dates unchanged.
        await persistOperation(BookingModel, booking._id, next);
        throw err;
      }
    }

    change.stripeScheduleStatus = 'done';
    await persistOperation(BookingModel, booking._id, next);
  }

  next.status = OP_STATUSES.STRIPE_RESCHEDULED;
  next.stripeRescheduledAt = now;
  await persistOperation(BookingModel, booking._id, next);
  return next;
}

async function commitDateTransfer({
  operation,
  booking,
  BookingModel,
  BookingInstallmentModel,
  now,
  actorId
}) {
  const oldTotal = booking.totalPrice;
  const oldTotalCents = booking.totalValueCents;

  for (const change of operation.dueDateChanges || []) {
    const finalizeAt = dueDateFinalizeAtSofia(change.newDueAtDateOnly);
    await BookingInstallmentModel.updateOne(
      { _id: change.installmentId },
      {
        $set: {
          dueAtDateOnly: change.newDueAtDateOnly,
          automaticallyFinalizesAt: change.stripeInvoiceId ? finalizeAt : undefined
        }
      }
    );
  }

  const historyEntry = {
    transferId: operation.operationId,
    idempotencyKey: operation.idempotencyKey,
    transferredAt: now,
    actorId: String(actorId || operation.actorId),
    oldCheckIn: operation.oldCheckIn,
    oldCheckOut: operation.oldCheckOut,
    newCheckIn: operation.newCheckIn,
    newCheckOut: operation.newCheckOut,
    dueDateChanges: (operation.dueDateChanges || []).map((c) => ({
      installmentId: c.installmentId,
      sequence: c.sequence,
      oldDueAtDateOnly: c.oldDueAtDateOnly,
      newDueAtDateOnly: c.newDueAtDateOnly,
      amountCents: c.amountCents
    }))
  };

  const claimed = await BookingModel.findOneAndUpdate(
    {
      _id: booking._id,
      status: 'confirmed',
      $or: [
        { dateTransferCount: { $exists: false } },
        { dateTransferCount: null },
        { dateTransferCount: 0 }
      ],
      'dateTransferOperation.operationId': operation.operationId,
      'dateTransferOperation.status': {
        $in: [OP_STATUSES.STRIPE_RESCHEDULED, OP_STATUSES.PREPARED, OP_STATUSES.STRIPE_RESCHEDULING]
      }
    },
    {
      $set: {
        checkIn: new Date(operation.newCheckIn),
        checkOut: new Date(operation.newCheckOut),
        dateTransferCount: 1,
        dateTransferOperation: {
          ...operation,
          status: OP_STATUSES.COMMITTED,
          committedAt: now
        }
      },
      $push: { dateTransferHistory: historyEntry }
    },
    { new: true }
  );

  if (!claimed) {
    const again = await BookingModel.findById(booking._id);
    if (
      again &&
      Number(again.dateTransferCount) === 1 &&
      again.dateTransferOperation &&
      String(again.dateTransferOperation.status) === OP_STATUSES.COMMITTED &&
      String(again.dateTransferOperation.idempotencyKey) === String(operation.idempotencyKey)
    ) {
      return { booking: again, idempotentReplay: true };
    }
    throw new SplitDateTransferError(
      'DATE_TRANSFER_COMMIT_CONFLICT',
      'Could not commit date transfer — transfer slot unavailable or operation mismatch'
    );
  }

  if (Number(claimed.totalPrice) !== Number(oldTotal)) {
    throw new SplitDateTransferError('TOTAL_MUTATED', 'Booking total must remain unchanged');
  }
  if (
    oldTotalCents != null &&
    claimed.totalValueCents != null &&
    Number(claimed.totalValueCents) !== Number(oldTotalCents)
  ) {
    throw new SplitDateTransferError('TOTAL_CENTS_MUTATED', 'Booking totalValueCents must remain unchanged');
  }

  for (const change of operation.dueDateChanges || []) {
    const live = await BookingInstallmentModel.findById(change.installmentId);
    if (live && Number(live.amountCents) !== Number(change.amountCents)) {
      throw new SplitDateTransferError('AMOUNT_MUTATED', 'Installment amounts must remain unchanged');
    }
  }

  return { booking: claimed, idempotentReplay: false };
}

async function transferSplitBookingDates({
  bookingId,
  newCheckIn,
  newCheckOut,
  actorId = 'ops',
  idempotencyKey = null,
  stripe = null,
  availabilityCheckFn = null,
  skipAvailabilityCheck = false,
  BookingModel = Booking,
  BookingInstallmentModel = BookingInstallment,
  now = new Date()
} = {}) {
  const booking = await BookingModel.findById(bookingId);
  if (!booking) {
    throw new SplitDateTransferError('BOOKING_NOT_FOUND', 'Booking not found');
  }
  if (String(booking.status) !== 'confirmed') {
    throw new SplitDateTransferError('BOOKING_NOT_CONFIRMED', 'Only confirmed bookings can transfer dates');
  }

  const schedule = booking.chosenPaymentScheduleSnapshot;
  if (!schedule || schedule.allowDateTransfer !== true) {
    throw new SplitDateTransferError(
      'DATE_TRANSFER_DISALLOWED',
      'Frozen payment schedule does not allow date transfer'
    );
  }

  const newIn = new Date(newCheckIn);
  const newOut = new Date(newCheckOut);
  if (Number.isNaN(newIn.getTime()) || Number.isNaN(newOut.getTime())) {
    throw new SplitDateTransferError('INVALID_DATES', 'newCheckIn and newCheckOut are required');
  }
  if (newOut.getTime() <= newIn.getTime()) {
    throw new SplitDateTransferError('INVALID_DATES', 'checkOut must be after checkIn');
  }

  const key =
    idempotencyKey ||
    `split-date-transfer:${booking._id}:${toDateOnly(newIn)}:${toDateOnly(newOut)}`;

  const op = booking.dateTransferOperation;
  const transferCount = Number(booking.dateTransferCount) || 0;

  // Completed success — idempotent replay for same request.
  if (transferCount >= 1 || (op && String(op.status) === OP_STATUSES.COMMITTED)) {
    const last = Array.isArray(booking.dateTransferHistory)
      ? booking.dateTransferHistory[booking.dateTransferHistory.length - 1]
      : null;
    if (
      (op && String(op.idempotencyKey) === key) ||
      (last && String(last.idempotencyKey) === key) ||
      (last &&
        datesMatch(last.newCheckIn, newIn) &&
        datesMatch(last.newCheckOut, newOut))
    ) {
      return {
        idempotentReplay: true,
        booking,
        dueDateChanges: (last && last.dueDateChanges) || (op && op.dueDateChanges) || [],
        dateTransferCount: transferCount || 1,
        operation: op
      };
    }
    throw new SplitDateTransferError(
      'DATE_TRANSFER_LIMIT',
      'Maximum one successful date transfer already used'
    );
  }

  // Pending operation — same request resumes; different request fails closed.
  if (op && PENDING.has(String(op.status))) {
    if (String(op.idempotencyKey) !== key) {
      throw new SplitDateTransferError(
        'DATE_TRANSFER_PENDING',
        'A different date transfer operation is already pending',
        { pendingKey: op.idempotencyKey, requestedKey: key }
      );
    }
  } else if (op && String(op.status) === OP_STATUSES.NEEDS_REVIEW) {
    if (String(op.idempotencyKey) === key) {
      throw new SplitDateTransferError(
        'NEEDS_REVIEW',
        'Date transfer needs review; refusing automatic resume',
        op.error
      );
    }
    throw new SplitDateTransferError(
      'DATE_TRANSFER_NEEDS_REVIEW',
      'A prior date transfer needs review; no second transfer allowed',
      op.error
    );
  }

  // Same-date early-return ONLY when no unfinished operation.
  if (
    datesMatch(booking.checkIn, newIn) &&
    datesMatch(booking.checkOut, newOut) &&
    !(op && PENDING.has(String(op.status)))
  ) {
    return {
      idempotentReplay: true,
      booking,
      dueDateChanges: [],
      dateTransferCount: transferCount,
      sameDateNoop: true
    };
  }

  if (!skipAvailabilityCheck && !(op && PENDING.has(String(op.status)))) {
    await assertAvailability({
      booking,
      newCheckIn: newIn,
      newCheckOut: newOut,
      availabilityCheckFn
    });
  }

  const stripeClient = getStripe(stripe);
  let operation = op && PENDING.has(String(op.status)) ? { ...op } : null;

  if (!operation) {
    operation = await prepareDateTransferOperation({
      booking,
      newCheckIn: newIn,
      newCheckOut: newOut,
      actorId,
      idempotencyKey: key,
      now,
      BookingInstallmentModel,
      stripeClient
    });
    await persistOperation(BookingModel, booking._id, operation);
    // Critical: Booking dates still old here.
    const fresh = await BookingModel.findById(booking._id);
    if (
      !datesMatch(fresh.checkIn, booking.checkIn) ||
      !datesMatch(fresh.checkOut, booking.checkOut)
    ) {
      throw new SplitDateTransferError(
        'PREPARE_MUTATED_DATES',
        'Prepare phase must not mutate Booking dates'
      );
    }
  }

  if (
    String(operation.status) === OP_STATUSES.PREPARED ||
    String(operation.status) === OP_STATUSES.STRIPE_RESCHEDULING
  ) {
    operation = await rescheduleStripeInvoices({
      operation,
      booking,
      stripeClient,
      BookingInstallmentModel,
      BookingModel,
      now
    });
  }

  if (String(operation.status) === OP_STATUSES.STRIPE_RESCHEDULED) {
    const committed = await commitDateTransfer({
      operation,
      booking,
      BookingModel,
      BookingInstallmentModel,
      now,
      actorId
    });
    return {
      idempotentReplay: committed.idempotentReplay,
      booking: committed.booking,
      dueDateChanges: operation.dueDateChanges,
      dateTransferCount: committed.booking.dateTransferCount,
      operation: committed.booking.dateTransferOperation
    };
  }

  if (String(operation.status) === OP_STATUSES.COMMITTED) {
    const live = await BookingModel.findById(booking._id);
    return {
      idempotentReplay: true,
      booking: live,
      dueDateChanges: operation.dueDateChanges,
      dateTransferCount: live.dateTransferCount,
      operation: live.dateTransferOperation
    };
  }

  throw new SplitDateTransferError(
    'DATE_TRANSFER_INCOMPLETE',
    'Date transfer operation did not reach committed state',
    { status: operation.status }
  );
}

module.exports = {
  SplitDateTransferError,
  OP_STATUSES,
  recomputeDueAtDateOnly,
  transferSplitBookingDates,
  prepareDateTransferOperation,
  rescheduleStripeInvoices,
  commitDateTransfer
};
