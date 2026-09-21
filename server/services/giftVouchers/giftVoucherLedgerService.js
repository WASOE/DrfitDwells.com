'use strict';

const ATTEMPT_MARKER_FIELD = 'acquisition' + 'AttemptId';

const mongoose = require('mongoose');
const GiftVoucher = require('../../models/GiftVoucher');
const GiftVoucherRedemption = require('../../models/GiftVoucherRedemption');
const {
  LEDGER_PROTOCOL_VERSION_V1,
  AUTHORITATIVE_V1_RESERVATION_KEY_INDEX_SPEC,
  AUTHORITATIVE_V1_LIVE_CHECKOUT_INDEX_SPEC,
  AUTHORITATIVE_ACQUISITION_ATTEMPT_INDEX_SPEC
} = require('../../models/GiftVoucherRedemption');
const GiftVoucherEvent = require('../../models/GiftVoucherEvent');
const {
  AUTHORITATIVE_LEDGER_EVENT_KEY_INDEX_SPEC
} = require('../../models/GiftVoucherEvent');
const { assertIntegerCents } = require('./giftVoucherValidationService');
const giftVoucherEventService = require('./giftVoucherEventService');

const LEDGER_EVENT_INCOMPLETE = 'LEDGER_EVENT_INCOMPLETE';
const VOUCHER_LEDGER_INTEGRITY = 'VOUCHER_LEDGER_INTEGRITY';
const VOUCHER_LEDGER_PROTOCOL_MISMATCH = 'VOUCHER_LEDGER_PROTOCOL_MISMATCH';
const VOUCHER_LEDGER_INDEX_MISSING = 'VOUCHER_LEDGER_INDEX_MISSING';
const VOUCHER_RESERVATION_IN_PROGRESS = 'VOUCHER_RESERVATION_IN_PROGRESS';
const VOUCHER_ATTEMPT_MARKER_MISMATCH = 'VOUCHER_ATTEMPT_MARKER_MISMATCH';

/** Test-only seam: invoked after durable pending_debit create, before debit. */
let afterV1PendingCreateHook = null;
/** Test-only seam: after pending op claim, before attempt debit. */
let afterV1PendingOpClaimHook = null;
/** Test-only seam: before pending op claim attempt. */
let beforeV1PendingOpClaimHook = null;
/** Test-only seam: after op marker transfer, before redemption marker transfer. */
let afterV1OpMarkerTransferHook = null;
/** Test-only seam: after first seal marker clear. */
let afterV1SealPartialClearHook = null;
/** Test-only seam: mid compensation. */
let afterV1CompensationPartialHook = null;
/** Test-only seam: before compensation redemption release CAS. */
let beforeV1CompensationReleaseCasHook = null;
/** Test-only seam: before seal redemption marker clear. */
let beforeV1SealRedemptionClearHook = null;
/** Test-only seam: after confirm precheck, before confirm CAS. */
let beforeV1ConfirmCasHook = null;

function __setAfterV1PendingOpClaimHookForTests(fn) {
  afterV1PendingOpClaimHook = typeof fn === 'function' ? fn : null;
}
function __setBeforeV1PendingOpClaimHookForTests(fn) {
  beforeV1PendingOpClaimHook = typeof fn === 'function' ? fn : null;
}
function __setAfterV1OpMarkerTransferHookForTests(fn) {
  afterV1OpMarkerTransferHook = typeof fn === 'function' ? fn : null;
}
function __setAfterV1SealPartialClearHookForTests(fn) {
  afterV1SealPartialClearHook = typeof fn === 'function' ? fn : null;
}
function __setAfterV1CompensationPartialHookForTests(fn) {
  afterV1CompensationPartialHook = typeof fn === 'function' ? fn : null;
}
function __setBeforeV1CompensationReleaseCasHookForTests(fn) {
  beforeV1CompensationReleaseCasHook = typeof fn === 'function' ? fn : null;
}
function __setBeforeV1SealRedemptionClearHookForTests(fn) {
  beforeV1SealRedemptionClearHook = typeof fn === 'function' ? fn : null;
}
function __setBeforeV1ConfirmCasHookForTests(fn) {
  beforeV1ConfirmCasHook = typeof fn === 'function' ? fn : null;
}

function __setAfterV1PendingCreateHookForTests(fn) {
  afterV1PendingCreateHook = typeof fn === 'function' ? fn : null;
}

function statusFromBalance(balanceRemainingCents, amountOriginalCents) {
  if (balanceRemainingCents === amountOriginalCents) return 'active';
  if (balanceRemainingCents >= 0 && balanceRemainingCents < amountOriginalCents) {
    return 'partially_redeemed';
  }
  return 'partially_redeemed';
}

function toNow(now) {
  return now instanceof Date ? now : new Date(now);
}

function buildStructuredError(code, fields = {}) {
  const err = new Error(code);
  err.code = code;
  Object.assign(err, fields);
  return err;
}

function isSafePositiveIntegerCents(value) {
  return Number.isInteger(value) && Number.isSafeInteger(value) && value > 0;
}

function isV1Redemption(doc) {
  return Number(doc?.ledgerProtocolVersion) === LEDGER_PROTOCOL_VERSION_V1;
}

function hasAcquisitionMarker(value) {
  return value != null && String(value).trim() !== '';
}

function markerString(value) {
  return hasAcquisitionMarker(value) ? String(value).trim() : null;
}

function unmarkedMarkerClause(fieldPath) {
  return {
    $or: [{ [fieldPath]: null }, { [fieldPath]: { $exists: false } }]
  };
}

function buildOperationId(redemptionId) {
  return `gvop:v1:${String(redemptionId)}`;
}

function toRedemptionObjectId(redemptionId) {
  return redemptionId instanceof mongoose.Types.ObjectId
    ? redemptionId
    : new mongoose.Types.ObjectId(String(redemptionId));
}

function assertTokenlessDualUnmarked({ redemption, operation }) {
  if (hasAcquisitionMarker(redemption?.[ATTEMPT_MARKER_FIELD])) {
    throw buildStructuredError(VOUCHER_RESERVATION_IN_PROGRESS, {
      reason: 'redemption_marked',
      redemptionId: redemption?._id ? String(redemption._id) : null,
      [ATTEMPT_MARKER_FIELD]: markerString(redemption[ATTEMPT_MARKER_FIELD])
    });
  }
  if (operation && hasAcquisitionMarker(operation[ATTEMPT_MARKER_FIELD])) {
    throw buildStructuredError(VOUCHER_RESERVATION_IN_PROGRESS, {
      reason: 'operation_marked',
      redemptionId: redemption?._id ? String(redemption._id) : null,
      operationId: operation.operationId,
      [ATTEMPT_MARKER_FIELD]: markerString(operation[ATTEMPT_MARKER_FIELD])
    });
  }
}

function assertDualAttemptOwnership({ redemption, operation, attemptId }) {
  const expected = String(attemptId || '').trim();
  if (!expected) {
    throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
      reason: 'missing_attempt_id'
    });
  }
  if (markerString(redemption?.[ATTEMPT_MARKER_FIELD]) !== expected) {
    throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
      reason: 'redemption_marker_mismatch',
      expected,
      found: markerString(redemption?.[ATTEMPT_MARKER_FIELD]),
      redemptionId: redemption?._id ? String(redemption._id) : null
    });
  }
  if (!operation || markerString(operation[ATTEMPT_MARKER_FIELD]) !== expected) {
    throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
      reason: 'operation_marker_mismatch',
      expected,
      found: markerString(operation?.[ATTEMPT_MARKER_FIELD]),
      operationId: operation?.operationId || null
    });
  }
}

function buildLedgerEventKey(type, operationId) {
  return `${type}:${operationId}`;
}

function findEmbeddedOperation(voucher, { operationId, redemptionId }) {
  const ops = Array.isArray(voucher?.reservationLedgerOperations)
    ? voucher.reservationLedgerOperations
    : [];
  const redemptionIdStr = redemptionId != null ? String(redemptionId) : null;
  return (
    ops.find((op) => {
      const opRedemption = op.redemptionId != null ? String(op.redemptionId) : null;
      if (operationId && op.operationId === operationId) return true;
      if (redemptionIdStr && opRedemption === redemptionIdStr) return true;
      return false;
    }) || null
  );
}

function assertOperationIdentityMatch(op, expected) {
  if (!op) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'missing_operation',
      operationId: expected.operationId,
      redemptionId: String(expected.redemptionId)
    });
  }
  if (op.operationId !== expected.operationId) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'operation_id_mismatch',
      expectedOperationId: expected.operationId,
      foundOperationId: op.operationId
    });
  }
  if (String(op.redemptionId) !== String(expected.redemptionId)) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'redemption_id_mismatch',
      expectedRedemptionId: String(expected.redemptionId),
      foundRedemptionId: String(op.redemptionId)
    });
  }
  if (op.reservationKey !== expected.reservationKey) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'reservation_key_mismatch',
      expectedReservationKey: expected.reservationKey,
      foundReservationKey: op.reservationKey
    });
  }
  if (Number(op.amountCents) !== Number(expected.amountCents)) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'amount_mismatch',
      expectedAmountCents: expected.amountCents,
      foundAmountCents: op.amountCents
    });
  }
  if (op.currency !== expected.currency) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'currency_mismatch',
      expectedCurrency: expected.currency,
      foundCurrency: op.currency
    });
  }
  if (Number(op.protocolVersion) !== LEDGER_PROTOCOL_VERSION_V1) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'protocol_version_mismatch',
      foundProtocolVersion: op.protocolVersion
    });
  }
}

function normalizeIndexKey(key) {
  if (!key || typeof key !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(key)) {
    out[k] = v;
  }
  return out;
}

function partialFilterEqual(actual, expected) {
  return JSON.stringify(actual || null) === JSON.stringify(expected || null);
}

async function listCollectionIndexes(collectionName) {
  const coll = mongoose.connection.collection(collectionName);
  return coll.indexes();
}

function findMatchingIndex(indexes, spec) {
  const expectedKeys = normalizeIndexKey(spec.keys);
  return indexes.find((idx) => {
    if (idx.name !== spec.options.name) return false;
    if (Boolean(idx.unique) !== Boolean(spec.options.unique)) return false;
    const actualKeys = normalizeIndexKey(idx.key);
    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) return false;
    if (!partialFilterEqual(idx.partialFilterExpression, spec.options.partialFilterExpression)) {
      return false;
    }
    return true;
  });
}

async function assertVoucherLedgerAuthoritativeIndexes() {
  const redemptionIndexes = await listCollectionIndexes('giftvoucherredemptions');
  const eventIndexes = await listCollectionIndexes('giftvoucherevents');

  const required = [
    {
      collection: 'giftvoucherredemptions',
      indexes: redemptionIndexes,
      spec: AUTHORITATIVE_V1_RESERVATION_KEY_INDEX_SPEC
    },
    {
      collection: 'giftvoucherredemptions',
      indexes: redemptionIndexes,
      spec: AUTHORITATIVE_V1_LIVE_CHECKOUT_INDEX_SPEC
    },
    {
      collection: 'giftvoucherevents',
      indexes: eventIndexes,
      spec: AUTHORITATIVE_LEDGER_EVENT_KEY_INDEX_SPEC
    }
  ];

  for (const item of required) {
    const hit = findMatchingIndex(item.indexes, item.spec);
    if (!hit) {
      throw buildStructuredError(VOUCHER_LEDGER_INDEX_MISSING, {
        collection: item.collection,
        indexName: item.spec.options.name,
        expectedKeys: item.spec.keys,
        expectedUnique: item.spec.options.unique,
        expectedPartialFilterExpression: item.spec.options.partialFilterExpression
      });
    }
  }
  return true;
}

async function ensureVoucherLedgerIndexesForTests() {
  const redemptionColl = mongoose.connection.collection('giftvoucherredemptions');
  const eventColl = mongoose.connection.collection('giftvoucherevents');

  await redemptionColl.createIndex(
    AUTHORITATIVE_V1_RESERVATION_KEY_INDEX_SPEC.keys,
    { ...AUTHORITATIVE_V1_RESERVATION_KEY_INDEX_SPEC.options }
  );
  await redemptionColl.createIndex(
    AUTHORITATIVE_V1_LIVE_CHECKOUT_INDEX_SPEC.keys,
    { ...AUTHORITATIVE_V1_LIVE_CHECKOUT_INDEX_SPEC.options }
  );
  await redemptionColl.createIndex(
    AUTHORITATIVE_ACQUISITION_ATTEMPT_INDEX_SPEC.keys,
    { ...AUTHORITATIVE_ACQUISITION_ATTEMPT_INDEX_SPEC.options }
  );
  await eventColl.createIndex(
    AUTHORITATIVE_LEDGER_EVENT_KEY_INDEX_SPEC.keys,
    { ...AUTHORITATIVE_LEDGER_EVENT_KEY_INDEX_SPEC.options }
  );
  await assertVoucherLedgerAuthoritativeIndexes();
  return true;
}

async function hasKeyedLedgerEvent({ giftVoucherId, type, operationId }) {
  const ledgerEventKey = buildLedgerEventKey(type, operationId);
  const hit = await GiftVoucherEvent.findOne({
    giftVoucherId,
    type,
    'metadata.ledgerEventKey': ledgerEventKey
  })
    .select('_id')
    .lean();
  return Boolean(hit);
}

async function countKeyedLedgerEvents({ giftVoucherId, type, operationId }) {
  const ledgerEventKey = buildLedgerEventKey(type, operationId);
  return GiftVoucherEvent.countDocuments({
    giftVoucherId,
    type,
    'metadata.ledgerEventKey': ledgerEventKey
  });
}

async function hasRedemptionEvent({ giftVoucherId, redemptionId, type }) {
  const hit = await GiftVoucherEvent.findOne({
    giftVoucherId,
    type,
    'metadata.redemptionId': String(redemptionId)
  })
    .select('_id')
    .lean();
  return Boolean(hit);
}

async function writeOrRepairLedgerEvent({
  giftVoucherId,
  type,
  operationId,
  redemptionId,
  actor,
  note,
  previousBalanceCents,
  newBalanceCents,
  deltaCents,
  extraMetadata = {}
}) {
  const ledgerEventKey = buildLedgerEventKey(type, operationId);
  if (await hasKeyedLedgerEvent({ giftVoucherId, type, operationId })) {
    const count = await countKeyedLedgerEvents({ giftVoucherId, type, operationId });
    if (count !== 1) {
      throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
        reason: 'duplicate_ledger_events',
        type,
        operationId,
        count
      });
    }
    return { ok: true, eventRepaired: false, alreadyPresent: true };
  }

  try {
    await giftVoucherEventService.appendFinancialVoucherEvent({
      giftVoucherId,
      type,
      actor,
      note,
      previousBalanceCents,
      newBalanceCents,
      deltaCents,
      metadata: {
        redemptionId: String(redemptionId),
        operationId,
        ledgerEventKey,
        ledgerProtocolVersion: LEDGER_PROTOCOL_VERSION_V1,
        ...extraMetadata
      }
    });
  } catch (eventErr) {
    if (eventErr?.code === 11000 || /duplicate key/i.test(String(eventErr?.message || ''))) {
      const count = await countKeyedLedgerEvents({ giftVoucherId, type, operationId });
      if (count === 1) {
        return { ok: true, eventRepaired: false, alreadyPresent: true };
      }
    }
    throw buildStructuredError(LEDGER_EVENT_INCOMPLETE, {
      giftVoucherId: String(giftVoucherId),
      redemptionId: String(redemptionId),
      operationId,
      eventType: type,
      cause: eventErr.message
    });
  }

  const count = await countKeyedLedgerEvents({ giftVoucherId, type, operationId });
  if (count !== 1) {
    throw buildStructuredError(LEDGER_EVENT_INCOMPLETE, {
      giftVoucherId: String(giftVoucherId),
      redemptionId: String(redemptionId),
      operationId,
      eventType: type,
      cause: `expected exactly one keyed event, found ${count}`
    });
  }
  return { ok: true, eventRepaired: true, alreadyPresent: false };
}

async function atomicDebitV1({
  giftVoucherId,
  redemptionId,
  operationId,
  reservationKey,
  amountCents,
  currency,
  now,
  requireUnmarked = false
}) {
  const redemptionObjectId =
    redemptionId instanceof mongoose.Types.ObjectId
      ? redemptionId
      : new mongoose.Types.ObjectId(String(redemptionId));

  const pushFilterAnd = [
    {
      reservationLedgerOperations: {
        $not: { $elemMatch: { operationId } }
      }
    },
    {
      reservationLedgerOperations: {
        $not: { $elemMatch: { redemptionId: redemptionObjectId } }
      }
    }
  ];

  const voucher = await GiftVoucher.findOneAndUpdate(
    {
      _id: giftVoucherId,
      currency: 'EUR',
      status: { $in: ['active', 'partially_redeemed'] },
      expiresAt: { $gt: now },
      balanceRemainingCents: { $gte: amountCents },
      $and: pushFilterAnd
    },
    {
      $inc: { balanceRemainingCents: -amountCents },
      $push: {
        reservationLedgerOperations: {
          operationId,
          redemptionId: redemptionObjectId,
          reservationKey,
          amountCents,
          currency,
          state: 'debited',
          debitedAt: now,
          restoredAt: null,
          [ATTEMPT_MARKER_FIELD]: null,
          protocolVersion: LEDGER_PROTOCOL_VERSION_V1
        }
      },
      $set: { status: 'partially_redeemed' }
    },
    { new: true }
  );

  if (voucher) {
    return {
      ok: true,
      alreadyApplied: false,
      voucher,
      previousBalanceCents: voucher.balanceRemainingCents + amountCents,
      newBalanceCents: voucher.balanceRemainingCents
    };
  }

  const current = await GiftVoucher.findById(giftVoucherId).lean();
  if (!current) {
    throw buildStructuredError('VOUCHER_NOT_FOUND', { giftVoucherId: String(giftVoucherId) });
  }

  const byOp = findEmbeddedOperation(current, { operationId });
  const byRedemption = findEmbeddedOperation(current, { redemptionId: redemptionObjectId });

  if (byOp || byRedemption) {
    const op = byOp || byRedemption;
    assertOperationIdentityMatch(op, {
      operationId,
      redemptionId: redemptionObjectId,
      reservationKey,
      amountCents,
      currency
    });
    if (requireUnmarked && hasAcquisitionMarker(op[ATTEMPT_MARKER_FIELD])) {
      throw buildStructuredError(VOUCHER_RESERVATION_IN_PROGRESS, {
        reason: 'tokenless_debit_blocked_marked_operation',
        operationId,
        [ATTEMPT_MARKER_FIELD]: markerString(op[ATTEMPT_MARKER_FIELD])
      });
    }
    if (op.state === 'debited') {
      return {
        ok: true,
        alreadyApplied: true,
        voucher: current,
        previousBalanceCents: current.balanceRemainingCents + amountCents,
        newBalanceCents: current.balanceRemainingCents
      };
    }
    if (op.state === 'restored') {
      throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
        reason: 'operation_already_restored_on_debit_retry',
        operationId,
        redemptionId: String(redemptionObjectId)
      });
    }
    if (op.state === 'voided') {
      throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
        reason: 'operation_voided_cannot_debit',
        operationId,
        redemptionId: String(redemptionObjectId)
      });
    }
    if (op.state === 'pending') {
      throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
        reason: 'pending_requires_attempt_debit_path',
        operationId,
        redemptionId: String(redemptionObjectId)
      });
    }
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'unexpected_operation_state',
      state: op.state,
      operationId
    });
  }

  return { ok: false, code: 'RESERVE_FAILED', voucher: current };
}

async function atomicRestoreV1({
  giftVoucherId,
  redemptionId,
  operationId,
  reservationKey,
  amountCents,
  currency,
  now,
  [ATTEMPT_MARKER_FIELD]: attemptMarkerId = null,
  requireUnmarked = false,
  systemExpiry = false,
  clearMarker = false
}) {
  const redemptionObjectId =
    redemptionId instanceof mongoose.Types.ObjectId
      ? redemptionId
      : new mongoose.Types.ObjectId(String(redemptionId));

  const current = await GiftVoucher.findById(giftVoucherId).lean();
  if (!current) {
    throw buildStructuredError('VOUCHER_NOT_FOUND', { giftVoucherId: String(giftVoucherId) });
  }

  const existingOp = findEmbeddedOperation(current, { operationId, redemptionId: redemptionObjectId });
  if (!existingOp) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'missing_operation_on_restore',
      operationId,
      redemptionId: String(redemptionObjectId)
    });
  }
  assertOperationIdentityMatch(existingOp, {
    operationId,
    redemptionId: redemptionObjectId,
    reservationKey,
    amountCents,
    currency
  });

  if (existingOp.state === 'restored') {
    return {
      ok: true,
      alreadyRestored: true,
      voucher: current,
      amountCents: existingOp.amountCents,
      previousBalanceCents: current.balanceRemainingCents - existingOp.amountCents,
      newBalanceCents: current.balanceRemainingCents
    };
  }

  if (existingOp.state !== 'debited') {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'unexpected_operation_state_on_restore',
      state: existingOp.state,
      operationId
    });
  }

  if (requireUnmarked && hasAcquisitionMarker(existingOp[ATTEMPT_MARKER_FIELD])) {
    throw buildStructuredError(VOUCHER_RESERVATION_IN_PROGRESS, {
      reason: 'restore_blocked_marked_operation',
      operationId,
      [ATTEMPT_MARKER_FIELD]: markerString(existingOp[ATTEMPT_MARKER_FIELD])
    });
  }

  const attemptMarker =
    attemptMarkerId != null ? String(attemptMarkerId).trim() : null;
  if (attemptMarker) {
    if (markerString(existingOp[ATTEMPT_MARKER_FIELD]) !== attemptMarker) {
      throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
        reason: 'restore_marker_mismatch',
        expected: attemptMarker,
        found: markerString(existingOp[ATTEMPT_MARKER_FIELD]),
        operationId
      });
    }
  }

  const restoreAmount = Number(existingOp.amountCents);
  if (!isSafePositiveIntegerCents(restoreAmount)) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'invalid_embedded_amount',
      amountCents: existingOp.amountCents
    });
  }

  if (Number(current.balanceRemainingCents) + restoreAmount > Number(current.amountOriginalCents)) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'restore_exceeds_original_ceiling',
      balanceRemainingCents: current.balanceRemainingCents,
      restoreAmount,
      amountOriginalCents: current.amountOriginalCents
    });
  }

  const scanNow = toNow(now);
  const shouldClearMarker = Boolean(clearMarker || systemExpiry);
  const opPatch = shouldClearMarker
    ? { state: 'restored', restoredAt: scanNow, [ATTEMPT_MARKER_FIELD]: null }
    : { state: 'restored', restoredAt: scanNow };

  const baseElemMatch = {
    operationId,
    redemptionId: redemptionObjectId,
    state: 'debited',
    amountCents: restoreAmount,
    currency,
    reservationKey
  };
  if (attemptMarker) {
    baseElemMatch[ATTEMPT_MARKER_FIELD] = attemptMarker;
  }

  let filter;
  if (requireUnmarked && !attemptMarker && !systemExpiry) {
    filter = {
      _id: giftVoucherId,
      amountOriginalCents: { $gte: 0 },
      balanceRemainingCents: { $lte: Number(current.amountOriginalCents) - restoreAmount },
      $or: [
        {
          reservationLedgerOperations: {
            $elemMatch: { ...baseElemMatch, [ATTEMPT_MARKER_FIELD]: null }
          }
        },
        {
          reservationLedgerOperations: {
            $elemMatch: {
              ...baseElemMatch,
              [ATTEMPT_MARKER_FIELD]: { $exists: false }
            }
          }
        }
      ]
    };
  } else {
    filter = {
      _id: giftVoucherId,
      amountOriginalCents: { $gte: 0 },
      balanceRemainingCents: { $lte: Number(current.amountOriginalCents) - restoreAmount },
      reservationLedgerOperations: { $elemMatch: baseElemMatch }
    };
  }

  // Only explicitly redeemable pre-states may become active/partially_redeemed.
  // Terminal / admin statuses are preserved; expiresAt <= now forces expired for redeemable pre-states.
  const updated = await GiftVoucher.findOneAndUpdate(
    filter,
    [
      {
        $set: {
          balanceRemainingCents: { $add: ['$balanceRemainingCents', restoreAmount] },
          reservationLedgerOperations: {
            $map: {
              input: '$reservationLedgerOperations',
              as: 'o',
              in: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$$o.operationId', operationId] },
                      { $eq: ['$$o.redemptionId', redemptionObjectId] },
                      { $eq: ['$$o.state', 'debited'] }
                    ]
                  },
                  {
                    $mergeObjects: ['$$o', opPatch]
                  },
                  '$$o'
                ]
              }
            }
          }
        }
      },
      {
        $set: {
          status: {
            $let: {
              vars: {
                wasRedeemable: { $in: ['$status', ['active', 'partially_redeemed']] },
                expiredByClock: {
                  $and: [
                    { $ne: ['$expiresAt', null] },
                    { $lte: ['$expiresAt', scanNow] }
                  ]
                },
                derivedRedeemable: {
                  $cond: [
                    { $eq: ['$balanceRemainingCents', '$amountOriginalCents'] },
                    'active',
                    'partially_redeemed'
                  ]
                }
              },
              in: {
                $cond: [
                  {
                    $and: ['$$wasRedeemable', '$$expiredByClock']
                  },
                  'expired',
                  {
                    $cond: [
                      '$$wasRedeemable',
                      '$$derivedRedeemable',
                      '$status'
                    ]
                  }
                ]
              }
            }
          }
        }
      }
    ],
    { new: true }
  );

  if (!updated) {
    const latest = await GiftVoucher.findById(giftVoucherId).lean();
    const op = findEmbeddedOperation(latest, { operationId, redemptionId: redemptionObjectId });
    if (op?.state === 'restored') {
      assertOperationIdentityMatch(op, {
        operationId,
        redemptionId: redemptionObjectId,
        reservationKey,
        amountCents,
        currency
      });
      return {
        ok: true,
        alreadyRestored: true,
        voucher: latest,
        amountCents: op.amountCents,
        previousBalanceCents: latest.balanceRemainingCents - op.amountCents,
        newBalanceCents: latest.balanceRemainingCents
      };
    }
    if (
      latest &&
      Number(latest.balanceRemainingCents) + restoreAmount > Number(latest.amountOriginalCents)
    ) {
      throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
        reason: 'restore_exceeds_original_ceiling',
        balanceRemainingCents: latest.balanceRemainingCents,
        restoreAmount,
        amountOriginalCents: latest.amountOriginalCents
      });
    }
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'restore_cas_failed',
      operationId,
      redemptionId: String(redemptionObjectId)
    });
  }

  return {
    ok: true,
    alreadyRestored: false,
    voucher: updated,
    amountCents: restoreAmount,
    previousBalanceCents: updated.balanceRemainingCents - restoreAmount,
    newBalanceCents: updated.balanceRemainingCents
  };
}

/**
 * B8F2B1B: claim embedded monetary op as pending with attempt marker (no balance change).
 */
async function claimPendingLedgerOperationV1({
  giftVoucherId,
  redemptionId,
  operationId,
  reservationKey,
  amountCents,
  currency,
  [ATTEMPT_MARKER_FIELD]: attemptMarkerId,
  now
}) {
  const attemptId = String(attemptMarkerId || '').trim();
  if (!attemptId) {
    throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
      reason: 'claim_pending_requires_attempt_id'
    });
  }
  const redemptionObjectId = toRedemptionObjectId(redemptionId);
  const scanNow = toNow(now);

  if (typeof beforeV1PendingOpClaimHook === 'function') {
    await beforeV1PendingOpClaimHook({
      giftVoucherId: String(giftVoucherId),
      redemptionId: String(redemptionObjectId),
      operationId,
      [ATTEMPT_MARKER_FIELD]: attemptId
    });
  }

  const voucher = await GiftVoucher.findOneAndUpdate(
    {
      _id: giftVoucherId,
      $and: [
        { reservationLedgerOperations: { $not: { $elemMatch: { operationId } } } },
        {
          reservationLedgerOperations: {
            $not: { $elemMatch: { redemptionId: redemptionObjectId } }
          }
        }
      ]
    },
    {
      $push: {
        reservationLedgerOperations: {
          operationId,
          redemptionId: redemptionObjectId,
          reservationKey,
          amountCents,
          currency,
          state: 'pending',
          [ATTEMPT_MARKER_FIELD]: attemptId,
          pendingAt: scanNow,
          debitedAt: null,
          restoredAt: null,
          voidedAt: null,
          protocolVersion: LEDGER_PROTOCOL_VERSION_V1
        }
      }
    },
    { new: true }
  );

  if (voucher) {
    if (typeof afterV1PendingOpClaimHook === 'function') {
      await afterV1PendingOpClaimHook({
        giftVoucherId: String(giftVoucherId),
        redemptionId: String(redemptionObjectId),
        operationId,
        [ATTEMPT_MARKER_FIELD]: attemptId
      });
    }
    return { ok: true, created: true, alreadyPresent: false, voucher };
  }

  const current = await GiftVoucher.findById(giftVoucherId).lean();
  if (!current) {
    throw buildStructuredError('VOUCHER_NOT_FOUND', { giftVoucherId: String(giftVoucherId) });
  }
  const op = findEmbeddedOperation(current, { operationId, redemptionId: redemptionObjectId });
  if (!op) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'claim_pending_race_missing_op',
      operationId,
      redemptionId: String(redemptionObjectId)
    });
  }
  assertOperationIdentityMatch(op, {
    operationId,
    redemptionId: redemptionObjectId,
    reservationKey,
    amountCents,
    currency
  });
  if (op.state === 'voided') {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'operation_voided_cannot_reclaim',
      operationId
    });
  }
  if (markerString(op[ATTEMPT_MARKER_FIELD]) === attemptId) {
    return { ok: true, created: false, alreadyPresent: true, voucher: current, operation: op };
  }
  return {
    ok: false,
    code: 'OPERATION_OWNED_BY_OTHER',
    voucher: current,
    operation: op,
    ownerAttemptId: markerString(op[ATTEMPT_MARKER_FIELD])
  };
}

/**
 * B8F2B1B: pending + exact marker → debited + exact marker with balance decrement.
 */
async function debitPendingLedgerOperationV1({
  giftVoucherId,
  redemptionId,
  operationId,
  reservationKey,
  amountCents,
  currency,
  [ATTEMPT_MARKER_FIELD]: attemptMarkerId,
  now
}) {
  const attemptId = String(attemptMarkerId || '').trim();
  if (!attemptId) {
    throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
      reason: 'debit_pending_requires_attempt_id'
    });
  }
  const redemptionObjectId = toRedemptionObjectId(redemptionId);
  const scanNow = toNow(now);

  const voucher = await GiftVoucher.findOneAndUpdate(
    {
      _id: giftVoucherId,
      currency: 'EUR',
      status: { $in: ['active', 'partially_redeemed'] },
      expiresAt: { $gt: scanNow },
      balanceRemainingCents: { $gte: amountCents },
      reservationLedgerOperations: {
        $elemMatch: {
          operationId,
          redemptionId: redemptionObjectId,
          state: 'pending',
          [ATTEMPT_MARKER_FIELD]: attemptId,
          amountCents,
          currency,
          reservationKey
        }
      }
    },
    {
      $inc: { balanceRemainingCents: -amountCents },
      $set: {
        status: 'partially_redeemed',
        'reservationLedgerOperations.$[op].state': 'debited',
        'reservationLedgerOperations.$[op].debitedAt': scanNow
      }
    },
    {
      new: true,
      arrayFilters: [
        {
          'op.operationId': operationId,
          'op.redemptionId': redemptionObjectId,
          'op.state': 'pending',
          ['op.' + ATTEMPT_MARKER_FIELD]: attemptId
        }
      ]
    }
  );

  if (voucher) {
    return {
      ok: true,
      alreadyApplied: false,
      voucher,
      previousBalanceCents: voucher.balanceRemainingCents + amountCents,
      newBalanceCents: voucher.balanceRemainingCents
    };
  }

  const current = await GiftVoucher.findById(giftVoucherId).lean();
  if (!current) {
    throw buildStructuredError('VOUCHER_NOT_FOUND', { giftVoucherId: String(giftVoucherId) });
  }
  const op = findEmbeddedOperation(current, { operationId, redemptionId: redemptionObjectId });
  if (!op) {
    return { ok: false, code: 'OPERATION_MISSING', voucher: current };
  }
  assertOperationIdentityMatch(op, {
    operationId,
    redemptionId: redemptionObjectId,
    reservationKey,
    amountCents,
    currency
  });
  if (op.state === 'debited' && markerString(op[ATTEMPT_MARKER_FIELD]) === attemptId) {
    return {
      ok: true,
      alreadyApplied: true,
      voucher: current,
      previousBalanceCents: current.balanceRemainingCents + amountCents,
      newBalanceCents: current.balanceRemainingCents
    };
  }
  if (op.state === 'voided') {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'operation_voided_cannot_debit',
      operationId
    });
  }
  if (markerString(op[ATTEMPT_MARKER_FIELD]) !== attemptId) {
    throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
      reason: 'debit_blocked_foreign_marker',
      expected: attemptId,
      found: markerString(op[ATTEMPT_MARKER_FIELD]),
      operationId,
      state: op.state
    });
  }
  return { ok: false, code: 'DEBIT_PENDING_FAILED', voucher: current, operation: op };
}

/**
 * Durable void of a pending op (no balance change). Clears marker.
 */
async function voidPendingLedgerOperationV1({
  giftVoucherId,
  redemptionId,
  operationId,
  [ATTEMPT_MARKER_FIELD]: attemptMarkerId = null,
  systemExpiry = false,
  clearMarker = true,
  now
}) {
  const redemptionObjectId = toRedemptionObjectId(redemptionId);
  const scanNow = toNow(now);
  const attemptId =
    attemptMarkerId != null ? String(attemptMarkerId).trim() : null;

  const current = await GiftVoucher.findById(giftVoucherId).lean();
  if (!current) {
    throw buildStructuredError('VOUCHER_NOT_FOUND', { giftVoucherId: String(giftVoucherId) });
  }
  const existingOp = findEmbeddedOperation(current, { operationId, redemptionId: redemptionObjectId });
  if (!existingOp) {
    return { ok: true, alreadyVoided: false, missing: true, voucher: current };
  }
  if (existingOp.state === 'voided') {
    return { ok: true, alreadyVoided: true, voucher: current, operation: existingOp };
  }
  if (existingOp.state !== 'pending') {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'void_requires_pending_operation',
      state: existingOp.state,
      operationId
    });
  }
  if (!systemExpiry) {
    if (!attemptId || markerString(existingOp[ATTEMPT_MARKER_FIELD]) !== attemptId) {
      throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
        reason: 'void_pending_marker_mismatch',
        expected: attemptId,
        found: markerString(existingOp[ATTEMPT_MARKER_FIELD]),
        operationId
      });
    }
  }

  const elemMatch = {
    operationId,
    redemptionId: redemptionObjectId,
    state: 'pending'
  };
  if (!systemExpiry) {
    elemMatch[ATTEMPT_MARKER_FIELD] = attemptId;
  }

  // Default clearMarker:true preserves B8F2B1A tokenless/expiry callers.
  // Attempt-fenced compensation passes clearMarker:false until the attribution event is durable.
  const shouldClearMarker = clearMarker !== false || systemExpiry;
  const setPatch = {
    'reservationLedgerOperations.$[op].state': 'voided',
    'reservationLedgerOperations.$[op].voidedAt': scanNow
  };
  if (shouldClearMarker) {
    setPatch['reservationLedgerOperations.$[op].' + ATTEMPT_MARKER_FIELD] = null;
  }

  const updated = await GiftVoucher.findOneAndUpdate(
    {
      _id: giftVoucherId,
      reservationLedgerOperations: { $elemMatch: elemMatch }
    },
    { $set: setPatch },
    {
      new: true,
      arrayFilters: [
        systemExpiry
          ? {
              'op.operationId': operationId,
              'op.redemptionId': redemptionObjectId,
              'op.state': 'pending'
            }
          : {
              'op.operationId': operationId,
              'op.redemptionId': redemptionObjectId,
              'op.state': 'pending',
              ['op.' + ATTEMPT_MARKER_FIELD]: attemptId
            }
      ]
    }
  );

  if (!updated) {
    const latest = await GiftVoucher.findById(giftVoucherId).lean();
    const op = findEmbeddedOperation(latest, { operationId, redemptionId: redemptionObjectId });
    if (op?.state === 'voided') {
      return { ok: true, alreadyVoided: true, voucher: latest, operation: op };
    }
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'void_pending_cas_failed',
      operationId,
      state: op?.state
    });
  }
  return {
    ok: true,
    alreadyVoided: false,
    voucher: updated,
    operation: findEmbeddedOperation(updated, { operationId, redemptionId: redemptionObjectId })
  };
}

async function transferLedgerOperationMarkerV1({
  giftVoucherId,
  redemptionId,
  operationId,
  fromAttemptId,
  toAttemptId,
  now
}) {
  const fromId = String(fromAttemptId || '').trim();
  const toId = String(toAttemptId || '').trim();
  if (!fromId || !toId) {
    throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
      reason: 'transfer_requires_from_and_to'
    });
  }
  const redemptionObjectId = toRedemptionObjectId(redemptionId);
  const scanNow = toNow(now);

  const current = await GiftVoucher.findById(giftVoucherId).lean();
  if (!current) {
    throw buildStructuredError('VOUCHER_NOT_FOUND', { giftVoucherId: String(giftVoucherId) });
  }
  const op = findEmbeddedOperation(current, { operationId, redemptionId: redemptionObjectId });
  if (!op) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'transfer_missing_operation',
      operationId
    });
  }
  if (markerString(op[ATTEMPT_MARKER_FIELD]) === toId) {
    return { ok: true, alreadyTransferred: true, voucher: current, operation: op };
  }
  if (markerString(op[ATTEMPT_MARKER_FIELD]) !== fromId) {
    throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
      reason: 'transfer_from_mismatch',
      expected: fromId,
      found: markerString(op[ATTEMPT_MARKER_FIELD]),
      operationId
    });
  }
  if (op.state === 'voided' || op.state === 'restored') {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'transfer_blocked_terminal_operation',
      state: op.state,
      operationId
    });
  }

  const updated = await GiftVoucher.findOneAndUpdate(
    {
      _id: giftVoucherId,
      reservationLedgerOperations: {
        $elemMatch: {
          operationId,
          redemptionId: redemptionObjectId,
          [ATTEMPT_MARKER_FIELD]: fromId,
          state: { $in: ['pending', 'debited'] }
        }
      }
    },
    {
      $set: {
        ['reservationLedgerOperations.$[op].' + ATTEMPT_MARKER_FIELD]: toId
      }
    },
    {
      new: true,
      arrayFilters: [
        {
          'op.operationId': operationId,
          'op.redemptionId': redemptionObjectId,
          ['op.' + ATTEMPT_MARKER_FIELD]: fromId
        }
      ]
    }
  );

  if (!updated) {
    const latest = await GiftVoucher.findById(giftVoucherId).lean();
    const latestOp = findEmbeddedOperation(latest, { operationId, redemptionId: redemptionObjectId });
    if (markerString(latestOp?.[ATTEMPT_MARKER_FIELD]) === toId) {
      return { ok: true, alreadyTransferred: true, voucher: latest, operation: latestOp };
    }
    throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
      reason: 'operation_marker_transfer_failed',
      operationId,
      fromAttemptId: fromId,
      toAttemptId: toId
    });
  }

  if (typeof afterV1OpMarkerTransferHook === 'function') {
    await afterV1OpMarkerTransferHook({
      giftVoucherId: String(giftVoucherId),
      redemptionId: String(redemptionObjectId),
      operationId,
      fromAttemptId: fromId,
      toAttemptId: toId,
      now: scanNow
    });
  }

  return {
    ok: true,
    alreadyTransferred: false,
    voucher: updated,
    operation: findEmbeddedOperation(updated, { operationId, redemptionId: redemptionObjectId })
  };
}

async function transferRedemptionMarkerV1({
  redemptionId,
  fromAttemptId,
  toAttemptId,
  now
}) {
  const fromId = String(fromAttemptId || '').trim();
  const toId = String(toAttemptId || '').trim();
  if (!fromId || !toId) {
    throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
      reason: 'redemption_transfer_requires_from_and_to'
    });
  }
  const scanNow = toNow(now);
  const existing = await GiftVoucherRedemption.findById(redemptionId).lean();
  if (!existing) {
    throw buildStructuredError('REDEMPTION_NOT_FOUND', { redemptionId: String(redemptionId) });
  }
  if (markerString(existing[ATTEMPT_MARKER_FIELD]) === toId) {
    return { ok: true, alreadyTransferred: true, redemption: existing };
  }
  if (markerString(existing[ATTEMPT_MARKER_FIELD]) !== fromId) {
    throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
      reason: 'redemption_transfer_from_mismatch',
      expected: fromId,
      found: markerString(existing[ATTEMPT_MARKER_FIELD]),
      redemptionId: String(redemptionId)
    });
  }

  const updated = await GiftVoucherRedemption.findOneAndUpdate(
    {
      _id: redemptionId,
      ledgerProtocolVersion: LEDGER_PROTOCOL_VERSION_V1,
      [ATTEMPT_MARKER_FIELD]: fromId,
      status: { $in: ['pending_debit', 'reserved'] }
    },
    { $set: { [ATTEMPT_MARKER_FIELD]: toId } },
    { new: true }
  );

  if (!updated) {
    const latest = await GiftVoucherRedemption.findById(redemptionId).lean();
    if (markerString(latest?.[ATTEMPT_MARKER_FIELD]) === toId) {
      return { ok: true, alreadyTransferred: true, redemption: latest };
    }
    throw buildStructuredError(VOUCHER_ATTEMPT_MARKER_MISMATCH, {
      reason: 'redemption_marker_transfer_failed',
      redemptionId: String(redemptionId),
      fromAttemptId: fromId,
      toAttemptId: toId,
      status: latest?.status
    });
  }
  return { ok: true, alreadyTransferred: false, redemption: updated, now: scanNow };
}

async function clearRedemptionMarkerV1({ redemptionId, attemptId, allowedStatuses = null }) {
  const expected = String(attemptId || '').trim();
  const isSealClearPath = !Array.isArray(allowedStatuses) || allowedStatuses.length === 0;
  if (isSealClearPath && typeof beforeV1SealRedemptionClearHook === 'function') {
    await beforeV1SealRedemptionClearHook({
      redemptionId: String(redemptionId),
      attemptId: expected
    });
  }
  const statusFilter = Array.isArray(allowedStatuses) && allowedStatuses.length
    ? { status: { $in: allowedStatuses } }
    : { status: 'reserved' };
  const updated = await GiftVoucherRedemption.findOneAndUpdate(
    {
      _id: redemptionId,
      ledgerProtocolVersion: LEDGER_PROTOCOL_VERSION_V1,
      [ATTEMPT_MARKER_FIELD]: expected,
      ...statusFilter
    },
    { $set: { [ATTEMPT_MARKER_FIELD]: null } },
    { new: true }
  );
  if (updated) {
    if (isSealClearPath && typeof afterV1SealPartialClearHook === 'function') {
      await afterV1SealPartialClearHook({
        phase: 'redemption_marker_cleared',
        redemptionId: String(redemptionId),
        attemptId: expected
      });
    }
    return { ok: true, cleared: true, redemption: updated };
  }
  const latest = await GiftVoucherRedemption.findById(redemptionId).lean();
  if (latest && !hasAcquisitionMarker(latest[ATTEMPT_MARKER_FIELD])) {
    return { ok: true, cleared: false, alreadyClear: true, redemption: latest };
  }
  return { ok: false, redemption: latest };
}

async function clearOperationMarkerV1({
  giftVoucherId,
  redemptionId,
  operationId,
  attemptId,
  allowedStates = null
}) {
  const expected = String(attemptId || '').trim();
  const redemptionObjectId = toRedemptionObjectId(redemptionId);
  const states =
    Array.isArray(allowedStates) && allowedStates.length
      ? allowedStates
      : ['debited'];
  const updated = await GiftVoucher.findOneAndUpdate(
    {
      _id: giftVoucherId,
      reservationLedgerOperations: {
        $elemMatch: {
          operationId,
          redemptionId: redemptionObjectId,
          [ATTEMPT_MARKER_FIELD]: expected,
          state: { $in: states }
        }
      }
    },
    {
      $set: {
        ['reservationLedgerOperations.$[op].' + ATTEMPT_MARKER_FIELD]: null
      }
    },
    {
      new: true,
      arrayFilters: [
        {
          'op.operationId': operationId,
          'op.redemptionId': redemptionObjectId,
          ['op.' + ATTEMPT_MARKER_FIELD]: expected,
          'op.state': { $in: states }
        }
      ]
    }
  );
  if (updated) {
    return {
      ok: true,
      cleared: true,
      voucher: updated,
      operation: findEmbeddedOperation(updated, { operationId, redemptionId: redemptionObjectId })
    };
  }
  const latest = await GiftVoucher.findById(giftVoucherId).lean();
  const op = findEmbeddedOperation(latest, { operationId, redemptionId: redemptionObjectId });
  if (op && !hasAcquisitionMarker(op[ATTEMPT_MARKER_FIELD])) {
    return { ok: true, cleared: false, alreadyClear: true, voucher: latest, operation: op };
  }
  return { ok: false, voucher: latest, operation: op };
}

async function renewUnmarkedRedemptionExpiryV1({ redemptionId, expiresAt, now }) {
  const scanNow = toNow(now);
  const target = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(target.getTime()) || target <= scanNow) {
    throw buildStructuredError('INVALID_REDEMPTION_EXPIRY', {
      expiresAt: String(expiresAt)
    });
  }
  const updated = await GiftVoucherRedemption.findOneAndUpdate(
    {
      _id: redemptionId,
      ledgerProtocolVersion: LEDGER_PROTOCOL_VERSION_V1,
      status: 'reserved',
      $and: [unmarkedMarkerClause(ATTEMPT_MARKER_FIELD)]
    },
    [{ $set: { expiresAt: { $max: ['$expiresAt', target] } } }],
    { new: true }
  );
  if (!updated) {
    throw buildStructuredError(VOUCHER_RESERVATION_IN_PROGRESS, {
      reason: 'renew_requires_unmarked_reserved',
      redemptionId: String(redemptionId)
    });
  }
  return { ok: true, redemption: updated };
}

async function voidPendingDebitV1({ redemptionId, reason, now }) {
  const result = await GiftVoucherRedemption.findOneAndUpdate(
    {
      _id: redemptionId,
      ledgerProtocolVersion: LEDGER_PROTOCOL_VERSION_V1,
      status: 'pending_debit'
    },
    {
      $set: {
        status: 'voided',
        reason: String(reason || 'voided').trim() || 'voided',
        releasedAt: now
      }
    },
    { new: true }
  );
  return result;
}

function assertV1RedemptionIdentity(redemption, expected) {
  if (!isV1Redemption(redemption)) {
    throw buildStructuredError(VOUCHER_LEDGER_PROTOCOL_MISMATCH, {
      reason: 'expected_v1_redemption',
      redemptionId: String(redemption._id)
    });
  }
  if (String(redemption.giftVoucherId) !== String(expected.giftVoucherId)) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'gift_voucher_mismatch',
      expected: String(expected.giftVoucherId),
      found: String(redemption.giftVoucherId)
    });
  }
  if (redemption.reservationKey !== expected.reservationKey) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'reservation_key_mismatch',
      expected: expected.reservationKey,
      found: redemption.reservationKey
    });
  }
  if (Number(redemption.amountAppliedCents) !== Number(expected.amountCents)) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'amount_mismatch',
      expected: expected.amountCents,
      found: redemption.amountAppliedCents
    });
  }
  if (redemption.currency !== expected.currency) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'currency_mismatch',
      expected: expected.currency,
      found: redemption.currency
    });
  }
  if (expected.checkoutId != null) {
    if (String(redemption.checkoutId || '') !== String(expected.checkoutId)) {
      throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
        reason: 'checkout_id_mismatch',
        expected: String(expected.checkoutId),
        found: String(redemption.checkoutId || '')
      });
    }
  }
}

function assertV1OperationIdPresent(redemption) {
  if (typeof redemption?.operationId !== 'string' || !redemption.operationId.trim()) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'missing_operation_id_on_v1_redemption',
      redemptionId: redemption?._id ? String(redemption._id) : null
    });
  }
  const expected = buildOperationId(redemption._id);
  if (redemption.operationId !== expected) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'operation_id_mismatch_on_v1_redemption',
      redemptionId: String(redemption._id),
      expectedOperationId: expected,
      foundOperationId: redemption.operationId
    });
  }
  return redemption.operationId;
}

async function resumeV1AfterPendingOrReserved({
  redemption,
  giftVoucherId,
  amountCents,
  currency,
  reservationKey,
  actor,
  note,
  now
}) {
  const operationId = assertV1OperationIdPresent(redemption);

  const voucherProbe = await GiftVoucher.findById(giftVoucherId).lean();
  const opProbe = findEmbeddedOperation(voucherProbe, {
    operationId,
    redemptionId: redemption._id
  });
  assertTokenlessDualUnmarked({ redemption, operation: opProbe });

  const debit = await atomicDebitV1({
    giftVoucherId,
    redemptionId: redemption._id,
    operationId,
    reservationKey,
    amountCents,
    currency,
    now,
    requireUnmarked: true
  });

  if (!debit.ok) {
    await voidPendingDebitV1({
      redemptionId: redemption._id,
      reason: debit.code || 'reserve_failed',
      now
    });
    throw buildStructuredError(debit.code || 'RESERVE_FAILED', {
      redemptionId: String(redemption._id),
      giftVoucherId: String(giftVoucherId),
      amountCents
    });
  }

  if (redemption.status === 'pending_debit') {
    const cas = await GiftVoucherRedemption.findOneAndUpdate(
      {
        _id: redemption._id,
        ledgerProtocolVersion: LEDGER_PROTOCOL_VERSION_V1,
        status: 'pending_debit',
        operationId,
        reservationKey,
        amountAppliedCents: amountCents,
        currency,
        $and: [unmarkedMarkerClause(ATTEMPT_MARKER_FIELD)]
      },
      { $set: { status: 'reserved', reservedAt: now } },
      { new: true }
    );
    if (!cas) {
      const latest = await GiftVoucherRedemption.findById(redemption._id).lean();
      if (hasAcquisitionMarker(latest?.[ATTEMPT_MARKER_FIELD])) {
        throw buildStructuredError(VOUCHER_RESERVATION_IN_PROGRESS, {
          reason: 'tokenless_reserved_cas_blocked_marked_redemption',
          redemptionId: String(redemption._id)
        });
      }
      if (!latest || latest.status !== 'reserved') {
        throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
          reason: 'pending_to_reserved_cas_failed',
          redemptionId: String(redemption._id),
          status: latest?.status
        });
      }
      redemption = latest;
    } else {
      redemption = cas;
    }
  }

  const eventResult = await writeOrRepairLedgerEvent({
    giftVoucherId,
    type: 'redeemed_reserved',
    operationId,
    redemptionId: redemption._id,
    actor,
    note,
    previousBalanceCents: debit.previousBalanceCents,
    newBalanceCents: debit.newBalanceCents,
    deltaCents: -amountCents
  });

  return {
    ok: true,
    protocolVersion: LEDGER_PROTOCOL_VERSION_V1,
    idempotentReplay: Boolean(debit.alreadyApplied) || redemption.status === 'reserved',
    redemptionId: String(redemption._id),
    giftVoucherId: String(giftVoucherId),
    operationId,
    reservationKey,
    amountAppliedCents: amountCents,
    previousBalanceCents: debit.previousBalanceCents,
    newBalanceCents: debit.newBalanceCents,
    event: eventResult
  };
}

/**
 * B8F2B1A v1 reserve: create-before-debit with amount-bound voucher ops.
 * Requires non-empty reservationKey (keyless callers must use legacy reserveVoucherAmount).
 */
async function reserveVoucherAmountV1({
  giftVoucherId,
  amountCents,
  currency = 'EUR',
  reservationKey,
  checkoutId = null,
  expiresAt,
  actor = 'system',
  note = 'reserve voucher amount v1',
  now = new Date()
} = {}) {
  await assertVoucherLedgerAuthoritativeIndexes();

  const scanNow = toNow(now);
  assertIntegerCents(amountCents, 'amountCents');
  if (!isSafePositiveIntegerCents(amountCents)) {
    throw buildStructuredError('INVALID_RESERVE_AMOUNT', { amountCents });
  }
  if (currency !== 'EUR') {
    throw buildStructuredError('VOUCHER_CURRENCY_MISMATCH', { currency });
  }
  if (typeof reservationKey !== 'string' || !reservationKey.trim()) {
    throw buildStructuredError('RESERVATION_KEY_REQUIRED', {
      message: 'v1 reserve requires a stable non-empty reservationKey'
    });
  }
  const normalizedKey = reservationKey.trim();
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(expiry.getTime()) || expiry <= scanNow) {
    throw buildStructuredError('INVALID_REDEMPTION_EXPIRY', {
      expiresAt: expiresAt == null ? null : String(expiresAt)
    });
  }
  if (!giftVoucherId) {
    throw buildStructuredError('VOUCHER_NOT_FOUND', { giftVoucherId });
  }

  const expected = {
    giftVoucherId,
    amountCents,
    currency,
    reservationKey: normalizedKey,
    checkoutId: checkoutId != null ? String(checkoutId) : null
  };

  let existing = await GiftVoucherRedemption.findOne({
    ledgerProtocolVersion: LEDGER_PROTOCOL_VERSION_V1,
    reservationKey: normalizedKey
  });

  if (existing) {
    if (existing.status === 'released' || existing.status === 'confirmed' || existing.status === 'voided') {
      throw buildStructuredError('VOUCHER_RESERVATION_KEY_TERMINAL', {
        redemptionId: String(existing._id),
        status: existing.status,
        reservationKey: normalizedKey,
        message: 'permanent reservationKey already used; create a new key for a new reservation'
      });
    }

    assertV1RedemptionIdentity(existing, expected);

    if (existing.status === 'reserved') {
      assertV1OperationIdPresent(existing);
      const voucher = await GiftVoucher.findById(giftVoucherId).lean();
      const op = findEmbeddedOperation(voucher, {
        operationId: existing.operationId,
        redemptionId: existing._id
      });
      assertOperationIdentityMatch(op, {
        operationId: existing.operationId,
        redemptionId: existing._id,
        reservationKey: normalizedKey,
        amountCents,
        currency
      });
      assertTokenlessDualUnmarked({ redemption: existing, operation: op });
      if (op.state !== 'debited') {
        throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
          reason: 'reserved_without_debited_operation',
          operationId: existing.operationId,
          state: op.state
        });
      }
      const eventResult = await writeOrRepairLedgerEvent({
        giftVoucherId,
        type: 'redeemed_reserved',
        operationId: existing.operationId,
        redemptionId: existing._id,
        actor,
        note,
        previousBalanceCents: voucher.balanceRemainingCents + amountCents,
        newBalanceCents: voucher.balanceRemainingCents,
        deltaCents: -amountCents
      });
      return {
        ok: true,
        protocolVersion: LEDGER_PROTOCOL_VERSION_V1,
        idempotentReplay: true,
        redemptionId: String(existing._id),
        giftVoucherId: String(giftVoucherId),
        operationId: existing.operationId,
        reservationKey: normalizedKey,
        amountAppliedCents: amountCents,
        previousBalanceCents: voucher.balanceRemainingCents + amountCents,
        newBalanceCents: voucher.balanceRemainingCents,
        event: eventResult
      };
    }

    if (existing.status === 'pending_debit') {
      assertV1OperationIdPresent(existing);
      const voucherPending = await GiftVoucher.findById(giftVoucherId).lean();
      const opPending = findEmbeddedOperation(voucherPending, {
        operationId: existing.operationId,
        redemptionId: existing._id
      });
      assertTokenlessDualUnmarked({ redemption: existing, operation: opPending });
      return resumeV1AfterPendingOrReserved({
        redemption: existing,
        giftVoucherId,
        amountCents,
        currency,
        reservationKey: normalizedKey,
        actor,
        note,
        now: scanNow
      });
    }

    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'unexpected_redemption_status',
      status: existing.status,
      redemptionId: String(existing._id)
    });
  }

  const redemptionId = new mongoose.Types.ObjectId();
  const operationId = buildOperationId(redemptionId);

  let created;
  try {
    created = await GiftVoucherRedemption.create({
      _id: redemptionId,
      giftVoucherId,
      checkoutId: expected.checkoutId,
      reservationKey: normalizedKey,
      amountAppliedCents: amountCents,
      currency,
      ledgerProtocolVersion: LEDGER_PROTOCOL_VERSION_V1,
      status: 'pending_debit',
      expiresAt: expiry,
      reservedAt: scanNow,
      operationId
    });
  } catch (err) {
    if (err?.code === 11000) {
      existing = await GiftVoucherRedemption.findOne({
        ledgerProtocolVersion: LEDGER_PROTOCOL_VERSION_V1,
        reservationKey: normalizedKey
      });
      if (existing) {
        if (
          existing.status === 'released' ||
          existing.status === 'confirmed' ||
          existing.status === 'voided'
        ) {
          throw buildStructuredError('VOUCHER_RESERVATION_KEY_TERMINAL', {
            redemptionId: String(existing._id),
            status: existing.status,
            reservationKey: normalizedKey
          });
        }
        assertV1RedemptionIdentity(existing, expected);
        assertV1OperationIdPresent(existing);
        if (existing.status === 'pending_debit' || existing.status === 'reserved') {
          const voucherDup = await GiftVoucher.findById(giftVoucherId).lean();
          const opDup = findEmbeddedOperation(voucherDup, {
            operationId: existing.operationId,
            redemptionId: existing._id
          });
          assertTokenlessDualUnmarked({ redemption: existing, operation: opDup });
          return resumeV1AfterPendingOrReserved({
            redemption: existing,
            giftVoucherId,
            amountCents,
            currency,
            reservationKey: normalizedKey,
            actor,
            note,
            now: scanNow
          });
        }
        throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
          reason: 'unexpected_redemption_status_after_duplicate_key',
          status: existing.status,
          redemptionId: String(existing._id)
        });
      }
      if (expected.checkoutId) {
        throw buildStructuredError('VOUCHER_LIVE_CHECKOUT_CONFLICT', {
          checkoutId: expected.checkoutId,
          cause: err.message
        });
      }
    }
    throw err;
  }

  if (typeof afterV1PendingCreateHook === 'function') {
    await afterV1PendingCreateHook({
      redemption: created.toObject ? created.toObject() : created,
      reservationKey: normalizedKey,
      operationId,
      giftVoucherId: String(giftVoucherId),
      checkoutId: expected.checkoutId,
      amountCents,
      currency
    });
  }

  return resumeV1AfterPendingOrReserved({
    redemption: created,
    giftVoucherId,
    amountCents,
    currency,
    reservationKey: normalizedKey,
    actor,
    note,
    now: scanNow
  });
}

async function releaseVoucherRedemptionV1({
  redemptionId,
  reason = 'released',
  actor = 'system',
  note = 'release voucher redemption v1',
  now = new Date()
} = {}) {
  await assertVoucherLedgerAuthoritativeIndexes();
  const scanNow = toNow(now);

  const existing = await GiftVoucherRedemption.findById(redemptionId);
  if (!existing) {
    throw buildStructuredError('REDEMPTION_NOT_FOUND', { redemptionId: String(redemptionId) });
  }
  if (!isV1Redemption(existing)) {
    throw buildStructuredError(VOUCHER_LEDGER_PROTOCOL_MISMATCH, {
      reason: 'legacy_redemption_use_legacy_release',
      redemptionId: String(existing._id)
    });
  }
  assertV1OperationIdPresent(existing);

  const identity = {
    operationId: existing.operationId,
    redemptionId: existing._id,
    reservationKey: existing.reservationKey,
    amountCents: existing.amountAppliedCents,
    currency: existing.currency
  };

  const voucherForMarkers = await GiftVoucher.findById(existing.giftVoucherId).lean();
  const opForMarkers = findEmbeddedOperation(voucherForMarkers, {
    operationId: existing.operationId,
    redemptionId: existing._id
  });
  assertTokenlessDualUnmarked({ redemption: existing, operation: opForMarkers });

  if (existing.status === 'confirmed') {
    throw buildStructuredError('INVALID_REDEMPTION_STATUS', {
      status: 'confirmed',
      redemptionId: String(existing._id)
    });
  }

  if (existing.status === 'voided') {
    return {
      ok: true,
      alreadyReleased: true,
      voided: true,
      redemptionId: String(existing._id),
      protocolVersion: LEDGER_PROTOCOL_VERSION_V1
    };
  }

  if (existing.status === 'released') {
    const restore = await atomicRestoreV1({
      giftVoucherId: existing.giftVoucherId,
      ...identity,
      now: scanNow,
      requireUnmarked: true
    });
    const eventResult = await writeOrRepairLedgerEvent({
      giftVoucherId: existing.giftVoucherId,
      type: 'redeemed_released',
      operationId: identity.operationId,
      redemptionId: existing._id,
      actor,
      note,
      previousBalanceCents: restore.previousBalanceCents,
      newBalanceCents: restore.newBalanceCents,
      deltaCents: restore.amountCents
    });
    return {
      ok: true,
      alreadyReleased: true,
      redemptionId: String(existing._id),
      protocolVersion: LEDGER_PROTOCOL_VERSION_V1,
      restore,
      event: eventResult
    };
  }

  if (existing.status === 'pending_debit') {
    const voucher = voucherForMarkers;
    const op = opForMarkers;
    if (!op) {
      const voided = await voidPendingDebitV1({
        redemptionId: existing._id,
        reason: reason || 'pending_void',
        now: scanNow
      });
      return {
        ok: true,
        voided: true,
        redemptionId: String(existing._id),
        status: voided?.status || 'voided',
        protocolVersion: LEDGER_PROTOCOL_VERSION_V1
      };
    }
    assertOperationIdentityMatch(op, identity);
    if (op.state === 'restored') {
      await GiftVoucherRedemption.updateOne(
        {
          _id: existing._id,
          status: 'pending_debit',
          $and: [unmarkedMarkerClause(ATTEMPT_MARKER_FIELD)]
        },
        { $set: { status: 'released', releasedAt: scanNow, reason: String(reason || '').trim() || 'released' } }
      );
      return {
        ok: true,
        alreadyReleased: true,
        redemptionId: String(existing._id),
        protocolVersion: LEDGER_PROTOCOL_VERSION_V1
      };
    }
    if (op.state === 'pending' || op.state === 'voided') {
      throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
        reason: 'tokenless_release_unexpected_op_state',
        state: op.state,
        operationId: identity.operationId
      });
    }
    // debited pending → treat as release recovery
    await GiftVoucherRedemption.updateOne(
      {
        _id: existing._id,
        status: 'pending_debit',
        $and: [unmarkedMarkerClause(ATTEMPT_MARKER_FIELD)]
      },
      {
        $set: {
          status: 'released',
          releasedAt: scanNow,
          reason: String(reason || '').trim() || 'released'
        }
      }
    );
  } else if (existing.status === 'reserved') {
    const transition = await GiftVoucherRedemption.updateOne(
      {
        _id: existing._id,
        ledgerProtocolVersion: LEDGER_PROTOCOL_VERSION_V1,
        status: 'reserved',
        $and: [unmarkedMarkerClause(ATTEMPT_MARKER_FIELD)]
      },
      {
        $set: {
          status: 'released',
          releasedAt: scanNow,
          reason: String(reason || '').trim() || 'released'
        }
      }
    );
    if (transition.modifiedCount === 0) {
      const latest = await GiftVoucherRedemption.findById(existing._id).lean();
      if (latest?.status === 'confirmed') {
        throw buildStructuredError('INVALID_REDEMPTION_STATUS', {
          status: 'confirmed',
          redemptionId: String(existing._id)
        });
      }
      if (hasAcquisitionMarker(latest?.[ATTEMPT_MARKER_FIELD])) {
        throw buildStructuredError(VOUCHER_RESERVATION_IN_PROGRESS, {
          reason: 'release_blocked_marked_redemption',
          redemptionId: String(existing._id)
        });
      }
      if (latest?.status !== 'released') {
        throw buildStructuredError('REDEMPTION_RELEASE_RACE_FAILED', {
          redemptionId: String(existing._id),
          status: latest?.status
        });
      }
    }
  } else {
    throw buildStructuredError('INVALID_REDEMPTION_STATUS', {
      status: existing.status,
      redemptionId: String(existing._id)
    });
  }

  const restore = await atomicRestoreV1({
    giftVoucherId: existing.giftVoucherId,
    ...identity,
    now: scanNow,
    requireUnmarked: true
  });
  const eventResult = await writeOrRepairLedgerEvent({
    giftVoucherId: existing.giftVoucherId,
    type: 'redeemed_released',
    operationId: identity.operationId,
    redemptionId: existing._id,
    actor,
    note,
    previousBalanceCents: restore.previousBalanceCents,
    newBalanceCents: restore.newBalanceCents,
    deltaCents: restore.amountCents
  });

  return {
    ok: true,
    alreadyReleased: false,
    redemptionId: String(existing._id),
    protocolVersion: LEDGER_PROTOCOL_VERSION_V1,
    restore,
    event: eventResult
  };
}

async function confirmVoucherRedemptionV1({
  redemptionId,
  actor = 'system',
  note = 'confirm voucher redemption v1',
  now = new Date()
} = {}) {
  await assertVoucherLedgerAuthoritativeIndexes();
  const scanNow = toNow(now);

  const existing = await GiftVoucherRedemption.findById(redemptionId);
  if (!existing) {
    throw buildStructuredError('REDEMPTION_NOT_FOUND', { redemptionId: String(redemptionId) });
  }
  if (!isV1Redemption(existing)) {
    throw buildStructuredError(VOUCHER_LEDGER_PROTOCOL_MISMATCH, {
      reason: 'legacy_redemption_use_legacy_confirm',
      redemptionId: String(existing._id)
    });
  }
  assertV1OperationIdPresent(existing);

  const voucher = await GiftVoucher.findById(existing.giftVoucherId);
  if (!voucher) {
    throw buildStructuredError('VOUCHER_NOT_FOUND', {
      giftVoucherId: String(existing.giftVoucherId)
    });
  }

  const identity = {
    operationId: existing.operationId,
    redemptionId: existing._id,
    reservationKey: existing.reservationKey,
    amountCents: existing.amountAppliedCents,
    currency: existing.currency
  };

  const op = findEmbeddedOperation(voucher, identity);
  assertOperationIdentityMatch(op, identity);
  assertTokenlessDualUnmarked({ redemption: existing, operation: op });

  if (existing.status === 'confirmed') {
    if (op.state !== 'debited') {
      throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
        reason: 'confirmed_requires_debited_operation',
        state: op.state
      });
    }
    const eventResult = await writeOrRepairLedgerEvent({
      giftVoucherId: voucher._id,
      type: 'redeemed_confirmed',
      operationId: identity.operationId,
      redemptionId: existing._id,
      actor,
      note,
      previousBalanceCents: voucher.balanceRemainingCents,
      newBalanceCents: voucher.balanceRemainingCents,
      deltaCents: 0
    });
    return {
      ok: true,
      alreadyConfirmed: true,
      redemptionId: String(existing._id),
      protocolVersion: LEDGER_PROTOCOL_VERSION_V1,
      balanceRemainingCents: voucher.balanceRemainingCents,
      event: eventResult
    };
  }

  if (existing.status !== 'reserved') {
    throw buildStructuredError('INVALID_REDEMPTION_STATUS', {
      status: existing.status,
      redemptionId: String(existing._id)
    });
  }
  if (op.state !== 'debited') {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'confirm_requires_debited_not_restored',
      state: op.state
    });
  }

  if (typeof beforeV1ConfirmCasHook === 'function') {
    await beforeV1ConfirmCasHook({
      redemptionId: String(existing._id),
      operationId: identity.operationId,
      giftVoucherId: String(existing.giftVoucherId)
    });
  }

  const balanceBefore = voucher.balanceRemainingCents;
  const transition = await GiftVoucherRedemption.updateOne(
    {
      _id: existing._id,
      ledgerProtocolVersion: LEDGER_PROTOCOL_VERSION_V1,
      status: 'reserved',
      $and: [unmarkedMarkerClause(ATTEMPT_MARKER_FIELD)]
    },
    { $set: { status: 'confirmed', confirmedAt: scanNow } }
  );
  if (transition.modifiedCount === 0) {
    const latest = await GiftVoucherRedemption.findById(existing._id).lean();
    const latestVoucher = await GiftVoucher.findById(existing.giftVoucherId).lean();
    const latestOp = findEmbeddedOperation(latestVoucher, {
      operationId: identity.operationId,
      redemptionId: existing._id
    });
    if (
      hasAcquisitionMarker(latest?.[ATTEMPT_MARKER_FIELD]) ||
      hasAcquisitionMarker(latestOp?.[ATTEMPT_MARKER_FIELD])
    ) {
      throw buildStructuredError(VOUCHER_RESERVATION_IN_PROGRESS, {
        reason: 'confirm_cas_blocked_marked_authority',
        redemptionId: String(existing._id),
        redemptionMarker: markerString(latest?.[ATTEMPT_MARKER_FIELD]),
        operationMarker: markerString(latestOp?.[ATTEMPT_MARKER_FIELD])
      });
    }
    if (latest?.status === 'released') {
      throw buildStructuredError('INVALID_REDEMPTION_STATUS', {
        status: 'released',
        redemptionId: String(existing._id)
      });
    }
    if (latest?.status !== 'confirmed') {
      throw buildStructuredError('REDEMPTION_CONFIRM_RACE_FAILED', {
        redemptionId: String(existing._id),
        status: latest?.status
      });
    }
  }

  const voucherAfter = await GiftVoucher.findById(existing.giftVoucherId);
  if (!voucherAfter) {
    throw buildStructuredError('VOUCHER_NOT_FOUND', {
      giftVoucherId: String(existing.giftVoucherId)
    });
  }
  if (Number(voucherAfter.balanceRemainingCents) !== Number(balanceBefore)) {
    throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
      reason: 'confirm_changed_balance',
      before: balanceBefore,
      after: voucherAfter.balanceRemainingCents
    });
  }

  const nextStatus =
    voucherAfter.balanceRemainingCents === 0 ? 'redeemed' : 'partially_redeemed';
  await GiftVoucher.updateOne({ _id: voucherAfter._id }, { $set: { status: nextStatus } });

  const eventResult = await writeOrRepairLedgerEvent({
    giftVoucherId: voucherAfter._id,
    type: 'redeemed_confirmed',
    operationId: identity.operationId,
    redemptionId: existing._id,
    actor,
    note,
    previousBalanceCents: voucherAfter.balanceRemainingCents,
    newBalanceCents: voucherAfter.balanceRemainingCents,
    deltaCents: 0
  });

  return {
    ok: true,
    alreadyConfirmed: false,
    redemptionId: String(existing._id),
    protocolVersion: LEDGER_PROTOCOL_VERSION_V1,
    balanceRemainingCents: voucherAfter.balanceRemainingCents,
    event: eventResult
  };
}

async function recoverVoucherRedemptionV1({
  redemptionId,
  actor = 'system',
  note = 'recover voucher redemption v1',
  now = new Date()
} = {}) {
  await assertVoucherLedgerAuthoritativeIndexes();
  const scanNow = toNow(now);
  const existing = await GiftVoucherRedemption.findById(redemptionId);
  if (!existing) {
    throw buildStructuredError('REDEMPTION_NOT_FOUND', { redemptionId: String(redemptionId) });
  }
  if (!isV1Redemption(existing)) {
    throw buildStructuredError(VOUCHER_LEDGER_PROTOCOL_MISMATCH, {
      reason: 'legacy_redemption_no_v1_recover',
      redemptionId: String(existing._id)
    });
  }
  assertV1OperationIdPresent(existing);

  const voucherProbe = await GiftVoucher.findById(existing.giftVoucherId).lean();
  const opProbe = findEmbeddedOperation(voucherProbe, {
    operationId: existing.operationId,
    redemptionId: existing._id
  });
  assertTokenlessDualUnmarked({ redemption: existing, operation: opProbe });

  if (existing.status === 'pending_debit' || existing.status === 'reserved') {
    if (existing.expiresAt && toNow(existing.expiresAt) <= scanNow) {
      return releaseVoucherRedemptionV1({
        redemptionId: existing._id,
        reason: 'expired_hold',
        actor,
        note,
        now: scanNow
      });
    }
    if (existing.status === 'pending_debit') {
      return reserveVoucherAmountV1({
        giftVoucherId: existing.giftVoucherId,
        amountCents: existing.amountAppliedCents,
        currency: existing.currency,
        reservationKey: existing.reservationKey,
        checkoutId: existing.checkoutId,
        expiresAt: existing.expiresAt,
        actor,
        note,
        now: scanNow
      });
    }

    // reserved + unexpired: prove debited op and repair reserve event only
    const voucher = await GiftVoucher.findById(existing.giftVoucherId).lean();
    const op = findEmbeddedOperation(voucher, {
      operationId: existing.operationId,
      redemptionId: existing._id
    });
    assertOperationIdentityMatch(op, {
      operationId: existing.operationId,
      redemptionId: existing._id,
      reservationKey: existing.reservationKey,
      amountCents: existing.amountAppliedCents,
      currency: existing.currency
    });
    if (op.state !== 'debited') {
      throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
        reason: 'reserved_recovery_requires_debited',
        state: op.state
      });
    }
    const eventResult = await writeOrRepairLedgerEvent({
      giftVoucherId: existing.giftVoucherId,
      type: 'redeemed_reserved',
      operationId: existing.operationId,
      redemptionId: existing._id,
      actor,
      note,
      previousBalanceCents: voucher.balanceRemainingCents + existing.amountAppliedCents,
      newBalanceCents: voucher.balanceRemainingCents,
      deltaCents: -existing.amountAppliedCents
    });
    return {
      ok: true,
      recovered: true,
      status: 'reserved',
      redemptionId: String(existing._id),
      event: eventResult
    };
  }

  if (existing.status === 'released') {
    return releaseVoucherRedemptionV1({
      redemptionId: existing._id,
      reason: existing.reason || 'released',
      actor,
      note,
      now: scanNow
    });
  }

  if (existing.status === 'confirmed') {
    return confirmVoucherRedemptionV1({
      redemptionId: existing._id,
      actor,
      note,
      now: scanNow
    });
  }

  return {
    ok: true,
    recovered: false,
    status: existing.status,
    redemptionId: String(existing._id)
  };
}

async function expireVoucherRedemptionsV1({
  now = new Date(),
  limit = 25,
  actor = 'system'
} = {}) {
  await assertVoucherLedgerAuthoritativeIndexes();
  const scanNow = toNow(now);
  const stale = await GiftVoucherRedemption.find({
    ledgerProtocolVersion: LEDGER_PROTOCOL_VERSION_V1,
    status: { $in: ['pending_debit', 'reserved'] },
    expiresAt: { $lte: scanNow }
  })
    .sort({ expiresAt: 1 })
    .limit(Math.max(1, Number(limit) || 25))
    .lean();

  const summary = {
    scanned: stale.length,
    voided: 0,
    released: 0,
    alreadyTerminal: 0,
    failed: 0,
    failures: []
  };

  for (const item of stale) {
    try {
      const voucher = await GiftVoucher.findById(item.giftVoucherId).lean();
      const op = findEmbeddedOperation(voucher, {
        operationId: item.operationId,
        redemptionId: item._id
      });
      const identity = {
        operationId: item.operationId,
        redemptionId: item._id,
        reservationKey: item.reservationKey,
        amountCents: item.amountAppliedCents,
        currency: item.currency
      };

      const isMarked =
        hasAcquisitionMarker(item[ATTEMPT_MARKER_FIELD]) ||
        (op && hasAcquisitionMarker(op[ATTEMPT_MARKER_FIELD]));

      if (item.status === 'pending_debit' && !op) {
        await voidPendingDebitV1({
          redemptionId: item._id,
          reason: 'expired_pending_no_debit',
          now: scanNow
        });
        summary.voided += 1;
        continue;
      }

      if (op && op.state === 'pending') {
        await voidPendingLedgerOperationV1({
          giftVoucherId: item.giftVoucherId,
          redemptionId: item._id,
          operationId: item.operationId,
          systemExpiry: true,
          now: scanNow
        });
        await GiftVoucherRedemption.updateOne(
          {
            _id: item._id,
            status: { $in: ['pending_debit', 'reserved'] },
            expiresAt: { $lte: scanNow }
          },
          {
            $set: {
              status: 'voided',
              releasedAt: scanNow,
              reason: 'expired_pending_operation_voided',
              [ATTEMPT_MARKER_FIELD]: null
            }
          }
        );
        summary.voided += 1;
        continue;
      }

      if (op && op.state === 'voided') {
        await GiftVoucherRedemption.updateOne(
          {
            _id: item._id,
            status: { $in: ['pending_debit', 'reserved'] },
            expiresAt: { $lte: scanNow }
          },
          {
            $set: {
              status: 'voided',
              releasedAt: scanNow,
              reason: 'expired_already_voided_operation',
              [ATTEMPT_MARKER_FIELD]: null
            }
          }
        );
        summary.voided += 1;
        continue;
      }

      if (op && op.state === 'restored') {
        await GiftVoucherRedemption.updateOne(
          {
            _id: item._id,
            status: { $in: ['pending_debit', 'reserved'] },
            expiresAt: { $lte: scanNow }
          },
          {
            $set: {
              status: 'released',
              releasedAt: scanNow,
              reason: 'expired_already_restored',
              [ATTEMPT_MARKER_FIELD]: null
            }
          }
        );
        summary.alreadyTerminal += 1;
        continue;
      }

      if (op && Number(op.amountCents) !== Number(item.amountAppliedCents)) {
        throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
          reason: 'expiry_amount_mismatch',
          redemptionId: String(item._id)
        });
      }

      if (op && op.state === 'debited') {
        assertOperationIdentityMatch(op, identity);
        await GiftVoucherRedemption.updateOne(
          {
            _id: item._id,
            status: { $in: ['pending_debit', 'reserved'] },
            expiresAt: { $lte: scanNow }
          },
          {
            $set: {
              status: 'released',
              releasedAt: scanNow,
              reason: 'expired_hold',
              [ATTEMPT_MARKER_FIELD]: null
            }
          }
        );
        const restore = await atomicRestoreV1({
          giftVoucherId: item.giftVoucherId,
          ...identity,
          now: scanNow,
          systemExpiry: true,
          clearMarker: true
        });
        await writeOrRepairLedgerEvent({
          giftVoucherId: item.giftVoucherId,
          type: 'redeemed_released',
          operationId: identity.operationId,
          redemptionId: item._id,
          actor,
          note: 'expire v1 voucher redemption',
          previousBalanceCents: restore.previousBalanceCents,
          newBalanceCents: restore.newBalanceCents,
          deltaCents: restore.amountCents
        });
        summary.released += 1;
        continue;
      }

      if (!isMarked) {
        const result = await releaseVoucherRedemptionV1({
          redemptionId: item._id,
          reason: 'expired_hold',
          actor,
          note: 'expire v1 voucher redemption',
          now: scanNow
        });
        if (result.voided) summary.voided += 1;
        else if (result.alreadyReleased) summary.alreadyTerminal += 1;
        else summary.released += 1;
        continue;
      }

      throw buildStructuredError(VOUCHER_LEDGER_INTEGRITY, {
        reason: 'expiry_unhandled_state',
        redemptionId: String(item._id),
        status: item.status,
        opState: op?.state
      });
    } catch (err) {
      summary.failed += 1;
      summary.failures.push({
        redemptionId: String(item._id),
        code: err.code || 'EXPIRE_FAILED',
        message: err.message
      });
    }
  }

  return summary;
}

/* ----------------------------- Legacy path ----------------------------- */

async function reserveVoucherAmount({
  giftVoucherId,
  amountToReserveCents,
  bookingId = null,
  reservationId = null,
  holdExpiresAt = null,
  actor = 'system',
  note = 'reserve voucher amount'
}) {
  assertIntegerCents(amountToReserveCents, 'amountToReserveCents');
  if (amountToReserveCents <= 0) {
    const err = new Error('amountToReserveCents must be greater than zero');
    err.code = 'INVALID_RESERVE_AMOUNT';
    throw err;
  }

  const now = new Date();
  const voucher = await GiftVoucher.findOneAndUpdate(
    {
      _id: giftVoucherId,
      status: { $in: ['active', 'partially_redeemed'] },
      expiresAt: { $gt: now },
      balanceRemainingCents: { $gte: amountToReserveCents }
    },
    {
      $inc: { balanceRemainingCents: -amountToReserveCents },
      $set: { status: 'partially_redeemed' }
    },
    { new: true }
  );

  if (!voucher) {
    const err = new Error('Voucher reserve failed');
    err.code = 'RESERVE_FAILED';
    throw err;
  }

  const previousBalanceCents = voucher.balanceRemainingCents + amountToReserveCents;
  const newBalanceCents = voucher.balanceRemainingCents;
  let redemption;

  try {
    redemption = await GiftVoucherRedemption.create({
      giftVoucherId: voucher._id,
      bookingId,
      reservationId,
      amountAppliedCents: amountToReserveCents,
      status: 'reserved',
      reservedAt: now,
      expiresAt: holdExpiresAt || null
      // ledgerProtocolVersion intentionally absent/null → legacy
    });
  } catch (error) {
    const compensation = { compensationAttempted: true, compensationSucceeded: false };
    try {
      const restored = await GiftVoucher.findByIdAndUpdate(
        voucher._id,
        { $inc: { balanceRemainingCents: amountToReserveCents } },
        { new: true }
      );
      if (restored) {
        const restoredStatus = statusFromBalance(
          restored.balanceRemainingCents,
          restored.amountOriginalCents
        );
        await GiftVoucher.updateOne(
          { _id: restored._id },
          { $set: { status: restoredStatus } }
        );
        compensation.compensationSucceeded = true;
      }
    } catch (compensationError) {
      compensation.compensationError = compensationError.message;
    }

    return {
      ok: false,
      code: 'RESERVE_REDEMPTION_CREATE_FAILED',
      compensationAttempted: compensation.compensationAttempted,
      compensationSucceeded: compensation.compensationSucceeded,
      voucherId: String(voucher._id),
      amountAppliedCents: amountToReserveCents
    };
  }

  try {
    await giftVoucherEventService.appendFinancialVoucherEvent({
      giftVoucherId: voucher._id,
      type: 'redeemed_reserved',
      actor,
      note,
      previousBalanceCents,
      newBalanceCents,
      deltaCents: -amountToReserveCents,
      metadata: {
        redemptionId: String(redemption._id),
        bookingId: bookingId ? String(bookingId) : null,
        reservationId: reservationId ? String(reservationId) : null
      }
    });
  } catch (eventErr) {
    throw buildStructuredError('RESERVE_EVENT_WRITE_FAILED', {
      voucherId: String(voucher._id),
      redemptionId: String(redemption._id),
      amountAppliedCents: amountToReserveCents,
      cause: eventErr.message
    });
  }

  return {
    ok: true,
    voucherId: String(voucher._id),
    redemptionId: String(redemption._id),
    amountAppliedCents: amountToReserveCents,
    previousBalanceCents,
    newBalanceCents
  };
}

async function confirmReservedRedemption({
  redemptionId,
  actor = 'system',
  note = 'confirm voucher redemption'
}) {
  const existing = await GiftVoucherRedemption.findById(redemptionId);
  if (!existing) {
    const err = new Error('Redemption not found');
    err.code = 'REDEMPTION_NOT_FOUND';
    throw err;
  }
  if (isV1Redemption(existing)) {
    throw buildStructuredError(VOUCHER_LEDGER_PROTOCOL_MISMATCH, {
      reason: 'v1_redemption_use_confirmVoucherRedemptionV1',
      redemptionId: String(existing._id)
    });
  }
  if (existing.status === 'confirmed') {
    const eventExists = await hasRedemptionEvent({
      giftVoucherId: existing.giftVoucherId,
      redemptionId: existing._id,
      type: 'redeemed_confirmed'
    });
    if (eventExists) {
      return { ok: true, alreadyConfirmed: true, redemptionId: String(existing._id) };
    }
    const voucherForRecovery = await GiftVoucher.findById(existing.giftVoucherId);
    if (!voucherForRecovery) {
      const err = new Error('GiftVoucher not found for redemption');
      err.code = 'VOUCHER_NOT_FOUND';
      throw err;
    }
    await giftVoucherEventService.appendFinancialVoucherEvent({
      giftVoucherId: voucherForRecovery._id,
      type: 'redeemed_confirmed',
      actor,
      note,
      previousBalanceCents: voucherForRecovery.balanceRemainingCents,
      newBalanceCents: voucherForRecovery.balanceRemainingCents,
      deltaCents: 0,
      metadata: { redemptionId: String(existing._id), recovered: true }
    });
    return {
      ok: true,
      alreadyConfirmed: true,
      eventRecovered: true,
      redemptionId: String(existing._id)
    };
  }
  if (existing.status !== 'reserved') {
    const err = new Error(`Cannot confirm redemption in status ${existing.status}`);
    err.code = 'INVALID_REDEMPTION_STATUS';
    throw err;
  }

  const now = new Date();
  const transition = await GiftVoucherRedemption.updateOne(
    { _id: existing._id, status: 'reserved' },
    { $set: { status: 'confirmed', confirmedAt: now } }
  );
  if (transition.modifiedCount === 0) {
    const latest = await GiftVoucherRedemption.findById(existing._id).lean();
    if (latest?.status === 'confirmed') {
      const eventExists = await hasRedemptionEvent({
        giftVoucherId: existing.giftVoucherId,
        redemptionId: existing._id,
        type: 'redeemed_confirmed'
      });
      if (eventExists) {
        return { ok: true, alreadyConfirmed: true, redemptionId: String(existing._id) };
      }
      const voucherForRecovery = await GiftVoucher.findById(existing.giftVoucherId);
      if (!voucherForRecovery) {
        const err = new Error('GiftVoucher not found for redemption');
        err.code = 'VOUCHER_NOT_FOUND';
        throw err;
      }
      await giftVoucherEventService.appendFinancialVoucherEvent({
        giftVoucherId: voucherForRecovery._id,
        type: 'redeemed_confirmed',
        actor,
        note,
        previousBalanceCents: voucherForRecovery.balanceRemainingCents,
        newBalanceCents: voucherForRecovery.balanceRemainingCents,
        deltaCents: 0,
        metadata: { redemptionId: String(existing._id), recovered: true }
      });
      return {
        ok: true,
        alreadyConfirmed: true,
        eventRecovered: true,
        redemptionId: String(existing._id)
      };
    }
    const err = new Error('Redemption confirmation race failed');
    err.code = 'REDEMPTION_CONFIRM_RACE_FAILED';
    throw err;
  }

  const voucher = await GiftVoucher.findById(existing.giftVoucherId);
  if (!voucher) {
    const err = new Error('GiftVoucher not found for redemption');
    err.code = 'VOUCHER_NOT_FOUND';
    throw err;
  }

  const nextStatus = voucher.balanceRemainingCents === 0 ? 'redeemed' : 'partially_redeemed';
  await GiftVoucher.updateOne({ _id: voucher._id }, { $set: { status: nextStatus } });

  await giftVoucherEventService.appendFinancialVoucherEvent({
    giftVoucherId: voucher._id,
    type: 'redeemed_confirmed',
    actor,
    note,
    previousBalanceCents: voucher.balanceRemainingCents,
    newBalanceCents: voucher.balanceRemainingCents,
    deltaCents: 0,
    metadata: { redemptionId: String(existing._id) }
  });

  return { ok: true, alreadyConfirmed: false, redemptionId: String(existing._id) };
}

async function releaseReservedRedemption({
  redemptionId,
  reason = 'released',
  actor = 'system',
  note = 'release voucher redemption'
}) {
  const existing = await GiftVoucherRedemption.findById(redemptionId);
  if (!existing) {
    const err = new Error('Redemption not found');
    err.code = 'REDEMPTION_NOT_FOUND';
    throw err;
  }
  if (isV1Redemption(existing)) {
    throw buildStructuredError(VOUCHER_LEDGER_PROTOCOL_MISMATCH, {
      reason: 'v1_redemption_use_releaseVoucherRedemptionV1',
      redemptionId: String(existing._id)
    });
  }
  if (existing.status === 'released') {
    const eventExists = await hasRedemptionEvent({
      giftVoucherId: existing.giftVoucherId,
      redemptionId: existing._id,
      type: 'redeemed_released'
    });
    if (eventExists) {
      return { ok: true, alreadyReleased: true, redemptionId: String(existing._id) };
    }
    throw buildStructuredError('RELEASE_STATE_INCOMPLETE_REQUIRES_REVIEW', {
      redemptionId: String(existing._id),
      giftVoucherId: String(existing.giftVoucherId),
      amountAppliedCents: existing.amountAppliedCents
    });
  }
  if (existing.status !== 'reserved') {
    const err = new Error(`Cannot release redemption in status ${existing.status}`);
    err.code = 'INVALID_REDEMPTION_STATUS';
    throw err;
  }

  const now = toNow(new Date());
  const transition = await GiftVoucherRedemption.updateOne(
    { _id: existing._id, status: 'reserved' },
    {
      $set: {
        status: 'released',
        releasedAt: now,
        reason: String(reason || '').trim() || 'released'
      }
    }
  );
  if (transition.modifiedCount === 0) {
    const latest = await GiftVoucherRedemption.findById(existing._id).lean();
    if (latest?.status === 'released') {
      return { ok: true, alreadyReleased: true, redemptionId: String(existing._id) };
    }
    const err = new Error('Redemption release race failed');
    err.code = 'REDEMPTION_RELEASE_RACE_FAILED';
    throw err;
  }

  const voucher = await GiftVoucher.findByIdAndUpdate(
    existing.giftVoucherId,
    { $inc: { balanceRemainingCents: existing.amountAppliedCents } },
    { new: true }
  );
  if (!voucher) {
    const err = new Error('GiftVoucher not found for redemption release');
    err.code = 'VOUCHER_NOT_FOUND';
    throw err;
  }

  const previousBalanceCents = voucher.balanceRemainingCents - existing.amountAppliedCents;
  const newBalanceCents = voucher.balanceRemainingCents;
  const nextStatus = statusFromBalance(newBalanceCents, voucher.amountOriginalCents);
  await GiftVoucher.updateOne({ _id: voucher._id }, { $set: { status: nextStatus } });

  await giftVoucherEventService.appendFinancialVoucherEvent({
    giftVoucherId: voucher._id,
    type: 'redeemed_released',
    actor,
    note,
    previousBalanceCents,
    newBalanceCents,
    deltaCents: existing.amountAppliedCents,
    metadata: { redemptionId: String(existing._id) }
  });

  return { ok: true, alreadyReleased: false, redemptionId: String(existing._id) };
}

module.exports = {
  // Legacy
  reserveVoucherAmount,
  confirmReservedRedemption,
  releaseReservedRedemption,
  // B8F2B1A v1
  reserveVoucherAmountV1,
  releaseVoucherRedemptionV1,
  confirmVoucherRedemptionV1,
  recoverVoucherRedemptionV1,
  expireVoucherRedemptionsV1,
  ensureVoucherLedgerIndexesForTests,
  assertVoucherLedgerAuthoritativeIndexes,
  // B8F2B1B marker-aware primitives
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
  assertTokenlessDualUnmarked,
  assertDualAttemptOwnership,
  hasAcquisitionMarker,
  markerString,
  // Constants / helpers for tests
  LEDGER_PROTOCOL_VERSION_V1,
  LEDGER_EVENT_INCOMPLETE,
  VOUCHER_LEDGER_INTEGRITY,
  VOUCHER_LEDGER_PROTOCOL_MISMATCH,
  VOUCHER_LEDGER_INDEX_MISSING,
  VOUCHER_RESERVATION_IN_PROGRESS,
  VOUCHER_ATTEMPT_MARKER_MISMATCH,
  buildOperationId,
  buildLedgerEventKey,
  writeOrRepairLedgerEvent,
  __setAfterV1PendingCreateHookForTests,
  __setAfterV1PendingOpClaimHookForTests,
  __setBeforeV1PendingOpClaimHookForTests,
  __setAfterV1OpMarkerTransferHookForTests,
  __setAfterV1SealPartialClearHookForTests,
  __setAfterV1CompensationPartialHookForTests,
  __setBeforeV1CompensationReleaseCasHookForTests,
  __setBeforeV1SealRedemptionClearHookForTests,
  __setBeforeV1ConfirmCasHookForTests
};

function __invokeCompensationPartialHookForTests(payload) {
  if (typeof afterV1CompensationPartialHook === 'function') {
    return afterV1CompensationPartialHook(payload);
  }
  return null;
}

function __invokeBeforeCompensationReleaseCasHookForTests(payload) {
  if (typeof beforeV1CompensationReleaseCasHook === 'function') {
    return beforeV1CompensationReleaseCasHook(payload);
  }
  return null;
}

module.exports.__invokeCompensationPartialHookForTests = __invokeCompensationPartialHookForTests;
module.exports.__invokeBeforeCompensationReleaseCasHookForTests =
  __invokeBeforeCompensationReleaseCasHookForTests;
