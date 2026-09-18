'use strict';

/**
 * B8F2B1B — Attempt-fenced exact voucher reservations.
 * Uses CheckoutResourceAttempt fence + dual-marker monetary ledger.
 * Disconnected from resource orchestrator, PaymentIntent adapters, routes, and booking finalisers.
 */

const mongoose = require('mongoose');
const GiftVoucher = require('../../models/GiftVoucher');
const GiftVoucherRedemption = require('../../models/GiftVoucherRedemption');
const GiftVoucherEvent = require('../../models/GiftVoucherEvent');
const CheckoutResourceAttempt = require('../../models/CheckoutResourceAttempt');
const {
  LEDGER_PROTOCOL_VERSION_V1
} = require('../../models/GiftVoucherRedemption');
const {
  assertCheckoutResourceAttemptFence,
  failCheckoutResourceAttemptFence,
  annotateCheckoutResourceAttemptFenceFailure,
  FENCE_ERROR_CODES,
  CheckoutResourceAttemptFenceError
} = require('../checkout/checkoutResourceAttemptFenceService');
const { normalizeVoucherCodeInput } = require('./giftVoucherCodeService');
const {
  buildOperationId,
  buildLedgerEventKey,
  claimPendingLedgerOperationV1,
  debitPendingLedgerOperationV1,
  voidPendingLedgerOperationV1,
  transferLedgerOperationMarkerV1,
  transferRedemptionMarkerV1,
  clearRedemptionMarkerV1,
  clearOperationMarkerV1,
  renewUnmarkedRedemptionExpiryV1,
  atomicRestoreV1,
  findEmbeddedOperation,
  writeOrRepairLedgerEvent,
  assertDualAttemptOwnership,
  hasAcquisitionMarker,
  markerString,
  ensureVoucherLedgerIndexesForTests,
  assertVoucherLedgerAuthoritativeIndexes,
  VOUCHER_LEDGER_INTEGRITY,
  VOUCHER_RESERVATION_IN_PROGRESS,
  VOUCHER_ATTEMPT_MARKER_MISMATCH,
  __setAfterV1CompensationPartialHookForTests,
  __invokeCompensationPartialHookForTests,
  __invokeBeforeCompensationReleaseCasHookForTests
} = require('./giftVoucherLedgerService');

const VOUCHER_COMPENSATION_INCOMPLETE = 'VOUCHER_COMPENSATION_INCOMPLETE';
const VOUCHER_COMPENSATION_SEAL_COMPLETED = 'VOUCHER_COMPENSATION_SEAL_COMPLETED';
const VOUCHER_COMPENSATION_STATE_UNPROVEN = 'VOUCHER_COMPENSATION_STATE_UNPROVEN';
const VOUCHER_MARKER_CLEAR_INCOMPLETE = 'VOUCHER_MARKER_CLEAR_INCOMPLETE';
const VOUCHER_IDENTITY_MISMATCH = 'VOUCHER_IDENTITY_MISMATCH';
const VOUCHER_ATTEMPT_IN_PROGRESS = 'VOUCHER_ATTEMPT_IN_PROGRESS';
const VOUCHER_ATTEMPT_REFERENCE_INVALID = 'VOUCHER_ATTEMPT_REFERENCE_INVALID';

/** Test-only seams for deterministic same-attempt release/acquire barrier ordering. */
let beforeMarkerlessClassifyHook = null;
let afterAttemptPendingMarkedHook = null;
let afterAttemptPreDebitFenceHook = null;
let afterAttemptDebitHook = null;
let afterAttemptReservedCasHook = null;
let afterAttemptRestoreBeforeEventHook = null;
let afterAttemptEventBeforeMarkerClearHook = null;
let afterAttemptFirstMarkerClearHook = null;

function __setBeforeMarkerlessClassifyHookForTests(fn) {
  beforeMarkerlessClassifyHook = typeof fn === 'function' ? fn : null;
}
function __setAfterAttemptPendingMarkedHookForTests(fn) {
  afterAttemptPendingMarkedHook = typeof fn === 'function' ? fn : null;
}
function __setAfterAttemptPreDebitFenceHookForTests(fn) {
  afterAttemptPreDebitFenceHook = typeof fn === 'function' ? fn : null;
}
function __setAfterAttemptDebitHookForTests(fn) {
  afterAttemptDebitHook = typeof fn === 'function' ? fn : null;
}
function __setAfterAttemptReservedCasHookForTests(fn) {
  afterAttemptReservedCasHook = typeof fn === 'function' ? fn : null;
}
function __setAfterAttemptRestoreBeforeEventHookForTests(fn) {
  afterAttemptRestoreBeforeEventHook = typeof fn === 'function' ? fn : null;
}
function __setAfterAttemptEventBeforeMarkerClearHookForTests(fn) {
  afterAttemptEventBeforeMarkerClearHook = typeof fn === 'function' ? fn : null;
}
function __setAfterAttemptFirstMarkerClearHookForTests(fn) {
  afterAttemptFirstMarkerClearHook = typeof fn === 'function' ? fn : null;
}

async function __invokeBeforeMarkerlessClassifyHookForTests(payload) {
  if (typeof beforeMarkerlessClassifyHook === 'function') {
    await beforeMarkerlessClassifyHook(payload);
  }
}
async function __invokeAfterAttemptPendingMarkedHookForTests(payload) {
  if (typeof afterAttemptPendingMarkedHook === 'function') {
    await afterAttemptPendingMarkedHook(payload);
  }
}
async function __invokeAfterAttemptPreDebitFenceHookForTests(payload) {
  if (typeof afterAttemptPreDebitFenceHook === 'function') {
    await afterAttemptPreDebitFenceHook(payload);
  }
}
async function __invokeAfterAttemptDebitHookForTests(payload) {
  if (typeof afterAttemptDebitHook === 'function') {
    await afterAttemptDebitHook(payload);
  }
}
async function __invokeAfterAttemptReservedCasHookForTests(payload) {
  if (typeof afterAttemptReservedCasHook === 'function') {
    await afterAttemptReservedCasHook(payload);
  }
}
async function __invokeAfterAttemptRestoreBeforeEventHookForTests(payload) {
  if (typeof afterAttemptRestoreBeforeEventHook === 'function') {
    await afterAttemptRestoreBeforeEventHook(payload);
  }
}
async function __invokeAfterAttemptEventBeforeMarkerClearHookForTests(payload) {
  if (typeof afterAttemptEventBeforeMarkerClearHook === 'function') {
    await afterAttemptEventBeforeMarkerClearHook(payload);
  }
}
async function __invokeAfterAttemptFirstMarkerClearHookForTests(payload) {
  if (typeof afterAttemptFirstMarkerClearHook === 'function') {
    await afterAttemptFirstMarkerClearHook(payload);
  }
}

function buildStructuredError(code, fields = {}) {
  const err = new Error(code);
  err.code = code;
  Object.assign(err, fields);
  return err;
}

function toNow(deps = {}) {
  if (deps.now != null) {
    const d = deps.now instanceof Date ? deps.now : new Date(deps.now);
    if (Number.isNaN(d.getTime())) {
      throw buildStructuredError('INVALID_NOW', { now: String(deps.now) });
    }
    return d;
  }
  return new Date();
}

function isSafePositiveIntegerCents(value) {
  return Number.isInteger(value) && Number.isSafeInteger(value) && value > 0;
}

function buildAttemptReservationKey({
  checkoutId,
  attemptId,
  giftVoucherId,
  amountCents,
  currency,
  quoteSnapshotHash
}) {
  return [
    'gvr:v1',
    `chk:${String(checkoutId).trim()}`,
    `att:${String(attemptId).trim()}`,
    `v:${String(giftVoucherId)}`,
    `amt:${Number(amountCents)}`,
    `cur:${String(currency)}`,
    `snap:${String(quoteSnapshotHash).trim()}`
  ].join(':');
}

async function assertExactFence(input, deps) {
  const now = toNow(deps);
  return assertCheckoutResourceAttemptFence(
    {
      checkoutId: input.checkoutId,
      attemptId: input.acquisitionAttemptId || input.attemptId,
      quoteSnapshotHash: input.quoteSnapshotHash
    },
    { ...deps, now }
  );
}

async function resolveVoucherByCode(voucherCode, now) {
  const normalized = normalizeVoucherCodeInput(voucherCode);
  if (!normalized) {
    throw buildStructuredError('VOUCHER_CODE_REQUIRED', { voucherCode });
  }
  const voucher = await GiftVoucher.findOne({ code: normalized }).lean();
  if (!voucher) {
    throw buildStructuredError('VOUCHER_NOT_FOUND', { voucherCode: normalized });
  }
  if (!['active', 'partially_redeemed'].includes(voucher.status)) {
    throw buildStructuredError('VOUCHER_NOT_REDEEMABLE', {
      voucherCode: normalized,
      status: voucher.status
    });
  }
  if (voucher.currency !== 'EUR') {
    throw buildStructuredError('VOUCHER_CURRENCY_MISMATCH', {
      currency: voucher.currency
    });
  }
  if (!(voucher.expiresAt instanceof Date) || voucher.expiresAt.getTime() <= now.getTime()) {
    throw buildStructuredError('VOUCHER_EXPIRED', {
      voucherCode: normalized,
      expiresAt: voucher.expiresAt
    });
  }
  return { voucher, voucherCode: normalized };
}

function assertStableIdentity(redemption, expected) {
  const checks = [
    ['checkoutId', String(redemption.checkoutId || ''), String(expected.checkoutId)],
    ['giftVoucherId', String(redemption.giftVoucherId), String(expected.giftVoucherId)],
    ['voucherCode', String(redemption.voucherCode || ''), String(expected.voucherCode)],
    ['amountAppliedCents', Number(redemption.amountAppliedCents), Number(expected.amountCents)],
    ['currency', String(redemption.currency || ''), String(expected.currency)],
    ['quoteSnapshotHash', String(redemption.quoteSnapshotHash || ''), String(expected.quoteSnapshotHash)]
  ];
  for (const [field, found, want] of checks) {
    if (found !== want) {
      throw buildStructuredError(VOUCHER_IDENTITY_MISMATCH, {
        field,
        found,
        expected: want,
        redemptionId: String(redemption._id)
      });
    }
  }
  if (expected.redemptionId != null && String(redemption._id) !== String(expected.redemptionId)) {
    throw buildStructuredError(VOUCHER_IDENTITY_MISMATCH, {
      field: 'redemptionId',
      found: String(redemption._id),
      expected: String(expected.redemptionId)
    });
  }
  if (expected.operationId != null && String(redemption.operationId) !== String(expected.operationId)) {
    throw buildStructuredError(VOUCHER_IDENTITY_MISMATCH, {
      field: 'operationId',
      found: String(redemption.operationId),
      expected: String(expected.operationId)
    });
  }
}

function isAttemptTerminalOrNonLive(attemptDoc) {
  if (!attemptDoc) return false;
  if (attemptDoc.isLive === true && attemptDoc.status === 'open') return false;
  return (
    attemptDoc.isLive === false ||
    ['released', 'failed', 'expired'].includes(attemptDoc.status)
  );
}

async function loadAttemptById(attemptId, deps = {}) {
  const Model = deps.CheckoutResourceAttempt || CheckoutResourceAttempt;
  const id = String(attemptId || '').trim();
  if (!id) {
    throw buildStructuredError(VOUCHER_ATTEMPT_REFERENCE_INVALID, {
      reason: 'missing_attempt_id'
    });
  }
  const doc = await Model.findOne({ attemptId: id }).lean();
  if (!doc) {
    throw buildStructuredError(VOUCHER_ATTEMPT_REFERENCE_INVALID, {
      reason: 'attempt_not_found',
      attemptId: id
    });
  }
  if (!doc.checkoutId || typeof doc.checkoutId !== 'string') {
    throw buildStructuredError(VOUCHER_ATTEMPT_REFERENCE_INVALID, {
      reason: 'malformed_attempt_checkout',
      attemptId: id
    });
  }
  if (!doc.quoteSnapshotHash || typeof doc.quoteSnapshotHash !== 'string') {
    throw buildStructuredError(VOUCHER_ATTEMPT_REFERENCE_INVALID, {
      reason: 'malformed_attempt_snapshot',
      attemptId: id
    });
  }
  return doc;
}

async function findLiveCheckoutRedemption(checkoutId) {
  return GiftVoucherRedemption.findOne({
    ledgerProtocolVersion: LEDGER_PROTOCOL_VERSION_V1,
    checkoutId: String(checkoutId),
    status: { $in: ['pending_debit', 'reserved'] }
  }).lean();
}

async function claimRedemptionMarker({ redemptionId, attemptId, fromAttemptId = null }) {
  const toId = String(attemptId).trim();
  if (fromAttemptId) {
    return transferRedemptionMarkerV1({
      redemptionId,
      fromAttemptId,
      toAttemptId: toId
    });
  }
  const existing = await GiftVoucherRedemption.findById(redemptionId).lean();
  if (!existing) {
    throw buildStructuredError('REDEMPTION_NOT_FOUND', { redemptionId: String(redemptionId) });
  }
  if (markerString(existing.acquisitionAttemptId) === toId) {
    return { ok: true, alreadyTransferred: true, redemption: existing };
  }
  if (!hasAcquisitionMarker(existing.acquisitionAttemptId)) {
    const updated = await GiftVoucherRedemption.findOneAndUpdate(
      {
        _id: redemptionId,
        ledgerProtocolVersion: LEDGER_PROTOCOL_VERSION_V1,
        status: { $in: ['pending_debit', 'reserved'] },
        $or: [{ acquisitionAttemptId: null }, { acquisitionAttemptId: { $exists: false } }]
      },
      { $set: { acquisitionAttemptId: toId } },
      { new: true }
    );
    if (!updated) {
      const latest = await GiftVoucherRedemption.findById(redemptionId).lean();
      if (markerString(latest?.acquisitionAttemptId) === toId) {
        return { ok: true, alreadyTransferred: true, redemption: latest };
      }
      throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
        reason: 'claim_unmarked_redemption_failed',
        redemptionId: String(redemptionId),
        found: markerString(latest?.acquisitionAttemptId)
      });
    }
    return { ok: true, alreadyTransferred: false, redemption: updated };
  }
  throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
    reason: 'redemption_owned_by_other',
    redemptionId: String(redemptionId),
    found: markerString(existing.acquisitionAttemptId),
    expected: toId
  });
}

async function resumeAttemptDebit({
  redemption,
  attemptId,
  amountCents,
  currency,
  actor,
  note,
  now,
  checkoutId = null,
  quoteSnapshotHash = null,
  deps = {}
}) {
  const operationId = redemption.operationId;
  const attempt = String(attemptId);

  // 1. Assert exact live fence
  if (checkoutId && quoteSnapshotHash) {
    await assertExactFence(
      { checkoutId, acquisitionAttemptId: attempt, quoteSnapshotHash },
      { ...deps, now }
    );
    await __invokeAfterAttemptPreDebitFenceHookForTests({
      phase: 'after_pre_debit_fence',
      checkoutId,
      attemptId: attempt,
      redemptionId: String(redemption._id),
      operationId
    });
  }

  // 2. Assert redemption marker A and correct pending/reserved status
  let liveRedemption = await GiftVoucherRedemption.findById(redemption._id).lean();
  if (markerString(liveRedemption?.acquisitionAttemptId) !== attempt) {
    throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
      reason: 'debit_requires_redemption_marker',
      expected: attempt,
      found: markerString(liveRedemption?.acquisitionAttemptId)
    });
  }
  if (!['pending_debit', 'reserved'].includes(liveRedemption.status)) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'debit_requires_live_redemption_status',
      status: liveRedemption.status
    });
  }

  const claim = await claimPendingLedgerOperationV1({
    giftVoucherId: liveRedemption.giftVoucherId,
    redemptionId: liveRedemption._id,
    operationId,
    reservationKey: liveRedemption.reservationKey,
    amountCents,
    currency,
    acquisitionAttemptId: attempt,
    now
  });

  let voucher = claim.voucher;
  let op = findEmbeddedOperation(voucher, {
    operationId,
    redemptionId: liveRedemption._id
  });

  if (!claim.ok && claim.code === 'OPERATION_OWNED_BY_OTHER') {
    throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
      reason: 'operation_owned_by_other_on_resume',
      ownerAttemptId: claim.ownerAttemptId,
      operationId
    });
  }

  if (
    op &&
    op.state === 'pending' &&
    markerString(op.acquisitionAttemptId) === attempt &&
    markerString(liveRedemption.acquisitionAttemptId) === attempt
  ) {
    await __invokeAfterAttemptPendingMarkedHookForTests({
      phase: 'after_pending_markers',
      checkoutId,
      attemptId: attempt,
      redemptionId: String(liveRedemption._id),
      operationId,
      redemptionStatus: liveRedemption.status,
      operationState: op.state
    });
  }

  if (op && op.state === 'debited' && markerString(op.acquisitionAttemptId) === attempt) {
    // already debited under this attempt
  } else if (op && op.state === 'pending' && markerString(op.acquisitionAttemptId) === attempt) {
    // 3. Assert embedded operation marker A and state pending (already true)
    liveRedemption = await GiftVoucherRedemption.findById(liveRedemption._id).lean();
    if (markerString(liveRedemption.acquisitionAttemptId) !== attempt) {
      throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
        reason: 'redemption_marker_lost_before_debit',
        expected: attempt,
        found: markerString(liveRedemption.acquisitionAttemptId)
      });
    }
    // 4. Atomic debit with exact operation marker A
    const debit = await debitPendingLedgerOperationV1({
      giftVoucherId: liveRedemption.giftVoucherId,
      redemptionId: liveRedemption._id,
      operationId,
      reservationKey: liveRedemption.reservationKey,
      amountCents,
      currency,
      acquisitionAttemptId: attempt,
      now
    });
    if (!debit.ok) {
      throw buildStructuredError(debit.code || 'DEBIT_PENDING_FAILED', {
        redemptionId: String(liveRedemption._id),
        operationId
      });
    }
    voucher = debit.voucher;
    op = findEmbeddedOperation(voucher, { operationId, redemptionId: liveRedemption._id });
    await __invokeAfterAttemptDebitHookForTests({
      phase: 'after_debit',
      checkoutId,
      attemptId: attempt,
      redemptionId: String(liveRedemption._id),
      operationId,
      operationState: op?.state
    });
  } else if (claim.created || (op && op.state === 'pending')) {
    liveRedemption = await GiftVoucherRedemption.findById(liveRedemption._id).lean();
    if (markerString(liveRedemption.acquisitionAttemptId) !== attempt) {
      throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
        reason: 'redemption_marker_lost_before_debit',
        expected: attempt,
        found: markerString(liveRedemption.acquisitionAttemptId)
      });
    }
    if (!op || markerString(op.acquisitionAttemptId) !== attempt || op.state !== 'pending') {
      throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
        reason: 'operation_not_pending_owned_before_debit',
        state: op?.state,
        found: markerString(op?.acquisitionAttemptId)
      });
    }
    await __invokeAfterAttemptPendingMarkedHookForTests({
      phase: 'after_pending_markers',
      checkoutId,
      attemptId: attempt,
      redemptionId: String(liveRedemption._id),
      operationId,
      redemptionStatus: liveRedemption.status,
      operationState: op.state
    });
    const debit = await debitPendingLedgerOperationV1({
      giftVoucherId: liveRedemption.giftVoucherId,
      redemptionId: liveRedemption._id,
      operationId,
      reservationKey: liveRedemption.reservationKey,
      amountCents,
      currency,
      acquisitionAttemptId: attempt,
      now
    });
    if (!debit.ok) {
      throw buildStructuredError(debit.code || 'DEBIT_PENDING_FAILED', {
        redemptionId: String(liveRedemption._id),
        operationId
      });
    }
    voucher = debit.voucher;
    op = findEmbeddedOperation(voucher, { operationId, redemptionId: liveRedemption._id });
    await __invokeAfterAttemptDebitHookForTests({
      phase: 'after_debit',
      checkoutId,
      attemptId: attempt,
      redemptionId: String(liveRedemption._id),
      operationId,
      operationState: op?.state
    });
  } else {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'resume_unexpected_operation_state',
      state: op?.state,
      operationId
    });
  }

  // 5–6. Re-read both; require dual ownership before reserved transition / success
  liveRedemption = await GiftVoucherRedemption.findById(liveRedemption._id).lean();
  voucher = await GiftVoucher.findById(liveRedemption.giftVoucherId).lean();
  op = findEmbeddedOperation(voucher, { operationId, redemptionId: liveRedemption._id });
  assertDualAttemptOwnership({
    redemption: liveRedemption,
    operation: op,
    attemptId: attempt
  });
  if (op.state !== 'debited') {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'post_debit_requires_debited',
      state: op.state
    });
  }

  if (liveRedemption.status === 'pending_debit') {
    const cas = await GiftVoucherRedemption.findOneAndUpdate(
      {
        _id: liveRedemption._id,
        ledgerProtocolVersion: LEDGER_PROTOCOL_VERSION_V1,
        status: 'pending_debit',
        acquisitionAttemptId: attempt,
        operationId,
        amountAppliedCents: amountCents,
        currency
      },
      { $set: { status: 'reserved', reservedAt: now } },
      { new: true }
    );
    if (!cas) {
      const latest = await GiftVoucherRedemption.findById(liveRedemption._id).lean();
      if (!latest || latest.status !== 'reserved') {
        throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
          reason: 'attempt_pending_to_reserved_cas_failed',
          redemptionId: String(liveRedemption._id),
          status: latest?.status
        });
      }
      if (markerString(latest.acquisitionAttemptId) !== attempt) {
        throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
          reason: 'reserved_cas_marker_mismatch',
          expected: attempt,
          found: markerString(latest.acquisitionAttemptId)
        });
      }
      liveRedemption = latest;
    } else {
      liveRedemption = cas.toObject ? cas.toObject() : cas;
    }
  }

  await __invokeAfterAttemptReservedCasHookForTests({
    phase: 'after_reserved_cas',
    checkoutId,
    attemptId: attempt,
    redemptionId: String(liveRedemption._id),
    operationId,
    redemptionStatus: liveRedemption.status
  });

  // Final fence assert immediately after reserved CAS barrier. If a concurrent
  // release already failed the fence, acquire must surface fence-lost (not a
  // later marker mismatch after compensation cleared markers).
  if (checkoutId && quoteSnapshotHash) {
    await assertExactFence(
      { checkoutId, acquisitionAttemptId: attempt, quoteSnapshotHash },
      { ...deps, now }
    );
  }

  // Durable hold must still be live under the exact fence.
  liveRedemption = await GiftVoucherRedemption.findById(liveRedemption._id).lean();
  voucher = await GiftVoucher.findById(liveRedemption.giftVoucherId).lean();
  op = findEmbeddedOperation(voucher, { operationId, redemptionId: liveRedemption._id });
  assertDualAttemptOwnership({
    redemption: liveRedemption,
    operation: op,
    attemptId: attempt
  });
  if (
    !liveRedemption ||
    liveRedemption.status !== 'reserved' ||
    markerString(liveRedemption.acquisitionAttemptId) !== attempt ||
    !op ||
    op.state !== 'debited' ||
    markerString(op.acquisitionAttemptId) !== attempt
  ) {
    throw buildStructuredError(VOUCHER_COMPENSATION_INCOMPLETE, {
      reason: 'acquire_hold_lost_before_success_return',
      redemptionId: liveRedemption?._id ? String(liveRedemption._id) : null,
      status: liveRedemption?.status || null,
      redemptionMarker: markerString(liveRedemption?.acquisitionAttemptId),
      operationState: op?.state || null,
      operationMarker: markerString(op?.acquisitionAttemptId)
    });
  }

  const previousBalanceCents = voucher.balanceRemainingCents + amountCents;
  const eventResult = await writeOrRepairLedgerEvent({
    giftVoucherId: liveRedemption.giftVoucherId,
    type: 'redeemed_reserved',
    operationId,
    redemptionId: liveRedemption._id,
    actor,
    note,
    previousBalanceCents,
    newBalanceCents: voucher.balanceRemainingCents,
    deltaCents: -amountCents
  });

  return {
    redemption: liveRedemption,
    operation: op,
    voucher,
    previousBalanceCents,
    newBalanceCents: voucher.balanceRemainingCents,
    event: eventResult
  };
}

async function takeoverFromDeadAttempt({
  liveRedemption,
  currentAttemptId,
  checkoutId,
  identity,
  fence,
  deps
}) {
  const foreignId = markerString(liveRedemption.acquisitionAttemptId);
  if (!foreignId) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'takeover_requires_marked_foreign_redemption'
    });
  }
  if (foreignId === String(currentAttemptId)) {
    return { redemption: liveRedemption, outcome: 'resumed' };
  }

  const foreignAttempt = await loadAttemptById(foreignId, deps);
  if (String(foreignAttempt.checkoutId) !== String(checkoutId)) {
    throw buildStructuredError(VOUCHER_ATTEMPT_REFERENCE_INVALID, {
      reason: 'cross_checkout_attempt',
      attemptId: foreignId,
      attemptCheckoutId: foreignAttempt.checkoutId,
      checkoutId
    });
  }
  if (!isAttemptTerminalOrNonLive(foreignAttempt)) {
    throw buildStructuredError(VOUCHER_ATTEMPT_IN_PROGRESS, {
      reason: 'live_foreign_attempt_blocks_takeover',
      foreignAttemptId: foreignId,
      status: foreignAttempt.status,
      isLive: foreignAttempt.isLive
    });
  }

  assertStableIdentity(liveRedemption, identity);

  const voucher = await GiftVoucher.findById(liveRedemption.giftVoucherId).lean();
  let op = findEmbeddedOperation(voucher, {
    operationId: liveRedemption.operationId,
    redemptionId: liveRedemption._id
  });

  const now = toNow(deps);

  if (!op) {
    // Operation-first: create pending as B before touching redemption marker.
    const claimed = await claimPendingLedgerOperationV1({
      giftVoucherId: liveRedemption.giftVoucherId,
      redemptionId: liveRedemption._id,
      operationId: liveRedemption.operationId,
      reservationKey: liveRedemption.reservationKey,
      amountCents: identity.amountCents,
      currency: identity.currency,
      acquisitionAttemptId: currentAttemptId,
      now
    });
    if (!claimed.ok && claimed.code === 'OPERATION_OWNED_BY_OTHER') {
      const owner = claimed.ownerAttemptId;
      if (owner === foreignId) {
        // Re-prove A non-live before transfer
        const foreignAgain = await loadAttemptById(foreignId, deps);
        if (
          String(foreignAgain.checkoutId) !== String(checkoutId) ||
          !isAttemptTerminalOrNonLive(foreignAgain)
        ) {
          throw buildStructuredError(VOUCHER_ATTEMPT_IN_PROGRESS, {
            reason: 'foreign_became_live_during_op_race',
            foreignAttemptId: foreignId
          });
        }
        await transferLedgerOperationMarkerV1({
          giftVoucherId: liveRedemption.giftVoucherId,
          redemptionId: liveRedemption._id,
          operationId: liveRedemption.operationId,
          fromAttemptId: foreignId,
          toAttemptId: currentAttemptId,
          now
        });
      } else if (owner === String(currentAttemptId)) {
        // already B
      } else if (!owner) {
        throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
          reason: 'unmarked_operation_during_absent_op_takeover',
          operationId: liveRedemption.operationId
        });
      } else {
        const other = await loadAttemptById(owner, deps);
        if (!isAttemptTerminalOrNonLive(other) || String(other.checkoutId) !== String(checkoutId)) {
          throw buildStructuredError(VOUCHER_ATTEMPT_IN_PROGRESS, {
            reason: 'operation_owned_by_live_or_invalid_foreign',
            ownerAttemptId: owner
          });
        }
        await transferLedgerOperationMarkerV1({
          giftVoucherId: liveRedemption.giftVoucherId,
          redemptionId: liveRedemption._id,
          operationId: liveRedemption.operationId,
          fromAttemptId: owner,
          toAttemptId: currentAttemptId,
          now
        });
      }
    }

    // Only after operation is B-owned may redemption marker transfer.
    const voucherMid = await GiftVoucher.findById(liveRedemption.giftVoucherId).lean();
    const opMid = findEmbeddedOperation(voucherMid, {
      operationId: liveRedemption.operationId,
      redemptionId: liveRedemption._id
    });
    if (markerString(opMid?.acquisitionAttemptId) !== String(currentAttemptId)) {
      throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
        reason: 'operation_not_owned_before_redemption_transfer',
        found: markerString(opMid?.acquisitionAttemptId),
        expected: String(currentAttemptId)
      });
    }

    const redOwner = markerString(liveRedemption.acquisitionAttemptId);
    if (redOwner !== String(currentAttemptId)) {
      await claimRedemptionMarker({
        redemptionId: liveRedemption._id,
        attemptId: currentAttemptId,
        fromAttemptId: redOwner || foreignId
      });
    }
  } else {
    const opOwner = markerString(op.acquisitionAttemptId);
    if (opOwner === String(currentAttemptId)) {
      // crash recovery: op already B, redemption maybe still A
    } else if (opOwner === foreignId) {
      await transferLedgerOperationMarkerV1({
        giftVoucherId: liveRedemption.giftVoucherId,
        redemptionId: liveRedemption._id,
        operationId: liveRedemption.operationId,
        fromAttemptId: foreignId,
        toAttemptId: currentAttemptId,
        now
      });
    } else if (!opOwner) {
      // sealed-like mid-state should not happen on live marked redemption
      throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
        reason: 'takeover_unmarked_operation_on_marked_redemption',
        operationId: liveRedemption.operationId
      });
    } else {
      const other = await loadAttemptById(opOwner, deps);
      if (!isAttemptTerminalOrNonLive(other) || String(other.checkoutId) !== String(checkoutId)) {
        throw buildStructuredError(VOUCHER_ATTEMPT_IN_PROGRESS, {
          reason: 'operation_owned_by_live_foreign',
          ownerAttemptId: opOwner
        });
      }
      await transferLedgerOperationMarkerV1({
        giftVoucherId: liveRedemption.giftVoucherId,
        redemptionId: liveRedemption._id,
        operationId: liveRedemption.operationId,
        fromAttemptId: opOwner,
        toAttemptId: currentAttemptId,
        now
      });
    }

    const redOwner = markerString(liveRedemption.acquisitionAttemptId);
    if (redOwner !== String(currentAttemptId)) {
      await claimRedemptionMarker({
        redemptionId: liveRedemption._id,
        attemptId: currentAttemptId,
        fromAttemptId: redOwner || foreignId
      });
    }
  }

  const redemption = await GiftVoucherRedemption.findById(liveRedemption._id).lean();
  const voucherAfter = await GiftVoucher.findById(liveRedemption.giftVoucherId).lean();
  op = findEmbeddedOperation(voucherAfter, {
    operationId: redemption.operationId,
    redemptionId: redemption._id
  });
  assertDualAttemptOwnership({
    redemption,
    operation: op,
    attemptId: currentAttemptId
  });

  void fence;
  return { redemption, outcome: 'taken_over' };
}

/**
 * Reserve exact voucher amount under the live checkout resource attempt fence.
 */
async function reserveExactVoucherAmountForAttempt(input = {}, deps = {}) {
  await assertVoucherLedgerAuthoritativeIndexes();

  const checkoutId = String(input.checkoutId || '').trim();
  const attemptId = String(input.acquisitionAttemptId || '').trim();
  const quoteSnapshotHash = String(input.quoteSnapshotHash || '').trim();
  const currency = input.currency || 'EUR';
  const amountCents = input.amountCents;
  const actor = input.actor || 'system';
  const note = input.note || 'attempt exact voucher reserve';

  if (!checkoutId || !attemptId || !quoteSnapshotHash) {
    throw buildStructuredError('INVALID_ATTEMPT_RESERVE_INPUT', {
      checkoutId,
      acquisitionAttemptId: attemptId,
      quoteSnapshotHash
    });
  }
  if (!isSafePositiveIntegerCents(amountCents)) {
    throw buildStructuredError('INVALID_RESERVE_AMOUNT', { amountCents });
  }
  if (currency !== 'EUR') {
    throw buildStructuredError('VOUCHER_CURRENCY_MISMATCH', { currency });
  }

  let fence = await assertExactFence(
    { checkoutId, acquisitionAttemptId: attemptId, quoteSnapshotHash },
    deps
  );
  const bundleValidUntil = new Date(fence.bundleValidUntil);
  let now = toNow(deps);
  if (bundleValidUntil.getTime() <= now.getTime()) {
    throw new CheckoutResourceAttemptFenceError(
      FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST,
      'Fence bundleValidUntil is not in the future',
      { checkoutId, attemptId, bundleValidUntil }
    );
  }

  const { voucher, voucherCode } = await resolveVoucherByCode(input.voucherCode, now);
  if (Number(voucher.balanceRemainingCents) < Number(amountCents)) {
    throw buildStructuredError('INSUFFICIENT_VOUCHER_BALANCE', {
      balanceRemainingCents: voucher.balanceRemainingCents,
      amountCents
    });
  }

  const identity = {
    checkoutId,
    giftVoucherId: voucher._id,
    voucherCode,
    amountCents,
    currency,
    quoteSnapshotHash
  };

  const derivedKey = buildAttemptReservationKey({
    checkoutId,
    attemptId,
    giftVoucherId: voucher._id,
    amountCents,
    currency,
    quoteSnapshotHash
  });

  // Sealed unmarked reuse / live row resolution by checkout
  const liveByCheckout = await findLiveCheckoutRedemption(checkoutId);
  let outcome = 'created';
  let redemption = null;

  if (liveByCheckout) {
    const redMarker = markerString(liveByCheckout.acquisitionAttemptId);
    const liveVoucher = await GiftVoucher.findById(liveByCheckout.giftVoucherId).lean();
    const liveOp = findEmbeddedOperation(liveVoucher, {
      operationId: liveByCheckout.operationId,
      redemptionId: liveByCheckout._id
    });

    // Sealed unmarked reserved + debited
    if (
      liveByCheckout.status === 'reserved' &&
      !redMarker &&
      liveOp &&
      liveOp.state === 'debited' &&
      !hasAcquisitionMarker(liveOp.acquisitionAttemptId)
    ) {
      assertStableIdentity(liveByCheckout, identity);
      if (String(liveByCheckout.operationId) !== buildOperationId(liveByCheckout._id)) {
        throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
          reason: 'sealed_operation_id_mismatch'
        });
      }
      now = toNow(deps);
      fence = await assertExactFence(
        { checkoutId, acquisitionAttemptId: attemptId, quoteSnapshotHash },
        { ...deps, now }
      );
      if (new Date(liveByCheckout.expiresAt).getTime() < new Date(fence.bundleValidUntil).getTime()) {
        await renewUnmarkedRedemptionExpiryV1({
          redemptionId: liveByCheckout._id,
          expiresAt: fence.bundleValidUntil,
          now
        });
      }
      // Verify expiry floor after renew
      const sealed = await GiftVoucherRedemption.findById(liveByCheckout._id).lean();
      if (new Date(sealed.expiresAt).getTime() < new Date(fence.bundleValidUntil).getTime()) {
        throw buildStructuredError('INVALID_REDEMPTION_EXPIRY', {
          reason: 'sealed_expiry_below_bundle',
          expiresAt: sealed.expiresAt,
          bundleValidUntil: fence.bundleValidUntil
        });
      }
      now = toNow(deps);
      fence = await assertExactFence(
        { checkoutId, acquisitionAttemptId: attemptId, quoteSnapshotHash },
        { ...deps, now }
      );
      return {
        ok: true,
        outcome: 'reused',
        compensable: false,
        redemptionId: String(sealed._id),
        giftVoucherId: String(sealed.giftVoucherId),
        operationId: sealed.operationId,
        reservationKey: sealed.reservationKey,
        amountAppliedCents: sealed.amountAppliedCents,
        currency: sealed.currency,
        expiresAt: sealed.expiresAt,
        acquisitionAttemptId: null,
        protocolVersion: LEDGER_PROTOCOL_VERSION_V1
      };
    }

    if (redMarker === attemptId) {
      assertStableIdentity(liveByCheckout, {
        ...identity,
        redemptionId: liveByCheckout._id,
        operationId: liveByCheckout.operationId
      });
      redemption = liveByCheckout;
      outcome = 'resumed';
    } else if (redMarker) {
      const taken = await takeoverFromDeadAttempt({
        liveRedemption: liveByCheckout,
        currentAttemptId: attemptId,
        checkoutId,
        identity: {
          ...identity,
          redemptionId: liveByCheckout._id,
          operationId: liveByCheckout.operationId
        },
        fence,
        deps
      });
      redemption = taken.redemption;
      outcome = taken.outcome;
    } else {
      // live unmarked but not sealed (e.g. pending_debit unmarked B8F2B1A) — fail closed for attempt path
      throw buildStructuredError(VOUCHER_RESERVATION_IN_PROGRESS, {
        reason: 'live_unmarked_non_sealed_blocks_attempt',
        redemptionId: String(liveByCheckout._id),
        status: liveByCheckout.status
      });
    }
  }

  // Same-attempt key row (may exist if no live-by-checkout hit due to race — still check)
  if (!redemption) {
    const byKey = await GiftVoucherRedemption.findOne({
      ledgerProtocolVersion: LEDGER_PROTOCOL_VERSION_V1,
      reservationKey: derivedKey
    }).lean();
    if (byKey) {
      if (['released', 'confirmed', 'voided'].includes(byKey.status)) {
        // terminal — fall through to create is impossible due to unique key; error
        throw buildStructuredError('VOUCHER_RESERVATION_KEY_TERMINAL', {
          redemptionId: String(byKey._id),
          status: byKey.status,
          reservationKey: derivedKey
        });
      }
      assertStableIdentity(byKey, {
        ...identity,
        redemptionId: byKey._id,
        operationId: byKey.operationId
      });
      if (markerString(byKey.acquisitionAttemptId) && markerString(byKey.acquisitionAttemptId) !== attemptId) {
        const taken = await takeoverFromDeadAttempt({
          liveRedemption: byKey,
          currentAttemptId: attemptId,
          checkoutId,
          identity: {
            ...identity,
            redemptionId: byKey._id,
            operationId: byKey.operationId
          },
          fence,
          deps
        });
        redemption = taken.redemption;
        outcome = taken.outcome;
      } else {
        if (!markerString(byKey.acquisitionAttemptId)) {
          await claimRedemptionMarker({ redemptionId: byKey._id, attemptId });
          redemption = await GiftVoucherRedemption.findById(byKey._id).lean();
        } else {
          redemption = byKey;
        }
        outcome = 'resumed';
      }
    }
  }

  if (!redemption) {
    now = toNow(deps);
    fence = await assertExactFence(
      { checkoutId, acquisitionAttemptId: attemptId, quoteSnapshotHash },
      { ...deps, now }
    );
    const expiresAt = new Date(fence.bundleValidUntil);
    const redemptionId = new mongoose.Types.ObjectId();
    const operationId = buildOperationId(redemptionId);
    try {
      redemption = await GiftVoucherRedemption.create({
        _id: redemptionId,
        giftVoucherId: voucher._id,
        checkoutId,
        reservationKey: derivedKey,
        amountAppliedCents: amountCents,
        currency,
        ledgerProtocolVersion: LEDGER_PROTOCOL_VERSION_V1,
        status: 'pending_debit',
        expiresAt,
        reservedAt: now,
        operationId,
        acquisitionAttemptId: attemptId,
        quoteSnapshotHash,
        voucherCode
      });
      redemption = redemption.toObject ? redemption.toObject() : redemption;
      outcome = 'created';
    } catch (err) {
      if (err?.code === 11000) {
        const existing =
          (await GiftVoucherRedemption.findOne({
            ledgerProtocolVersion: LEDGER_PROTOCOL_VERSION_V1,
            reservationKey: derivedKey
          }).lean()) || (await findLiveCheckoutRedemption(checkoutId));
        if (!existing) throw err;
        if (['released', 'confirmed', 'voided'].includes(existing.status)) {
          throw buildStructuredError('VOUCHER_RESERVATION_KEY_TERMINAL', {
            redemptionId: String(existing._id),
            status: existing.status
          });
        }
        assertStableIdentity(existing, {
          ...identity,
          redemptionId: existing._id,
          operationId: existing.operationId
        });
        const owner = markerString(existing.acquisitionAttemptId);
        if (owner && owner !== attemptId) {
          const taken = await takeoverFromDeadAttempt({
            liveRedemption: existing,
            currentAttemptId: attemptId,
            checkoutId,
            identity: {
              ...identity,
              redemptionId: existing._id,
              operationId: existing.operationId
            },
            fence,
            deps
          });
          redemption = taken.redemption;
          outcome = taken.outcome;
        } else {
          if (!owner) {
            await claimRedemptionMarker({ redemptionId: existing._id, attemptId });
            redemption = await GiftVoucherRedemption.findById(existing._id).lean();
          } else {
            redemption = existing;
          }
          outcome = 'resumed';
        }
      } else {
        throw err;
      }
    }
  }

  // Ensure redemption marker is current attempt
  if (markerString(redemption.acquisitionAttemptId) !== attemptId) {
    const owner = markerString(redemption.acquisitionAttemptId);
    if (owner) {
      const taken = await takeoverFromDeadAttempt({
        liveRedemption: redemption,
        currentAttemptId: attemptId,
        checkoutId,
        identity: {
          ...identity,
          redemptionId: redemption._id,
          operationId: redemption.operationId
        },
        fence,
        deps
      });
      redemption = taken.redemption;
      outcome = 'taken_over';
    } else {
      await claimRedemptionMarker({ redemptionId: redemption._id, attemptId });
      redemption = await GiftVoucherRedemption.findById(redemption._id).lean();
    }
  }

  // Expiry: never shorten; renew up to bundleValidUntil with attempt ownership
  now = toNow(deps);
  fence = await assertExactFence(
    { checkoutId, acquisitionAttemptId: attemptId, quoteSnapshotHash },
    { ...deps, now }
  );
  const targetExpiry = new Date(fence.bundleValidUntil);
  if (new Date(redemption.expiresAt).getTime() < targetExpiry.getTime()) {
    const renewed = await GiftVoucherRedemption.findOneAndUpdate(
      {
        _id: redemption._id,
        acquisitionAttemptId: attemptId,
        status: { $in: ['pending_debit', 'reserved'] }
      },
      [{ $set: { expiresAt: { $max: ['$expiresAt', targetExpiry] } } }],
      { new: true }
    );
    if (renewed) {
      redemption = renewed.toObject ? renewed.toObject() : renewed;
      if (outcome === 'resumed' || outcome === 'taken_over') {
        outcome = outcome === 'taken_over' ? 'taken_over' : 'renewed';
      }
    }
  }

  now = toNow(deps);
  fence = await assertExactFence(
    { checkoutId, acquisitionAttemptId: attemptId, quoteSnapshotHash },
    { ...deps, now }
  );

  const resumed = await resumeAttemptDebit({
    redemption,
    attemptId,
    amountCents,
    currency,
    actor,
    note,
    now,
    checkoutId,
    quoteSnapshotHash,
    deps
  });

  now = toNow(deps);
  fence = await assertExactFence(
    { checkoutId, acquisitionAttemptId: attemptId, quoteSnapshotHash },
    { ...deps, now }
  );

  const finalRedemption = await GiftVoucherRedemption.findById(resumed.redemption._id).lean();
  const finalVoucher = await GiftVoucher.findById(finalRedemption.giftVoucherId).lean();
  const finalOp = findEmbeddedOperation(finalVoucher, {
    operationId: finalRedemption.operationId,
    redemptionId: finalRedemption._id
  });
  assertDualAttemptOwnership({
    redemption: finalRedemption,
    operation: finalOp,
    attemptId
  });

  if (new Date(finalRedemption.expiresAt).getTime() < new Date(fence.bundleValidUntil).getTime()) {
    throw buildStructuredError('INVALID_REDEMPTION_EXPIRY', {
      reason: 'expires_below_bundle_valid_until',
      expiresAt: finalRedemption.expiresAt,
      bundleValidUntil: fence.bundleValidUntil
    });
  }

  return {
    ok: true,
    outcome,
    compensable: true,
    redemptionId: String(finalRedemption._id),
    giftVoucherId: String(finalRedemption.giftVoucherId),
    operationId: finalRedemption.operationId,
    reservationKey: finalRedemption.reservationKey,
    amountAppliedCents: finalRedemption.amountAppliedCents,
    currency: finalRedemption.currency,
    expiresAt: finalRedemption.expiresAt,
    acquisitionAttemptId: attemptId,
    previousBalanceCents: resumed.previousBalanceCents,
    newBalanceCents: resumed.newBalanceCents,
    event: resumed.event,
    protocolVersion: LEDGER_PROTOCOL_VERSION_V1,
    bundleValidUntil: fence.bundleValidUntil
  };
}

async function assertAttemptVoucherReservationActive(input = {}, deps = {}) {
  const checkoutId = String(input.checkoutId || '').trim();
  const attemptId = String(input.acquisitionAttemptId || '').trim();
  const quoteSnapshotHash = String(input.quoteSnapshotHash || '').trim();
  const redemptionId = input.redemptionId;

  const fence = await assertExactFence(
    { checkoutId, acquisitionAttemptId: attemptId, quoteSnapshotHash },
    deps
  );
  const redemption = await GiftVoucherRedemption.findById(redemptionId).lean();
  if (!redemption || redemption.status !== 'reserved') {
    throw buildStructuredError('VOUCHER_RESERVATION_INACTIVE', {
      redemptionId: String(redemptionId),
      status: redemption?.status
    });
  }
  const voucher = await GiftVoucher.findById(redemption.giftVoucherId).lean();
  const op = findEmbeddedOperation(voucher, {
    operationId: redemption.operationId,
    redemptionId: redemption._id
  });
  assertDualAttemptOwnership({ redemption, operation: op, attemptId });
  if (!op || op.state !== 'debited') {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'active_requires_debited',
      state: op?.state
    });
  }
  const now = toNow(deps);
  if (!(redemption.expiresAt instanceof Date) || redemption.expiresAt.getTime() <= now.getTime()) {
    throw buildStructuredError('VOUCHER_RESERVATION_EXPIRED', {
      redemptionId: String(redemption._id),
      expiresAt: redemption.expiresAt
    });
  }
  if (redemption.expiresAt.getTime() < new Date(fence.bundleValidUntil).getTime()) {
    throw buildStructuredError('INVALID_REDEMPTION_EXPIRY', {
      reason: 'active_expiry_below_bundle',
      expiresAt: redemption.expiresAt,
      bundleValidUntil: fence.bundleValidUntil
    });
  }
  return {
    ok: true,
    redemptionId: String(redemption._id),
    operationId: redemption.operationId,
    expiresAt: redemption.expiresAt,
    bundleValidUntil: fence.bundleValidUntil
  };
}

async function listCurrentAttemptVoucherMarkers({ checkoutId, acquisitionAttemptId } = {}) {
  const attemptId = String(acquisitionAttemptId || '').trim();
  const redemptions = await GiftVoucherRedemption.find({
    ledgerProtocolVersion: LEDGER_PROTOCOL_VERSION_V1,
    acquisitionAttemptId: attemptId,
    ...(checkoutId ? { checkoutId: String(checkoutId) } : {})
  }).lean();

  const markers = [];
  for (const redemption of redemptions) {
    const voucher = await GiftVoucher.findById(redemption.giftVoucherId).lean();
    const op = findEmbeddedOperation(voucher, {
      operationId: redemption.operationId,
      redemptionId: redemption._id
    });
    markers.push({
      redemptionId: String(redemption._id),
      operationId: redemption.operationId,
      redemptionMarker: markerString(redemption.acquisitionAttemptId),
      operationMarker: markerString(op?.acquisitionAttemptId),
      redemptionStatus: redemption.status,
      operationState: op?.state || null
    });
  }

  // Also find ops marked for this attempt where the redemption marker may already
  // be clear (mid-clear crash on terminal released/voided rows).
  if (checkoutId) {
    const checkoutRows = await GiftVoucherRedemption.find({
      ledgerProtocolVersion: LEDGER_PROTOCOL_VERSION_V1,
      checkoutId: String(checkoutId),
      status: { $in: ['pending_debit', 'reserved', 'released', 'voided'] }
    }).lean();
    for (const row of checkoutRows) {
      const voucher = await GiftVoucher.findById(row.giftVoucherId).lean();
      const op = findEmbeddedOperation(voucher, {
        operationId: row.operationId,
        redemptionId: row._id
      });
      if (markerString(op?.acquisitionAttemptId) !== attemptId) continue;
      const already = markers.some((m) => m.redemptionId === String(row._id));
      if (already) continue;
      markers.push({
        redemptionId: String(row._id),
        operationId: row.operationId,
        redemptionMarker: markerString(row.acquisitionAttemptId),
        operationMarker: markerString(op.acquisitionAttemptId),
        redemptionStatus: row.status,
        operationState: op.state
      });
    }
  }

  return markers;
}

async function assertNoCurrentAttemptVoucherMarkers(input = {}) {
  const markers = await listCurrentAttemptVoucherMarkers(input);
  const remaining = markers.filter(
    (m) =>
      m.redemptionMarker === String(input.acquisitionAttemptId) ||
      m.operationMarker === String(input.acquisitionAttemptId)
  );
  if (remaining.length > 0) {
    throw buildStructuredError(VOUCHER_COMPENSATION_INCOMPLETE, {
      remaining
    });
  }
  return { ok: true, remaining: [] };
}

function isExactCompletedSealState(redDoc, opDoc) {
  return (
    redDoc &&
    redDoc.status === 'reserved' &&
    !hasAcquisitionMarker(redDoc.acquisitionAttemptId) &&
    opDoc &&
    opDoc.state === 'debited' &&
    !hasAcquisitionMarker(opDoc.acquisitionAttemptId)
  );
}

function assertExactSealedLinkage({ redemption, operation, checkoutId }) {
  if (!redemption || !operation) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'seal_classification_missing_authorities',
      redemptionId: redemption?._id ? String(redemption._id) : null
    });
  }
  if (String(redemption.checkoutId || '') !== String(checkoutId)) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'seal_classification_checkout_mismatch',
      expected: String(checkoutId),
      found: String(redemption.checkoutId || '')
    });
  }
  const expectedOpId = buildOperationId(redemption._id);
  if (String(redemption.operationId || '') !== expectedOpId) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'seal_classification_operation_id_mismatch',
      expected: expectedOpId,
      found: String(redemption.operationId || '')
    });
  }
  if (String(operation.operationId || '') !== expectedOpId) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'seal_classification_embedded_operation_id_mismatch',
      expected: expectedOpId,
      found: String(operation.operationId || '')
    });
  }
  if (String(operation.redemptionId) !== String(redemption._id)) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'seal_classification_redemption_linkage_mismatch',
      expected: String(redemption._id),
      found: String(operation.redemptionId)
    });
  }
  if (String(operation.reservationKey || '') !== String(redemption.reservationKey || '')) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'seal_classification_reservation_key_mismatch',
      expected: String(redemption.reservationKey || ''),
      found: String(operation.reservationKey || '')
    });
  }
  if (Number(operation.amountCents) !== Number(redemption.amountAppliedCents)) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'seal_classification_amount_mismatch',
      expected: Number(redemption.amountAppliedCents),
      found: Number(operation.amountCents)
    });
  }
  if (String(operation.currency || '') !== String(redemption.currency || '')) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'seal_classification_currency_mismatch',
      expected: String(redemption.currency || ''),
      found: String(operation.currency || '')
    });
  }
}

/**
 * Durable proof that a terminal compensation belongs to the current attempt.
 * Requires the current-attempt reservation key OR one exact keyed compensating event.
 */
async function terminalCompensationAttributedToAttempt({
  redemption,
  attemptId,
  checkoutId,
  disposition
}) {
  const att = String(attemptId || '').trim();
  if (!redemption || !att) return false;

  if (String(redemption.reservationKey || '').includes(`:att:${att}:`)) {
    return true;
  }

  const expectedType =
    disposition === 'voided' ? 'voided' : 'redeemed_released';
  const expectedKey = buildLedgerEventKey(expectedType, redemption.operationId);
  const redemptionId = String(redemption._id);
  const operationId = redemption.operationId ? String(redemption.operationId) : '';
  if (!operationId) return false;

  const events = await GiftVoucherEvent.find({
    giftVoucherId: redemption.giftVoucherId,
    type: expectedType,
    'metadata.ledgerEventKey': expectedKey,
    'metadata.redemptionId': redemptionId,
    'metadata.operationId': operationId,
    'metadata.checkoutId': String(checkoutId),
    'metadata.reservationKey': String(redemption.reservationKey || ''),
    'metadata.compensatingAttemptId': att
  })
    .select({ type: 1, metadata: 1 })
    .lean();

  if (events.length !== 1) return false;
  const meta = events[0].metadata || {};
  if (
    meta.amountAppliedCents != null &&
    Number(meta.amountAppliedCents) !== Number(redemption.amountAppliedCents)
  ) {
    return false;
  }
  if (meta.currency != null && String(meta.currency) !== String(redemption.currency || '')) {
    return false;
  }
  return true;
}

async function assertExactCompensatingEventDurable({
  giftVoucherId,
  eventType,
  checkoutId,
  attemptId,
  redemption,
  previousBalanceCents,
  newBalanceCents,
  deltaCents
}) {
  const operationId = String(redemption.operationId);
  const redemptionId = String(redemption._id);
  const ledgerEventKey = buildLedgerEventKey(eventType, operationId);
  const expectedAttempt = String(attemptId);
  const hit = await GiftVoucherEvent.findOne({
    giftVoucherId,
    type: eventType,
    'metadata.ledgerEventKey': ledgerEventKey,
    'metadata.redemptionId': redemptionId,
    'metadata.operationId': operationId,
    'metadata.checkoutId': String(checkoutId),
    'metadata.reservationKey': String(redemption.reservationKey || ''),
    'metadata.compensatingAttemptId': expectedAttempt
  }).lean();
  if (!hit) {
    throw buildStructuredError(VOUCHER_COMPENSATION_INCOMPLETE, {
      reason: 'compensating_event_not_durable',
      eventType,
      operationId,
      redemptionId,
      compensatingAttemptId: expectedAttempt
    });
  }
  const meta = hit.metadata || {};
  if (Number(meta.amountAppliedCents) !== Number(redemption.amountAppliedCents)) {
    throw buildStructuredError(VOUCHER_COMPENSATION_INCOMPLETE, {
      reason: 'compensating_event_amount_mismatch',
      expected: Number(redemption.amountAppliedCents),
      found: meta.amountAppliedCents
    });
  }
  if (String(meta.currency) !== String(redemption.currency || '')) {
    throw buildStructuredError(VOUCHER_COMPENSATION_INCOMPLETE, {
      reason: 'compensating_event_currency_mismatch',
      expected: String(redemption.currency || ''),
      found: meta.currency
    });
  }
  if (
    previousBalanceCents != null &&
    hit.previousBalanceCents != null &&
    Number(hit.previousBalanceCents) !== Number(previousBalanceCents)
  ) {
    throw buildStructuredError(VOUCHER_COMPENSATION_INCOMPLETE, {
      reason: 'compensating_event_previous_balance_mismatch'
    });
  }
  if (
    newBalanceCents != null &&
    hit.newBalanceCents != null &&
    Number(hit.newBalanceCents) !== Number(newBalanceCents)
  ) {
    throw buildStructuredError(VOUCHER_COMPENSATION_INCOMPLETE, {
      reason: 'compensating_event_new_balance_mismatch'
    });
  }
  if (
    deltaCents != null &&
    hit.deltaCents != null &&
    Number(hit.deltaCents) !== Number(deltaCents)
  ) {
    throw buildStructuredError(VOUCHER_COMPENSATION_INCOMPLETE, {
      reason: 'compensating_event_delta_mismatch'
    });
  }
  return { ok: true, event: hit, ledgerEventKey };
}

async function writeAndProveCompensatingEvent({
  giftVoucherId,
  eventType,
  checkoutId,
  attemptId,
  redemption,
  actor,
  note,
  previousBalanceCents,
  newBalanceCents,
  deltaCents
}) {
  const eventResult = await writeOrRepairLedgerEvent({
    giftVoucherId,
    type: eventType,
    operationId: redemption.operationId,
    redemptionId: redemption._id,
    actor,
    note,
    previousBalanceCents,
    newBalanceCents,
    deltaCents,
    extraMetadata: {
      compensatingAttemptId: String(attemptId),
      acquisitionAttemptId: String(attemptId),
      checkoutId: String(checkoutId),
      reservationKey: String(redemption.reservationKey || ''),
      amountAppliedCents: Number(redemption.amountAppliedCents),
      currency: String(redemption.currency || '')
    }
  });
  const proven = await assertExactCompensatingEventDurable({
    giftVoucherId,
    eventType,
    checkoutId,
    attemptId,
    redemption,
    previousBalanceCents,
    newBalanceCents,
    deltaCents
  });
  return { eventResult, proven };
}

async function clearCompensationMarkersAfterEvent({
  giftVoucherId,
  redemption,
  attemptId,
  operationState
}) {
  const clearOp = await clearOperationMarkerV1({
    giftVoucherId,
    redemptionId: redemption._id,
    operationId: redemption.operationId,
    attemptId,
    allowedStates: [operationState, 'restored', 'voided', 'debited']
  });
  if (!clearOp.ok) {
    throw buildStructuredError(VOUCHER_MARKER_CLEAR_INCOMPLETE, {
      phase: 'compensation_operation_marker',
      redemptionId: String(redemption._id),
      operationId: redemption.operationId
    });
  }
  await __invokeAfterAttemptFirstMarkerClearHookForTests({
    phase: 'after_first_marker_clear',
    clearedMarker: 'operation',
    remainingMarker: 'redemption',
    redemptionId: String(redemption._id),
    operationId: redemption.operationId,
    attemptId: String(attemptId),
    operationState
  });
  const clearRed = await clearRedemptionMarkerV1({
    redemptionId: redemption._id,
    attemptId,
    allowedStatuses: ['released', 'voided', 'reserved']
  });
  if (!clearRed.ok) {
    throw buildStructuredError(VOUCHER_MARKER_CLEAR_INCOMPLETE, {
      phase: 'compensation_redemption_marker',
      redemptionId: String(redemption._id)
    });
  }
}

/**
 * Recover after an exact mid-clear crash: one terminal marker remains, the other is null.
 * Requires an exact durable compensating event; never restores/voids again or writes events.
 * Fail-closed with VOUCHER_COMPENSATION_STATE_UNPROVEN (no fence mutation) when unproven.
 */
async function recoverExactPartialMarkerClear({
  giftVoucherId,
  redemption,
  op,
  checkoutId,
  attemptId,
  fence
}) {
  const att = String(attemptId);
  const chk = String(checkoutId);
  const redMarked = markerString(redemption?.acquisitionAttemptId) === att;
  const opMarked = markerString(op?.acquisitionAttemptId) === att;

  if (!redemption || !op || redMarked === opMarked) {
    throw buildStructuredError(VOUCHER_COMPENSATION_STATE_UNPROVEN, {
      reason: 'partial_clear_not_exact_one_marker',
      redemptionMarker: markerString(redemption?.acquisitionAttemptId),
      operationMarker: markerString(op?.acquisitionAttemptId)
    });
  }

  if (String(redemption.checkoutId || '') !== chk) {
    throw buildStructuredError(VOUCHER_COMPENSATION_STATE_UNPROVEN, {
      reason: 'partial_clear_checkout_mismatch',
      expected: chk,
      found: String(redemption.checkoutId || '')
    });
  }
  if (String(redemption.giftVoucherId) !== String(giftVoucherId)) {
    throw buildStructuredError(VOUCHER_COMPENSATION_STATE_UNPROVEN, {
      reason: 'partial_clear_voucher_mismatch'
    });
  }
  if (String(redemption.operationId || '') !== String(op.operationId || '')) {
    throw buildStructuredError(VOUCHER_COMPENSATION_STATE_UNPROVEN, {
      reason: 'partial_clear_operation_id_mismatch'
    });
  }
  if (String(op.redemptionId) !== String(redemption._id)) {
    throw buildStructuredError(VOUCHER_COMPENSATION_STATE_UNPROVEN, {
      reason: 'partial_clear_redemption_id_mismatch'
    });
  }
  if (!['restored', 'voided'].includes(op.state)) {
    throw buildStructuredError(VOUCHER_COMPENSATION_STATE_UNPROVEN, {
      reason: 'partial_clear_operation_not_terminal',
      state: op.state
    });
  }
  const expectedRedStatus = op.state === 'voided' ? 'voided' : 'released';
  if (redemption.status !== expectedRedStatus) {
    throw buildStructuredError(VOUCHER_COMPENSATION_STATE_UNPROVEN, {
      reason: 'partial_clear_redemption_status_mismatch',
      expected: expectedRedStatus,
      found: redemption.status
    });
  }
  if (String(redemption.reservationKey || '') !== String(op.reservationKey || '')) {
    throw buildStructuredError(VOUCHER_COMPENSATION_STATE_UNPROVEN, {
      reason: 'partial_clear_reservation_key_mismatch'
    });
  }
  if (Number(redemption.amountAppliedCents) !== Number(op.amountCents)) {
    throw buildStructuredError(VOUCHER_COMPENSATION_STATE_UNPROVEN, {
      reason: 'partial_clear_amount_mismatch'
    });
  }
  if (String(redemption.currency || '') !== String(op.currency || '')) {
    throw buildStructuredError(VOUCHER_COMPENSATION_STATE_UNPROVEN, {
      reason: 'partial_clear_currency_mismatch'
    });
  }

  const fenceRow = await CheckoutResourceAttempt.findOne({
    checkoutId: chk,
    attemptId: att
  }).lean();
  if (
    !fenceRow ||
    fenceRow.isLive !== true ||
    String(fenceRow.attemptId) !== String(fence?.attemptId || att) ||
    (fence?.generation != null &&
      Number(fenceRow.generation) !== Number(fence.generation)) ||
    (fence?.quoteSnapshotHash != null &&
      String(fenceRow.quoteSnapshotHash) !== String(fence.quoteSnapshotHash))
  ) {
    throw new CheckoutResourceAttemptFenceError(
      FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST,
      'Partial-clear recovery requires the same live fence identity',
      {
        checkoutId: chk,
        attemptId: att,
        status: fenceRow?.status || null,
        isLive: fenceRow?.isLive
      }
    );
  }

  const eventType = op.state === 'voided' ? 'voided' : 'redeemed_released';
  try {
    await assertExactCompensatingEventDurable({
      giftVoucherId,
      eventType,
      checkoutId: chk,
      attemptId: att,
      redemption
    });
  } catch (err) {
    if (err?.code === VOUCHER_COMPENSATION_INCOMPLETE) {
      throw buildStructuredError(VOUCHER_COMPENSATION_STATE_UNPROVEN, {
        reason: err.reason || 'partial_clear_event_unproven',
        eventType,
        redemptionId: String(redemption._id),
        operationId: redemption.operationId
      });
    }
    throw err;
  }

  if (redMarked && !opMarked) {
    const clearRed = await clearRedemptionMarkerV1({
      redemptionId: redemption._id,
      attemptId: att,
      allowedStatuses: [expectedRedStatus]
    });
    if (!clearRed.ok) {
      throw buildStructuredError(VOUCHER_MARKER_CLEAR_INCOMPLETE, {
        phase: 'partial_clear_remaining_redemption_marker',
        redemptionId: String(redemption._id)
      });
    }
  } else {
    const clearOp = await clearOperationMarkerV1({
      giftVoucherId,
      redemptionId: redemption._id,
      operationId: redemption.operationId,
      attemptId: att,
      allowedStates: [op.state]
    });
    if (!clearOp.ok) {
      throw buildStructuredError(VOUCHER_MARKER_CLEAR_INCOMPLETE, {
        phase: 'partial_clear_remaining_operation_marker',
        redemptionId: String(redemption._id),
        operationId: redemption.operationId
      });
    }
  }

  return {
    monetaryDisposition: op.state === 'restored' ? 'restored' : 'voided',
    balanceRestored: op.state === 'restored'
  };
}

/**
 * Fail the exact live fence and verify immutable identity from the pre-fail fence snapshot.
 */
async function failExactFenceBeforeSuccess({
  checkoutId,
  attemptId,
  failureCode,
  expectedFence,
  deps
}) {
  const result = await failCheckoutResourceAttemptFence(
    {
      checkoutId,
      attemptId,
      failureCode
    },
    deps
  );
  if (!result || result.status !== 'failed') {
    throw new CheckoutResourceAttemptFenceError(
      FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST,
      'Fence fail transition did not yield failed status',
      { checkoutId, attemptId, result }
    );
  }
  const row = await CheckoutResourceAttempt.findOne({
    checkoutId: String(checkoutId),
    attemptId: String(attemptId)
  }).lean();
  if (!row || row.isLive !== false || row.status !== 'failed') {
    throw new CheckoutResourceAttemptFenceError(
      FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST,
      'Fence fail transition was not durably observed',
      {
        checkoutId,
        attemptId,
        status: row?.status || null,
        isLive: row?.isLive
      }
    );
  }
  if (expectedFence) {
    if (String(row.checkoutId) !== String(expectedFence.checkoutId || checkoutId)) {
      throw new CheckoutResourceAttemptFenceError(
        FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST,
        'Fence fail identity checkout mismatch',
        { checkoutId, attemptId }
      );
    }
    if (String(row.attemptId) !== String(expectedFence.attemptId || attemptId)) {
      throw new CheckoutResourceAttemptFenceError(
        FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST,
        'Fence fail identity attempt mismatch',
        { checkoutId, attemptId }
      );
    }
    if (
      expectedFence.generation != null &&
      Number(row.generation) !== Number(expectedFence.generation)
    ) {
      throw new CheckoutResourceAttemptFenceError(
        FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST,
        'Fence fail identity generation mismatch',
        {
          checkoutId,
          attemptId,
          expected: expectedFence.generation,
          found: row.generation
        }
      );
    }
    if (
      expectedFence.quoteSnapshotHash != null &&
      String(row.quoteSnapshotHash) !== String(expectedFence.quoteSnapshotHash)
    ) {
      throw new CheckoutResourceAttemptFenceError(
        FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST,
        'Fence fail identity quoteSnapshotHash mismatch',
        {
          checkoutId,
          attemptId,
          expected: expectedFence.quoteSnapshotHash,
          found: row.quoteSnapshotHash
        }
      );
    }
  }
  return { ...result, fence: row };
}

/**
 * Markerless release entry classification for a checkout/attempt.
 * Absence of current-attempt markers is never durable proof of never-acquired.
 * Empty / non-attributable lookups fail closed as VOUCHER_COMPENSATION_STATE_UNPROVEN.
 */
async function classifyMarkerlessReleaseState({ checkoutId, attemptId }) {
  await __invokeBeforeMarkerlessClassifyHookForTests({
    phase: 'before_markerless_classify',
    checkoutId: String(checkoutId),
    attemptId: String(attemptId)
  });

  const chk = String(checkoutId);
  const att = String(attemptId);
  const attemptKeyNeedle = `:att:${att}:`;

  const byCheckout = await GiftVoucherRedemption.find({
    ledgerProtocolVersion: LEDGER_PROTOCOL_VERSION_V1,
    checkoutId: chk
  }).lean();

  const keyed = byCheckout.filter((r) =>
    String(r.reservationKey || '').includes(attemptKeyNeedle)
  );
  const liveHeld = byCheckout.filter((r) =>
    ['pending_debit', 'reserved'].includes(r.status)
  );

  if (liveHeld.length > 1) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'markerless_ambiguous_multiple_live_redemptions',
      checkoutId: chk,
      count: liveHeld.length
    });
  }

  const candidates = [];
  if (keyed.length > 0) {
    if (keyed.length > 1) {
      const liveKeyed = keyed.filter((r) =>
        ['pending_debit', 'reserved'].includes(r.status)
      );
      if (liveKeyed.length > 1) {
        throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
          reason: 'markerless_ambiguous_multiple_attempt_keyed_live',
          checkoutId: chk,
          attemptId: att,
          count: liveKeyed.length
        });
      }
      // Prefer live keyed, else newest terminal keyed
      candidates.push(...(liveKeyed.length ? liveKeyed : keyed));
    } else {
      candidates.push(keyed[0]);
    }
  } else if (liveHeld.length === 1) {
    // Sealed reuse / unmarked live on same checkout (other attempt key / takeover key)
    candidates.push(liveHeld[0]);
  } else {
    // No current-attempt key and no live hold: a checkout-scoped terminal is attributable
    // only with durable evidence linking compensation to this attempt.
    const terminals = byCheckout.filter((r) =>
      ['released', 'voided'].includes(r.status)
    );
    if (terminals.length > 1) {
      throw buildStructuredError(VOUCHER_COMPENSATION_STATE_UNPROVEN, {
        reason: 'markerless_ambiguous_terminal_checkout_rows',
        checkoutId: chk,
        attemptId: att,
        count: terminals.length
      });
    }
    if (terminals.length === 1) {
      const terminal = terminals[0];
      const dispositionHint =
        terminal.status === 'voided' ? 'voided' : 'restored';
      const attributed = await terminalCompensationAttributedToAttempt({
        redemption: terminal,
        attemptId: att,
        checkoutId: chk,
        disposition: dispositionHint
      });
      if (!attributed) {
        throw buildStructuredError(VOUCHER_COMPENSATION_STATE_UNPROVEN, {
          reason: 'markerless_terminal_not_attributed_to_attempt',
          checkoutId: chk,
          attemptId: att,
          redemptionId: String(terminal._id),
          reservationKey: terminal.reservationKey || null
        });
      }
      candidates.push(terminal);
    }
  }

  if (candidates.length === 0) {
    throw buildStructuredError(VOUCHER_COMPENSATION_STATE_UNPROVEN, {
      reason: 'markerless_no_attributable_durable_state',
      checkoutId: chk,
      attemptId: att
    });
  }

  // Deduplicate and require a single decisive candidate
  const unique = [];
  const seen = new Set();
  for (const c of candidates) {
    const id = String(c._id);
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(c);
    }
  }
  if (unique.length > 1) {
    const liveUnique = unique.filter((r) =>
      ['pending_debit', 'reserved'].includes(r.status)
    );
    if (liveUnique.length !== 1) {
      throw buildStructuredError(VOUCHER_COMPENSATION_STATE_UNPROVEN, {
        reason: 'markerless_ambiguous_candidate_set',
        checkoutId: chk,
        count: unique.length
      });
    }
    unique.splice(0, unique.length, liveUnique[0]);
  }

  const redemption = unique[0];
  const voucher = await GiftVoucher.findById(redemption.giftVoucherId).lean();
  if (!voucher) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'markerless_missing_voucher',
      redemptionId: String(redemption._id)
    });
  }
  const op = findEmbeddedOperation(voucher, {
    operationId: redemption.operationId,
    redemptionId: redemption._id
  });

  if (isExactCompletedSealState(redemption, op)) {
    assertExactSealedLinkage({ redemption, operation: op, checkoutId: chk });
    if (String(voucher._id) !== String(redemption.giftVoucherId)) {
      throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
        reason: 'seal_classification_voucher_identity_mismatch'
      });
    }
    throw buildStructuredError(VOUCHER_COMPENSATION_SEAL_COMPLETED, {
      reason: 'seal_completed_no_compensation',
      redemptionId: String(redemption._id),
      operationId: redemption.operationId,
      reservationKey: redemption.reservationKey,
      amountAppliedCents: redemption.amountAppliedCents,
      currency: redemption.currency,
      giftVoucherId: String(redemption.giftVoucherId)
    });
  }

  if (redemption.status === 'confirmed') {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'markerless_confirmed_not_compensable_as_clear',
      redemptionId: String(redemption._id)
    });
  }

  if (redemption.status === 'voided') {
    if (op && op.state !== 'voided') {
      throw buildStructuredError(VOUCHER_COMPENSATION_INCOMPLETE, {
        reason: 'markerless_voided_redemption_non_voided_operation',
        redemptionId: String(redemption._id),
        operationState: op.state
      });
    }
    return {
      kind: 'already_clear',
      monetaryDisposition: 'voided',
      balanceRestored: false,
      redemptionId: String(redemption._id),
      operationId: redemption.operationId || null
    };
  }

  if (redemption.status === 'released') {
    if (!op) {
      throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
        reason: 'markerless_released_missing_operation',
        redemptionId: String(redemption._id)
      });
    }
    if (op.state === 'restored') {
      if (
        String(op.reservationKey || '') !== String(redemption.reservationKey || '') ||
        Number(op.amountCents) !== Number(redemption.amountAppliedCents) ||
        String(op.currency || '') !== String(redemption.currency || '')
      ) {
        throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
          reason: 'markerless_restored_identity_mismatch',
          redemptionId: String(redemption._id)
        });
      }
      return {
        kind: 'already_clear',
        monetaryDisposition: 'restored',
        balanceRestored: true,
        redemptionId: String(redemption._id),
        operationId: redemption.operationId
      };
    }
    if (op.state === 'voided') {
      return {
        kind: 'already_clear',
        monetaryDisposition: 'voided',
        balanceRestored: false,
        redemptionId: String(redemption._id),
        operationId: redemption.operationId
      };
    }
    throw buildStructuredError(VOUCHER_COMPENSATION_INCOMPLETE, {
      reason: 'markerless_released_operation_not_terminal',
      redemptionId: String(redemption._id),
      operationState: op.state
    });
  }

  if (['pending_debit', 'reserved'].includes(redemption.status)) {
    throw buildStructuredError(VOUCHER_COMPENSATION_INCOMPLETE, {
      reason: 'markerless_live_non_seal_state',
      redemptionId: String(redemption._id),
      status: redemption.status,
      redemptionMarker: markerString(redemption.acquisitionAttemptId),
      operationState: op?.state || null,
      operationMarker: markerString(op?.acquisitionAttemptId)
    });
  }

  throw buildStructuredError(VOUCHER_COMPENSATION_STATE_UNPROVEN, {
    reason: 'markerless_unrecognized_state',
    redemptionId: String(redemption._id),
    status: redemption.status
  });
}

async function releaseAttemptVoucherReservation(input = {}, deps = {}) {
  const checkoutId = String(input.checkoutId || '').trim();
  const attemptId = String(input.acquisitionAttemptId || '').trim();
  const quoteSnapshotHash = String(input.quoteSnapshotHash || '').trim();
  const actor = input.actor || 'system';
  const note = input.note || 'attempt voucher release';
  const failFence = input.failFence !== false;

  let fence;
  try {
    fence = await assertExactFence(
      { checkoutId, acquisitionAttemptId: attemptId, quoteSnapshotHash },
      deps
    );
  } catch (err) {
    if (err?.code === FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST) {
      throw err;
    }
    throw err;
  }

  const now = toNow(deps);
  const markers = await listCurrentAttemptVoucherMarkers({ checkoutId, acquisitionAttemptId: attemptId });
  let owned = markers.filter(
    (m) => m.redemptionMarker === attemptId || m.operationMarker === attemptId
  );

  if (owned.length === 0) {
    // Classify exact checkout-scoped state; never assume marker absence means compensated.
    let classified;
    try {
      classified = await classifyMarkerlessReleaseState({ checkoutId, attemptId });
    } catch (err) {
      // Fail-closed markerless errors must not mutate the fence.
      if (
        err?.code === VOUCHER_COMPENSATION_SEAL_COMPLETED ||
        err?.code === VOUCHER_COMPENSATION_STATE_UNPROVEN ||
        err?.code === VOUCHER_COMPENSATION_INCOMPLETE ||
        err?.code === VOUCHER_LEDGER_INTEGRITY
      ) {
        throw err;
      }
      throw err;
    }

    // Concurrent same-attempt acquire may have created markers during classify.
    const markersAfter = await listCurrentAttemptVoucherMarkers({
      checkoutId,
      acquisitionAttemptId: attemptId
    });
    owned = markersAfter.filter(
      (m) => m.redemptionMarker === attemptId || m.operationMarker === attemptId
    );

    if (owned.length === 0) {
      if (classified.kind === 'already_clear') {
        if (failFence) {
          await failExactFenceBeforeSuccess({
            checkoutId,
            attemptId,
            failureCode: input.failureCode || 'VOUCHER_RELEASED',
            expectedFence: fence,
            deps
          });
        }
        return {
          ok: true,
          released: false,
          alreadyClear: true,
          monetaryDisposition: classified.monetaryDisposition,
          balanceRestored: classified.balanceRestored === true,
          redemptionId: classified.redemptionId,
          operationId: classified.operationId,
          fence
        };
      }
      throw buildStructuredError(VOUCHER_COMPENSATION_STATE_UNPROVEN, {
        reason: 'markerless_classification_unproven'
      });
    }
    // Fall through: compensate the durable marked reservation that appeared.
  }

  // Expect at most one voucher reservation per attempt/checkout
  const target = owned[0];
  let redemption = await GiftVoucherRedemption.findById(target.redemptionId).lean();
  if (!redemption) {
    throw buildStructuredError('REDEMPTION_NOT_FOUND', { redemptionId: target.redemptionId });
  }

  const voucher = await GiftVoucher.findById(redemption.giftVoucherId).lean();
  let op = findEmbeddedOperation(voucher, {
    operationId: redemption.operationId,
    redemptionId: redemption._id
  });

  try {
    let monetaryDisposition = 'unknown';
    let balanceRestored = false;

    const redMarked = markerString(redemption.acquisitionAttemptId) === attemptId;
    const opMarked = Boolean(op && markerString(op.acquisitionAttemptId) === attemptId);

    // Exact one-marker terminal mid-clear recovery (event already durable).
    if (
      op &&
      redMarked !== opMarked &&
      (op.state === 'restored' || op.state === 'voided') &&
      (redemption.status === 'released' || redemption.status === 'voided')
    ) {
      const recovered = await recoverExactPartialMarkerClear({
        giftVoucherId: redemption.giftVoucherId,
        redemption,
        op,
        checkoutId,
        attemptId,
        fence
      });
      monetaryDisposition = recovered.monetaryDisposition;
      balanceRestored = recovered.balanceRestored;
    } else if (op && opMarked) {
      if (op.state === 'debited') {
        await __invokeBeforeCompensationReleaseCasHookForTests({
          phase: 'before_redemption_release_cas',
          redemptionId: String(redemption._id),
          operationId: redemption.operationId,
          attemptId
        });

        // Keep marker A on release so interrupted compensation can resume.
        const releaseCas = await GiftVoucherRedemption.findOneAndUpdate(
          {
            _id: redemption._id,
            acquisitionAttemptId: attemptId,
            status: 'reserved'
          },
          {
            $set: {
              status: 'released',
              releasedAt: now,
              reason: String(input.reason || 'attempt_release')
              // marker intentionally retained until restore completes
            }
          },
          { new: true }
        );

        let mayRestore = false;
        if (releaseCas) {
          mayRestore = true;
        } else {
          const latest = await GiftVoucherRedemption.findById(redemption._id).lean();
          if (
            latest &&
            latest.status === 'released' &&
            markerString(latest.acquisitionAttemptId) === attemptId
          ) {
            // Case B: earlier interrupted compensation
            mayRestore = true;
            redemption = latest;
          } else if (
            latest &&
            latest.status === 'reserved' &&
            !hasAcquisitionMarker(latest.acquisitionAttemptId)
          ) {
            // Completed seal already won — never restore or mutate fence.
            const vSeal = await GiftVoucher.findById(redemption.giftVoucherId).lean();
            const opSeal = findEmbeddedOperation(vSeal, {
              operationId: redemption.operationId,
              redemptionId: redemption._id
            });
            if (isExactCompletedSealState(latest, opSeal)) {
              assertExactSealedLinkage({
                redemption: latest,
                operation: opSeal,
                checkoutId
              });
              throw buildStructuredError(VOUCHER_COMPENSATION_SEAL_COMPLETED, {
                reason: 'seal_completed_no_compensation',
                redemptionId: String(redemption._id),
                operationId: redemption.operationId
              });
            }
            throw buildStructuredError(VOUCHER_COMPENSATION_INCOMPLETE, {
              reason: 'seal_partial_or_inconsistent_no_restore',
              redemptionId: String(redemption._id)
            });
          } else if (
            latest &&
            latest.status === 'released' &&
            !hasAcquisitionMarker(latest.acquisitionAttemptId)
          ) {
            // Already fully compensated or seal/comp finish — check op
            const v2 = await GiftVoucher.findById(redemption.giftVoucherId).lean();
            const op2 = findEmbeddedOperation(v2, {
              operationId: redemption.operationId,
              redemptionId: redemption._id
            });
            if (op2?.state === 'restored' || op2?.state === 'voided') {
              mayRestore = false;
              monetaryDisposition = op2.state === 'restored' ? 'restored' : 'voided';
              balanceRestored = op2.state === 'restored';
            } else if (
              op2?.state === 'debited' &&
              markerString(op2.acquisitionAttemptId) === attemptId
            ) {
              // Released unmarked but op still marked — inconsistent; fail closed
              throw buildStructuredError(VOUCHER_COMPENSATION_INCOMPLETE, {
                reason: 'released_unmarked_with_marked_debited_op',
                redemptionId: String(redemption._id)
              });
            } else {
              throw buildStructuredError(VOUCHER_COMPENSATION_INCOMPLETE, {
                reason: 'incompatible_redemption_state_for_restore',
                status: latest?.status,
                redemptionMarker: markerString(latest?.acquisitionAttemptId)
              });
            }
          } else {
            throw buildStructuredError(VOUCHER_COMPENSATION_INCOMPLETE, {
              reason: 'redemption_release_cas_failed',
              status: latest?.status,
              redemptionMarker: markerString(latest?.acquisitionAttemptId)
            });
          }
        }

        if (mayRestore) {
          await __invokeCompensationPartialHookForTests({
            phase: 'redemption_released_before_restore',
            redemptionId: String(redemption._id),
            operationId: redemption.operationId,
            attemptId
          });
          // Retain operation marker until the compensating event is durable.
          const restore = await atomicRestoreV1({
            giftVoucherId: redemption.giftVoucherId,
            redemptionId: redemption._id,
            operationId: redemption.operationId,
            reservationKey: redemption.reservationKey,
            amountCents: redemption.amountAppliedCents,
            currency: redemption.currency,
            now,
            acquisitionAttemptId: attemptId,
            clearMarker: false
          });
          await __invokeAfterAttemptRestoreBeforeEventHookForTests({
            phase: 'after_restore_before_event',
            redemptionId: String(redemption._id),
            operationId: redemption.operationId,
            attemptId,
            alreadyRestored: restore.alreadyRestored === true
          });
          await writeAndProveCompensatingEvent({
            giftVoucherId: redemption.giftVoucherId,
            eventType: 'redeemed_released',
            checkoutId,
            attemptId,
            redemption,
            actor,
            note,
            previousBalanceCents: restore.previousBalanceCents,
            newBalanceCents: restore.newBalanceCents,
            deltaCents: restore.amountCents
          });
          await __invokeAfterAttemptEventBeforeMarkerClearHookForTests({
            phase: 'after_event_before_marker_clear',
            redemptionId: String(redemption._id),
            operationId: redemption.operationId,
            attemptId,
            disposition: 'restored'
          });
          await clearCompensationMarkersAfterEvent({
            giftVoucherId: redemption.giftVoucherId,
            redemption,
            attemptId,
            operationState: 'restored'
          });
          monetaryDisposition = 'restored';
          balanceRestored = true;
        }
      } else if (op.state === 'pending') {
        await voidPendingLedgerOperationV1({
          giftVoucherId: redemption.giftVoucherId,
          redemptionId: redemption._id,
          operationId: redemption.operationId,
          acquisitionAttemptId: attemptId,
          clearMarker: false,
          now
        });
        // Terminal void while retaining redemption marker until event durability.
        const voidCas = await GiftVoucherRedemption.findOneAndUpdate(
          {
            _id: redemption._id,
            acquisitionAttemptId: attemptId,
            status: { $in: ['pending_debit', 'reserved'] }
          },
          {
            $set: {
              status: 'voided',
              releasedAt: now,
              reason: String(input.reason || 'attempt_pending_void')
            }
          },
          { new: true }
        );
        if (!voidCas) {
          const latest = await GiftVoucherRedemption.findById(redemption._id).lean();
          if (
            !(
              latest &&
              latest.status === 'voided' &&
              markerString(latest.acquisitionAttemptId) === attemptId
            )
          ) {
            throw buildStructuredError(VOUCHER_COMPENSATION_INCOMPLETE, {
              reason: 'pending_void_redemption_cas_failed',
              status: latest?.status
            });
          }
          redemption = latest;
        } else {
          redemption = voidCas.toObject ? voidCas.toObject() : voidCas;
        }
        await __invokeAfterAttemptRestoreBeforeEventHookForTests({
          phase: 'after_void_before_event',
          redemptionId: String(redemption._id),
          operationId: redemption.operationId,
          attemptId
        });
        const bal = Number(
          (await GiftVoucher.findById(redemption.giftVoucherId).lean()).balanceRemainingCents
        );
        await writeAndProveCompensatingEvent({
          giftVoucherId: redemption.giftVoucherId,
          eventType: 'voided',
          checkoutId,
          attemptId,
          redemption,
          actor,
          note,
          previousBalanceCents: bal,
          newBalanceCents: bal,
          deltaCents: 0
        });
        await __invokeAfterAttemptEventBeforeMarkerClearHookForTests({
          phase: 'after_event_before_marker_clear',
          redemptionId: String(redemption._id),
          operationId: redemption.operationId,
          attemptId,
          disposition: 'voided'
        });
        await clearCompensationMarkersAfterEvent({
          giftVoucherId: redemption.giftVoucherId,
          redemption,
          attemptId,
          operationState: 'voided'
        });
        monetaryDisposition = 'voided';
        balanceRestored = false;
      } else if (op.state === 'restored' || op.state === 'voided') {
        // Crash recovery: terminal op already transitioned; keep/ensure redemption
        // terminal while markers remain until the compensating event is durable.
        const terminalStatus = op.state === 'voided' ? 'voided' : 'released';
        const termCas = await GiftVoucherRedemption.findOneAndUpdate(
          {
            _id: redemption._id,
            acquisitionAttemptId: attemptId,
            status: { $in: ['pending_debit', 'reserved', 'released', 'voided'] }
          },
          {
            $set: {
              status: terminalStatus,
              releasedAt: now,
              reason: String(input.reason || 'attempt_release_terminal_op')
            }
          },
          { new: true }
        );
        if (termCas) {
          redemption = termCas.toObject ? termCas.toObject() : termCas;
        } else {
          const latest = await GiftVoucherRedemption.findById(redemption._id).lean();
          if (
            !(
              latest &&
              latest.status === terminalStatus &&
              markerString(latest.acquisitionAttemptId) === attemptId
            )
          ) {
            if (latest && !hasAcquisitionMarker(latest.acquisitionAttemptId)) {
              // Markers already cleared — require exact event before success.
              const attributed = await terminalCompensationAttributedToAttempt({
                redemption: latest,
                attemptId,
                checkoutId,
                disposition: op.state === 'voided' ? 'voided' : 'restored'
              });
              if (!attributed) {
                throw buildStructuredError(VOUCHER_COMPENSATION_INCOMPLETE, {
                  reason: 'terminal_markers_cleared_without_attribution_event',
                  redemptionId: String(redemption._id)
                });
              }
              monetaryDisposition = op.state === 'restored' ? 'restored' : 'voided';
              balanceRestored = op.state === 'restored';
            } else {
              throw buildStructuredError(VOUCHER_COMPENSATION_INCOMPLETE, {
                reason: 'terminal_op_redemption_cas_failed',
                status: latest?.status
              });
            }
          } else {
            redemption = latest;
          }
        }

        if (markerString(redemption.acquisitionAttemptId) === attemptId) {
          const eventType = op.state === 'voided' ? 'voided' : 'redeemed_released';
          let previousBalanceCents;
          let newBalanceCents;
          let deltaCents;
          if (eventType === 'voided') {
            const bal = Number(
              (await GiftVoucher.findById(redemption.giftVoucherId).lean()).balanceRemainingCents
            );
            previousBalanceCents = bal;
            newBalanceCents = bal;
            deltaCents = 0;
          } else {
            const bal = Number(
              (await GiftVoucher.findById(redemption.giftVoucherId).lean()).balanceRemainingCents
            );
            previousBalanceCents = bal - Number(redemption.amountAppliedCents);
            newBalanceCents = bal;
            deltaCents = Number(redemption.amountAppliedCents);
          }
          await writeAndProveCompensatingEvent({
            giftVoucherId: redemption.giftVoucherId,
            eventType,
            checkoutId,
            attemptId,
            redemption,
            actor,
            note,
            previousBalanceCents,
            newBalanceCents,
            deltaCents
          });
          await __invokeAfterAttemptEventBeforeMarkerClearHookForTests({
            phase: 'after_event_before_marker_clear',
            redemptionId: String(redemption._id),
            operationId: redemption.operationId,
            attemptId,
            disposition: op.state === 'voided' ? 'voided' : 'restored'
          });
          await clearCompensationMarkersAfterEvent({
            giftVoucherId: redemption.giftVoucherId,
            redemption,
            attemptId,
            operationState: op.state
          });
          monetaryDisposition = op.state === 'restored' ? 'restored' : 'voided';
          balanceRestored = op.state === 'restored';
        }
      }
    } else if (markerString(redemption.acquisitionAttemptId) === attemptId) {
      // redemption marked but op not (or missing) — clear redemption terminal
      if (!op) {
        const voidCas = await GiftVoucherRedemption.findOneAndUpdate(
          {
            _id: redemption._id,
            acquisitionAttemptId: attemptId,
            status: 'pending_debit'
          },
          {
            $set: {
              status: 'voided',
              releasedAt: now,
              reason: 'attempt_void_no_op',
              acquisitionAttemptId: null
            }
          },
          { new: true }
        );
        if (!voidCas) {
          throw buildStructuredError(VOUCHER_COMPENSATION_INCOMPLETE, {
            reason: 'void_no_op_cas_failed'
          });
        }
        monetaryDisposition = 'voided';
        balanceRestored = false;
      } else {
        // Non-terminal one-marker / inconsistent — fail closed; do not clear.
        throw buildStructuredError(VOUCHER_COMPENSATION_STATE_UNPROVEN, {
          reason: 'redemption_marked_operation_not_partial_clear_recoverable',
          redemptionId: String(redemption._id),
          operationMarker: markerString(op.acquisitionAttemptId),
          operationState: op.state,
          redemptionStatus: redemption.status
        });
      }
    } else if (
      redemption.status === 'reserved' &&
      !hasAcquisitionMarker(redemption.acquisitionAttemptId)
    ) {
      // Potential seal-won path: classify exact completed seal separately.
      if (isExactCompletedSealState(redemption, op)) {
        assertExactSealedLinkage({ redemption, operation: op, checkoutId });
        throw buildStructuredError(VOUCHER_COMPENSATION_SEAL_COMPLETED, {
          reason: 'seal_completed_no_compensation',
          redemptionId: String(redemption._id),
          operationId: redemption.operationId
        });
      }
      throw buildStructuredError(VOUCHER_COMPENSATION_INCOMPLETE, {
        reason: 'seal_partial_or_inconsistent_no_restore',
        redemptionId: String(redemption._id)
      });
    }

    await assertNoCurrentAttemptVoucherMarkers({ checkoutId, acquisitionAttemptId: attemptId });

    if (failFence) {
      await failExactFenceBeforeSuccess({
        checkoutId,
        attemptId,
        failureCode: input.failureCode || 'VOUCHER_COMPENSATED',
        expectedFence: fence,
        deps
      });
    }

    return {
      ok: true,
      released: true,
      alreadyClear: false,
      monetaryDisposition,
      balanceRestored,
      redemptionId: String(redemption._id),
      operationId: redemption.operationId,
      fence
    };
  } catch (err) {
    if (err?.code === FENCE_ERROR_CODES.RESOURCE_BUNDLE_FENCE_LOST) {
      throw err;
    }
    if (err?.code === VOUCHER_COMPENSATION_SEAL_COMPLETED) {
      throw err;
    }
    if (err?.code === VOUCHER_COMPENSATION_STATE_UNPROVEN) {
      throw err;
    }
    const remaining = await listCurrentAttemptVoucherMarkers({
      checkoutId,
      acquisitionAttemptId: attemptId
    });
    const hasCurrentAttemptMarkers = remaining.some(
      (m) => m.redemptionMarker === attemptId || m.operationMarker === attemptId
    );
    if (err?.code === VOUCHER_COMPENSATION_INCOMPLETE && hasCurrentAttemptMarkers) {
      try {
        await annotateCheckoutResourceAttemptFenceFailure(
          {
            checkoutId,
            attemptId,
            failureCode: VOUCHER_COMPENSATION_INCOMPLETE
          },
          deps
        );
      } catch (_) {
        /* annotate best-effort */
      }
    }
    if (err?.code === VOUCHER_COMPENSATION_INCOMPLETE) {
      err.remaining = remaining;
      throw err;
    }
    throw buildStructuredError(VOUCHER_COMPENSATION_INCOMPLETE, {
      cause: err.code || err.message,
      remaining,
      redemptionId: String(redemption._id),
      operationId: redemption.operationId
    });
  }
}

async function sealAttemptVoucherReservation(input = {}, deps = {}) {
  const checkoutId = String(input.checkoutId || '').trim();
  const attemptId = String(input.acquisitionAttemptId || '').trim();
  const quoteSnapshotHash = String(input.quoteSnapshotHash || '').trim();
  const redemptionId = input.redemptionId;

  let fence = await assertExactFence(
    { checkoutId, acquisitionAttemptId: attemptId, quoteSnapshotHash },
    deps
  );

  const redemption = await GiftVoucherRedemption.findById(redemptionId).lean();
  if (!redemption || redemption.status !== 'reserved') {
    throw buildStructuredError('VOUCHER_RESERVATION_INACTIVE', {
      redemptionId: String(redemptionId),
      status: redemption?.status
    });
  }
  const voucher = await GiftVoucher.findById(redemption.giftVoucherId).lean();
  let op = findEmbeddedOperation(voucher, {
    operationId: redemption.operationId,
    redemptionId: redemption._id
  });
  if (!op || op.state !== 'debited') {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'seal_requires_debited',
      state: op?.state
    });
  }

  const redMarker = markerString(redemption.acquisitionAttemptId);
  const opMarker = markerString(op.acquisitionAttemptId);
  const alreadySealed = !redMarker && !opMarker;
  if (alreadySealed) {
    fence = await assertExactFence(
      { checkoutId, acquisitionAttemptId: attemptId, quoteSnapshotHash },
      deps
    );
    return {
      ok: true,
      sealed: true,
      alreadySealed: true,
      redemptionId: String(redemption._id),
      operationId: redemption.operationId,
      reservationKey: redemption.reservationKey,
      amountAppliedCents: redemption.amountAppliedCents,
      expiresAt: redemption.expiresAt,
      acquisitionAttemptId: null,
      compensable: false,
      fence
    };
  }

  // Full dual ownership, or repair after redemption marker already cleared.
  if (redMarker && redMarker !== attemptId) {
    throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
      reason: 'seal_redemption_marker_mismatch',
      expected: attemptId,
      found: redMarker
    });
  }
  if (opMarker && opMarker !== attemptId) {
    throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
      reason: 'seal_operation_marker_mismatch',
      expected: attemptId,
      found: opMarker
    });
  }
  if (!opMarker) {
    throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
      reason: 'seal_operation_marker_missing',
      expected: attemptId
    });
  }

  const now = toNow(deps);
  if (!(redemption.expiresAt instanceof Date) || redemption.expiresAt.getTime() <= now.getTime()) {
    throw buildStructuredError('VOUCHER_RESERVATION_EXPIRED', {
      redemptionId: String(redemption._id)
    });
  }
  if (redemption.expiresAt.getTime() < new Date(fence.bundleValidUntil).getTime()) {
    throw buildStructuredError('INVALID_REDEMPTION_EXPIRY', {
      reason: 'seal_expiry_below_bundle'
    });
  }

  if (redMarker === attemptId) {
    const clearRed = await clearRedemptionMarkerV1({
      redemptionId: redemption._id,
      attemptId
    });
    if (!clearRed.ok && !clearRed.alreadyClear) {
      await annotateCheckoutResourceAttemptFenceFailure(
        { checkoutId, attemptId, failureCode: VOUCHER_MARKER_CLEAR_INCOMPLETE },
        deps
      );
      throw buildStructuredError(VOUCHER_MARKER_CLEAR_INCOMPLETE, {
        phase: 'redemption',
        redemptionId: String(redemption._id)
      });
    }
  }

  // Re-read after redemption clear (or for partial-seal repair).
  let midRedemption = await GiftVoucherRedemption.findById(redemption._id).lean();
  let midVoucher = await GiftVoucher.findById(redemption.giftVoucherId).lean();
  let midOp = findEmbeddedOperation(midVoucher, {
    operationId: redemption.operationId,
    redemptionId: redemption._id
  });

  if (midRedemption.status === 'released') {
    // Compensation won — do not clear operation marker or return success.
    throw buildStructuredError(VOUCHER_MARKER_CLEAR_INCOMPLETE, {
      reason: 'compensation_won_redemption_released',
      redemptionId: String(redemption._id)
    });
  }

  const midRedUnmarked = !hasAcquisitionMarker(midRedemption.acquisitionAttemptId);
  const midOpMarked = markerString(midOp?.acquisitionAttemptId) === attemptId;
  const mayClearOp =
    midRedemption.status === 'reserved' &&
    midRedUnmarked &&
    midOp &&
    midOp.state === 'debited' &&
    midOpMarked;

  if (!mayClearOp) {
    if (
      midRedemption.status === 'reserved' &&
      midRedUnmarked &&
      midOp &&
      midOp.state === 'debited' &&
      !hasAcquisitionMarker(midOp.acquisitionAttemptId)
    ) {
      // already fully sealed
    } else {
      await annotateCheckoutResourceAttemptFenceFailure(
        { checkoutId, attemptId, failureCode: VOUCHER_MARKER_CLEAR_INCOMPLETE },
        deps
      );
      throw buildStructuredError(VOUCHER_MARKER_CLEAR_INCOMPLETE, {
        phase: 'pre_operation_clear',
        status: midRedemption.status,
        redemptionMarker: markerString(midRedemption.acquisitionAttemptId),
        operationMarker: markerString(midOp?.acquisitionAttemptId),
        operationState: midOp?.state
      });
    }
  } else {
    const clearOp = await clearOperationMarkerV1({
      giftVoucherId: redemption.giftVoucherId,
      redemptionId: redemption._id,
      operationId: redemption.operationId,
      attemptId
    });
    if (!clearOp.ok && !clearOp.alreadyClear) {
      await annotateCheckoutResourceAttemptFenceFailure(
        { checkoutId, attemptId, failureCode: VOUCHER_MARKER_CLEAR_INCOMPLETE },
        deps
      );
      throw buildStructuredError(VOUCHER_MARKER_CLEAR_INCOMPLETE, {
        phase: 'operation',
        redemptionId: String(redemption._id),
        operationId: redemption.operationId
      });
    }
  }

  const sealedRedemption = await GiftVoucherRedemption.findById(redemption._id).lean();
  const sealedVoucher = await GiftVoucher.findById(redemption.giftVoucherId).lean();
  op = findEmbeddedOperation(sealedVoucher, {
    operationId: redemption.operationId,
    redemptionId: redemption._id
  });

  if (sealedRedemption.status !== 'reserved' || op?.state !== 'debited') {
    throw buildStructuredError(VOUCHER_MARKER_CLEAR_INCOMPLETE, {
      reason: 'seal_success_requires_reserved_debited',
      status: sealedRedemption.status,
      operationState: op?.state
    });
  }
  if (
    hasAcquisitionMarker(sealedRedemption.acquisitionAttemptId) ||
    hasAcquisitionMarker(op?.acquisitionAttemptId)
  ) {
    await annotateCheckoutResourceAttemptFenceFailure(
      { checkoutId, attemptId, failureCode: VOUCHER_MARKER_CLEAR_INCOMPLETE },
      deps
    );
    throw buildStructuredError(VOUCHER_MARKER_CLEAR_INCOMPLETE, {
      phase: 'verify',
      redemptionMarker: markerString(sealedRedemption.acquisitionAttemptId),
      operationMarker: markerString(op?.acquisitionAttemptId)
    });
  }

  fence = await assertExactFence(
    { checkoutId, acquisitionAttemptId: attemptId, quoteSnapshotHash },
    deps
  );

  return {
    ok: true,
    sealed: true,
    redemptionId: String(sealedRedemption._id),
    operationId: sealedRedemption.operationId,
    reservationKey: sealedRedemption.reservationKey,
    amountAppliedCents: sealedRedemption.amountAppliedCents,
    expiresAt: sealedRedemption.expiresAt,
    acquisitionAttemptId: null,
    compensable: false,
    fence
  };
}

module.exports = {
  reserveExactVoucherAmountForAttempt,
  assertAttemptVoucherReservationActive,
  releaseAttemptVoucherReservation,
  sealAttemptVoucherReservation,
  listCurrentAttemptVoucherMarkers,
  assertNoCurrentAttemptVoucherMarkers,
  buildAttemptReservationKey,
  ensureVoucherLedgerIndexesForTests,
  VOUCHER_COMPENSATION_INCOMPLETE,
  VOUCHER_COMPENSATION_SEAL_COMPLETED,
  VOUCHER_COMPENSATION_STATE_UNPROVEN,
  VOUCHER_MARKER_CLEAR_INCOMPLETE,
  VOUCHER_IDENTITY_MISMATCH,
  VOUCHER_ATTEMPT_IN_PROGRESS,
  VOUCHER_ATTEMPT_REFERENCE_INVALID,
  VOUCHER_RESERVATION_IN_PROGRESS,
  VOUCHER_ATTEMPT_MARKER_MISMATCH,
  __setBeforeMarkerlessClassifyHookForTests,
  __setAfterAttemptPendingMarkedHookForTests,
  __setAfterAttemptPreDebitFenceHookForTests,
  __setAfterAttemptDebitHookForTests,
  __setAfterAttemptReservedCasHookForTests,
  __setAfterAttemptRestoreBeforeEventHookForTests,
  __setAfterAttemptEventBeforeMarkerClearHookForTests,
  __setAfterAttemptFirstMarkerClearHookForTests
};
