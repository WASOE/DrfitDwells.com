const crypto = require('crypto');
const mongoose = require('mongoose');
const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const { requirePermission, ACTIONS } = require('../../permissionService');
const { appendAuditEvent } = require('../../auditWriter');
const { normalizeExclusiveDateRange } = require('../../../utils/dateTime');
const { evaluateLocationConflicts } = require('./locationConflictService');
const { resolveLocationTargets } = require('./locationInventoryService');
const { assertAllowedLocationKey } = require('./locationRegistry');
const { createDomainError } = require('./errors');

async function canUseMongoTransactions() {
  try {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {});
      return true;
    } catch {
      return false;
    } finally {
      await session.endSession();
    }
  } catch {
    return false;
  }
}

async function insertLocationBlockGroup(blockPayloads) {
  /** @type {string[]} */
  const createdBlockIds = [];

  if (await canUseMongoTransactions()) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        for (const payload of blockPayloads) {
          const [block] = await AvailabilityBlock.create([payload], { session });
          createdBlockIds.push(String(block._id));
        }
      });
      return createdBlockIds;
    } catch {
      createdBlockIds.length = 0;
    } finally {
      await session.endSession();
    }
  }

  try {
    for (const payload of blockPayloads) {
      const block = await AvailabilityBlock.create(payload);
      createdBlockIds.push(String(block._id));
    }
  } catch (error) {
    if (createdBlockIds.length > 0) {
      await AvailabilityBlock.updateMany(
        { _id: { $in: createdBlockIds }, status: 'active' },
        {
          status: 'tombstoned',
          tombstonedAt: new Date(),
          tombstoneReason: 'location_block_create_rollback'
        }
      );
    }
    throw error;
  }

  return createdBlockIds;
}

function buildLocationBlockMetadata({ locationBlockGroupId, locationKey, targetKey }) {
  return {
    locationBlockGroupId,
    locationKey,
    scope: 'location_wide',
    targetKey
  };
}

async function previewLocationBlock({ locationKey, startDate, endDate }) {
  assertAllowedLocationKey(locationKey);
  return evaluateLocationConflicts(locationKey, startDate, endDate);
}

async function createLocationBlock({
  locationKey,
  startDate,
  endDate,
  blockType = 'manual_block',
  reason = null,
  ctx = {}
}) {
  assertAllowedLocationKey(locationKey);
  if (blockType !== 'manual_block') {
    throw createDomainError('validation', 'Only manual_block is supported for location-wide blocks in v1');
  }

  requirePermission({
    role: ctx.user?.role,
    action: ACTIONS.OPS_AVAILABILITY_MANUAL_BLOCK_CREATE
  });

  const evaluation = await evaluateLocationConflicts(locationKey, startDate, endDate);
  if (!evaluation.canBlock) {
    throw createDomainError(
      'conflict',
      `Cannot create location-wide block: ${evaluation.conflictedTargetCount} propert${evaluation.conflictedTargetCount === 1 ? 'y has' : 'ies have'} overlapping reservations or blocks.`,
      evaluation,
      409
    );
  }

  const inventory = await resolveLocationTargets(locationKey);
  const normalized = normalizeExclusiveDateRange(startDate, endDate);
  const locationBlockGroupId = crypto.randomUUID();
  const blockPayloads = inventory.targets.map((target) => ({
    _id: new mongoose.Types.ObjectId(),
    cabinId: target.cabinId,
    unitId: target.unitId,
    reservationId: null,
    blockType: 'manual_block',
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    source: 'internal_admin',
    sourceReference: locationBlockGroupId,
    importedAt: null,
    confidence: 'high',
    metadata: buildLocationBlockMetadata({
      locationBlockGroupId,
      locationKey,
      targetKey: target.targetKey
    })
  }));

  const createdBlockIds = await insertLocationBlockGroup(blockPayloads);

  await appendAuditEvent(
    {
      actorType: 'user',
      actorId: ctx.user?.id || 'admin',
      entityType: 'AvailabilityBlock',
      entityId: locationBlockGroupId,
      action: 'location_block_group_create',
      beforeSnapshot: null,
      afterSnapshot: {
        locationBlockGroupId,
        locationKey,
        blockType,
        targetCount: createdBlockIds.length,
        blockIds: createdBlockIds
      },
      metadata: {
        startDate: normalized.startDate,
        endDate: normalized.endDate
      },
      reason: reason || null,
      sourceContext: {
        route: ctx.route || null,
        namespace: 'ops'
      }
    },
    { req: ctx.req }
  );

  return {
    locationBlockGroupId,
    locationKey,
    blockType,
    targetCount: createdBlockIds.length,
    blockIds: createdBlockIds,
    startDate: normalized.startDate,
    endDate: normalized.endDate
  };
}

async function removeLocationBlockGroup({ locationBlockGroupId, reason = null, ctx = {} }) {
  const groupId = String(locationBlockGroupId || '').trim();
  if (!groupId) {
    throw createDomainError('validation', 'locationBlockGroupId is required', {}, 400);
  }

  requirePermission({
    role: ctx.user?.role,
    action: ACTIONS.OPS_AVAILABILITY_MANUAL_BLOCK_REMOVE
  });

  const blocks = await AvailabilityBlock.find({
    status: 'active',
    blockType: 'manual_block',
    'metadata.locationBlockGroupId': groupId
  });

  if (blocks.length === 0) {
    throw createDomainError('validation', 'No active location block group found', { locationBlockGroupId: groupId }, 404);
  }

  const now = new Date();
  const tombstoneReason = reason || 'location_block_group_remove';

  for (const block of blocks) {
    await appendAuditEvent(
      {
        actorType: 'user',
        actorId: ctx.user?.id || 'admin',
        entityType: 'AvailabilityBlock',
        entityId: String(block._id),
        action: 'manual_block_tombstone',
        beforeSnapshot: { status: block.status },
        afterSnapshot: { status: 'tombstoned' },
        metadata: { locationBlockGroupId: groupId },
        reason: tombstoneReason,
        sourceContext: {
          route: ctx.route || null,
          namespace: 'ops'
        }
      },
      { req: ctx.req }
    );

    block.status = 'tombstoned';
    block.tombstonedAt = now;
    block.tombstoneReason = tombstoneReason;
    await block.save();
  }

  await appendAuditEvent(
    {
      actorType: 'user',
      actorId: ctx.user?.id || 'admin',
      entityType: 'AvailabilityBlock',
      entityId: groupId,
      action: 'location_block_group_remove',
      beforeSnapshot: { activeCount: blocks.length },
      afterSnapshot: { activeCount: 0 },
      metadata: { blockIds: blocks.map((b) => String(b._id)) },
      reason: tombstoneReason,
      sourceContext: {
        route: ctx.route || null,
        namespace: 'ops'
      }
    },
    { req: ctx.req }
  );

  return {
    locationBlockGroupId: groupId,
    removedCount: blocks.length
  };
}

module.exports = {
  previewLocationBlock,
  createLocationBlock,
  removeLocationBlockGroup,
  canUseMongoTransactions
};
