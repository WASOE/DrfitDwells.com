const crypto = require('crypto');
const mongoose = require('mongoose');
const AvailabilityBlock = require('../../models/AvailabilityBlock');
const { normalizeExclusiveDateRange } = require('../../utils/dateTime');
const { canUseMongoTransactions } = require('../../utils/mongoTransactions');

/** Pre-payment hold TTL while guest completes Stripe checkout. */
const DEFAULT_CHECKOUT_HOLD_TTL_MS = 30 * 60 * 1000;

function mintCheckoutSessionId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `loc_chk_${crypto.randomBytes(16).toString('hex')}`;
}

function buildHoldPayloads({ checkoutSessionId, locationKey, startDate, endDate, targets, expiresAt }) {
  return targets.map((target) => ({
    cabinId: target.cabinId,
    unitId: target.unitId || null,
    blockType: 'checkout_hold',
    startDate,
    endDate,
    status: 'active',
    source: 'location_checkout',
    sourceReference: checkoutSessionId,
    checkoutSessionId,
    expiresAt,
    metadata: {
      locationKey,
      targetKey: target.targetKey,
      kind: target.kind
    }
  }));
}

async function tombstoneHoldIds(blockIds, reason) {
  if (!blockIds.length) return;
  await AvailabilityBlock.updateMany(
    { _id: { $in: blockIds }, status: 'active' },
    {
      status: 'tombstoned',
      tombstonedAt: new Date(),
      tombstoneReason: reason
    }
  );
}

async function createCheckoutHolds({
  checkoutSessionId,
  locationKey,
  startDate,
  endDate,
  targets,
  ttlMs = DEFAULT_CHECKOUT_HOLD_TTL_MS
}) {
  const normalized = normalizeExclusiveDateRange(startDate, endDate);
  const expiresAt = new Date(Date.now() + ttlMs);
  const payloads = buildHoldPayloads({
    checkoutSessionId,
    locationKey,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    targets,
    expiresAt
  });

  const createdBlockIds = [];

  if (await canUseMongoTransactions()) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        for (const payload of payloads) {
          const [block] = await AvailabilityBlock.create([payload], { session });
          createdBlockIds.push(block._id);
        }
      });
      return { blockIds: createdBlockIds, expiresAt };
    } catch (err) {
      await tombstoneHoldIds(createdBlockIds, 'location_checkout_hold_create_rollback');
      throw err;
    } finally {
      await session.endSession();
    }
  }

  try {
    for (const payload of payloads) {
      const block = await AvailabilityBlock.create(payload);
      createdBlockIds.push(block._id);
    }
    return { blockIds: createdBlockIds, expiresAt };
  } catch (err) {
    await tombstoneHoldIds(createdBlockIds, 'location_checkout_hold_create_rollback');
    throw err;
  }
}

async function releaseCheckoutHolds(checkoutSessionId, reason = 'location_checkout_hold_released') {
  const result = await AvailabilityBlock.updateMany(
    {
      checkoutSessionId: String(checkoutSessionId),
      blockType: 'checkout_hold',
      status: 'active'
    },
    {
      status: 'tombstoned',
      tombstonedAt: new Date(),
      tombstoneReason: reason
    }
  );
  return result.modifiedCount || 0;
}

async function convertCheckoutHoldsToFinalized(checkoutSessionId) {
  return releaseCheckoutHolds(checkoutSessionId, 'location_checkout_finalized');
}

async function listActiveCheckoutHolds(checkoutSessionId) {
  const now = new Date();
  return AvailabilityBlock.find({
    checkoutSessionId: String(checkoutSessionId),
    blockType: 'checkout_hold',
    status: 'active',
    $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }]
  }).lean();
}

module.exports = {
  DEFAULT_CHECKOUT_HOLD_TTL_MS,
  mintCheckoutSessionId,
  createCheckoutHolds,
  releaseCheckoutHolds,
  convertCheckoutHoldsToFinalized,
  listActiveCheckoutHolds
};
