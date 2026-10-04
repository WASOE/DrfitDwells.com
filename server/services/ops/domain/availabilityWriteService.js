const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const Cabin = require('../../../models/Cabin');
const CabinType = require('../../../models/CabinType');
const Unit = require('../../../models/Unit');
const mongoose = require('mongoose');
const { requirePermission, ACTIONS } = require('../../permissionService');
const { appendAuditEvent } = require('../../auditWriter');
const { normalizeExclusiveDateRange } = require('../../../utils/dateTime');
const { evaluateCabinConflicts, evaluateTargetConflicts } = require('./conflictService');
const { createDomainError } = require('./errors');

function actionFor(blockType, op) {
  if (blockType === 'manual_block') {
    if (op === 'create') return ACTIONS.OPS_AVAILABILITY_MANUAL_BLOCK_CREATE;
    if (op === 'edit') return ACTIONS.OPS_AVAILABILITY_MANUAL_BLOCK_EDIT;
    return ACTIONS.OPS_AVAILABILITY_MANUAL_BLOCK_REMOVE;
  }
  if (op === 'create') return ACTIONS.OPS_AVAILABILITY_MAINTENANCE_BLOCK_CREATE;
  if (op === 'edit') return ACTIONS.OPS_AVAILABILITY_MAINTENANCE_BLOCK_EDIT;
  return ACTIONS.OPS_AVAILABILITY_MAINTENANCE_BLOCK_REMOVE;
}

function isCheckoutClaimHardConflict(entry) {
  return (
    entry &&
    (entry.kind === 'checkout_night_claim' || entry.kind === 'malformed_checkout_claim')
  );
}

function rejectIfCheckoutClaimConflicts(conflict) {
  const checkoutHard = (conflict.hardConflicts || []).filter(isCheckoutClaimHardConflict);
  if (checkoutHard.length > 0) {
    throw createDomainError(
      'conflict',
      'Target has overlapping checkout night claims',
      { hardConflicts: conflict.hardConflicts },
      409
    );
  }
}

const TARGET_SCOPES = Object.freeze({
  SINGLE_CABIN: 'single_cabin',
  UNIT: 'unit',
  ALL_UNITS: 'all_units'
});

function objectIdOrValidationError(value, field) {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw createDomainError('validation', `${field} must be a valid id`, { field }, 400);
  }
  return new mongoose.Types.ObjectId(String(value));
}

/**
 * Resolve the public/calendar identifier to the canonical stored Cabin and
 * validate physical-unit targeting. Multi-unit parent-wide blocks require an
 * explicit all_units scope so a missing unit id can never silently block the pool.
 */
async function resolveAvailabilityBlockTarget({ cabinId, unitId = null, targetScope = null }) {
  const requestedCabinId = objectIdOrValidationError(cabinId, 'cabinId');
  let cabin = await Cabin.findById(requestedCabinId)
    .select('_id inventoryType cabinTypeId cabinTypeRef isActive')
    .lean();

  if (!cabin) {
    const cabinType = await CabinType.findById(requestedCabinId).select('_id').lean();
    if (cabinType) {
      cabin = await Cabin.findOne({
        isActive: true,
        $or: [{ cabinTypeId: cabinType._id }, { cabinTypeRef: cabinType._id }]
      })
        .select('_id inventoryType cabinTypeId cabinTypeRef isActive')
        .lean();
    }
  }

  if (!cabin) {
    throw createDomainError('validation', 'Cabin target not found', { cabinId: String(cabinId) }, 404);
  }

  const cabinTypeId = cabin.cabinTypeId || cabin.cabinTypeRef || null;
  const isMultiUnit = cabin.inventoryType === 'multi';

  if (!isMultiUnit) {
    if (unitId) {
      throw createDomainError('validation', 'Single-cabin blocks cannot target a unit', {
        cabinId: String(cabin._id),
        unitId: String(unitId)
      });
    }
    if (targetScope && targetScope !== TARGET_SCOPES.SINGLE_CABIN) {
      throw createDomainError('validation', 'Invalid target scope for a single cabin', { targetScope });
    }
    return {
      cabinId: cabin._id,
      unitId: null,
      targetScope: TARGET_SCOPES.SINGLE_CABIN
    };
  }

  if (!cabinTypeId) {
    throw createDomainError('validation', 'Multi-unit cabin is missing its cabin type', {
      cabinId: String(cabin._id)
    });
  }

  if (!unitId) {
    if (targetScope !== TARGET_SCOPES.ALL_UNITS) {
      throw createDomainError(
        'validation',
        'Choose a physical unit or explicitly request an all-units block',
        { cabinId: String(cabin._id), targetScope }
      );
    }
    return {
      cabinId: cabin._id,
      unitId: null,
      targetScope: TARGET_SCOPES.ALL_UNITS
    };
  }

  if (targetScope && targetScope !== TARGET_SCOPES.UNIT) {
    throw createDomainError('validation', 'A unit target requires targetScope=unit', { targetScope });
  }

  const unitObjectId = objectIdOrValidationError(unitId, 'unitId');
  const unit = await Unit.findById(unitObjectId).select('_id cabinTypeId isActive').lean();
  if (!unit || unit.isActive === false || String(unit.cabinTypeId) !== String(cabinTypeId)) {
    throw createDomainError('validation', 'Unit is inactive or does not belong to this cabin', {
      cabinId: String(cabin._id),
      unitId: String(unitId)
    });
  }

  return {
    cabinId: cabin._id,
    unitId: unit._id,
    targetScope: TARGET_SCOPES.UNIT
  };
}

/**
 * Evaluate OPS create/edit conflicts for the stored resource scope.
 * Unit-specific → evaluateTargetConflicts for that Unit.
 * Parent-wide (unitId null on multi parent) → evaluateCabinConflicts resolves all child Units.
 * Single cabin → CabinNightClaim via evaluateCabinConflicts / evaluateTargetConflicts.
 *
 * B8F1B concurrency: pre-write checkout-claim visibility is best-effort across
 * separate collections; not authoritative claim↔AvailabilityBlock mutual exclusion.
 */
async function evaluateOpsAvailabilityConflicts({
  cabinId,
  unitId = null,
  startDate,
  endDate,
  excludeCheckoutId = null,
  excludeLeaseId = null,
  now = null
}) {
  if (unitId) {
    const cabin = await Cabin.findById(cabinId).select('cabinTypeId cabinTypeRef').lean();
    const cabinTypeId = cabin ? cabin.cabinTypeId || cabin.cabinTypeRef || null : null;
    return evaluateTargetConflicts({
      cabinId,
      unitId,
      cabinTypeId,
      startDate,
      endDate,
      excludeCheckoutId,
      excludeLeaseId,
      now
    });
  }

  return evaluateCabinConflicts({
    cabinId,
    startDate,
    endDate,
    excludeCheckoutId,
    excludeLeaseId,
    now
  });
}

async function createBlock({
  blockType,
  cabinId,
  unitId = null,
  targetScope = null,
  startDate,
  endDate,
  reason = null,
  metadata = {},
  ctx = {}
}) {
  if (!['manual_block', 'maintenance'].includes(blockType)) {
    throw createDomainError('validation', 'Only manual_block or maintenance can be created from ops actions');
  }
  requirePermission({
    role: ctx.user?.role,
    action: actionFor(blockType, 'create')
  });
  const target = await resolveAvailabilityBlockTarget({ cabinId, unitId, targetScope });
  const normalized = normalizeExclusiveDateRange(startDate, endDate);
  const conflict = await evaluateOpsAvailabilityConflicts({
    cabinId: target.cabinId,
    unitId: target.unitId,
    startDate: normalized.startDate,
    endDate: normalized.endDate
  });
  rejectIfCheckoutClaimConflicts(conflict);

  const blockId = new mongoose.Types.ObjectId();

  await appendAuditEvent(
    {
      actorType: 'user',
      actorId: ctx.user?.id || 'admin',
      entityType: 'AvailabilityBlock',
      entityId: String(blockId),
      action: `${blockType}_create`,
      beforeSnapshot: null,
      afterSnapshot: {
        blockType,
        cabinId: String(target.cabinId),
        unitId: target.unitId ? String(target.unitId) : null,
        targetScope: target.targetScope,
        startDate: normalized.startDate,
        endDate: normalized.endDate
      },
      metadata: {
        conflictSummary: {
          hardCount: conflict.hardConflicts.length,
          warningCount: conflict.warnings.length
        }
      },
      reason: reason || null,
      sourceContext: {
        route: ctx.route || null,
        namespace: 'ops'
      }
    },
    { req: ctx.req }
  );

  const block = await AvailabilityBlock.create({
    _id: blockId,
    cabinId: target.cabinId,
    unitId: target.unitId,
    reservationId: null,
    blockType,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    source: 'internal_admin',
    sourceReference: null,
    importedAt: null,
    confidence: 'high',
    metadata: {
      ...metadata,
      availabilityTargetScope: target.targetScope,
      conflictSummary: {
        hardCount: conflict.hardConflicts.length,
        warningCount: conflict.warnings.length
      }
    }
  });

  return {
    blockId: String(block._id),
    blockType: block.blockType,
    status: block.status,
    cabinId: String(block.cabinId),
    unitId: block.unitId ? String(block.unitId) : null,
    targetScope: target.targetScope,
    conflict: {
      hard: conflict.hardConflicts,
      warnings: conflict.warnings
    }
  };
}

async function editBlock({ blockId, startDate, endDate, reason = null, metadata = {}, ctx = {} }) {
  const block = await AvailabilityBlock.findById(blockId);
  if (!block) throw createDomainError('validation', 'Availability block not found', { blockId }, 404);
  if (!['manual_block', 'maintenance'].includes(block.blockType)) {
    throw createDomainError('validation', 'Only manual/maintenance blocks are editable via this action');
  }

  requirePermission({
    role: ctx.user?.role,
    action: actionFor(block.blockType, 'edit')
  });

  const normalized = normalizeExclusiveDateRange(startDate, endDate);
  // Edit evaluates proposed dates against the stored cabinId/unitId scope (scope move unsupported).
  const conflict = await evaluateOpsAvailabilityConflicts({
    cabinId: block.cabinId,
    unitId: block.unitId || null,
    startDate: normalized.startDate,
    endDate: normalized.endDate
  });
  rejectIfCheckoutClaimConflicts(conflict);

  await appendAuditEvent(
    {
      actorType: 'user',
      actorId: ctx.user?.id || 'admin',
      entityType: 'AvailabilityBlock',
      entityId: String(block._id),
      action: `${block.blockType}_edit`,
      beforeSnapshot: {
        startDate: block.startDate,
        endDate: block.endDate
      },
      afterSnapshot: {
        startDate: normalized.startDate,
        endDate: normalized.endDate
      },
      metadata: {
        ...metadata,
        conflictSummary: {
          hardCount: conflict.hardConflicts.length,
          warningCount: conflict.warnings.length
        }
      },
      reason: reason || null,
      sourceContext: {
        route: ctx.route || null,
        namespace: 'ops'
      }
    },
    { req: ctx.req }
  );

  block.startDate = normalized.startDate;
  block.endDate = normalized.endDate;
  block.metadata = { ...(block.metadata || {}), ...metadata };
  await block.save();

  return {
    blockId: String(block._id),
    blockType: block.blockType,
    status: block.status,
    conflict: {
      hard: conflict.hardConflicts,
      warnings: conflict.warnings
    }
  };
}

async function tombstoneBlock({ blockId, reason, ctx = {} }) {
  const block = await AvailabilityBlock.findById(blockId);
  if (!block) throw createDomainError('validation', 'Availability block not found', { blockId }, 404);
  if (!['manual_block', 'maintenance'].includes(block.blockType)) {
    throw createDomainError('validation', 'Only manual/maintenance blocks are removable via this action');
  }
  if (block.status === 'tombstoned') {
    return {
      blockId: String(block._id),
      status: block.status
    };
  }

  requirePermission({
    role: ctx.user?.role,
    action: actionFor(block.blockType, 'remove')
  });

  await appendAuditEvent(
    {
      actorType: 'user',
      actorId: ctx.user?.id || 'admin',
      entityType: 'AvailabilityBlock',
      entityId: String(block._id),
      action: `${block.blockType}_tombstone`,
      beforeSnapshot: {
        status: block.status
      },
      afterSnapshot: {
        status: 'tombstoned'
      },
      metadata: {},
      reason: reason || 'tombstone',
      sourceContext: {
        route: ctx.route || null,
        namespace: 'ops'
      }
    },
    { req: ctx.req }
  );

  block.status = 'tombstoned';
  block.tombstonedAt = new Date();
  block.tombstoneReason = reason || 'tombstone';
  await block.save();

  return {
    blockId: String(block._id),
    status: block.status
  };
}

module.exports = {
  createBlock,
  editBlock,
  tombstoneBlock,
  resolveAvailabilityBlockTarget,
  TARGET_SCOPES
};
