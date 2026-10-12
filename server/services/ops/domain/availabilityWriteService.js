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
const { normalizeManualBlockPurpose } = require('../manualBlockPurposeService');

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

const SYSTEM_MANAGED_METADATA_KEYS = Object.freeze([
  'conversionAttemptId',
  'conversionStartedAt',
  'conversionReservationId',
  'convertedAt',
  'availabilityTargetScope',
  'locationBlockGroupId',
  'locationKey',
  'scope',
  'targetKey',
  'operatorNote'
]);

const MAX_OPERATOR_NOTE_LENGTH = 500;

function normalizeOperatorNote(value) {
  const note = value == null ? '' : String(value).trim();
  if (note.length > MAX_OPERATOR_NOTE_LENGTH) {
    throw createDomainError('validation', `Operator note cannot exceed ${MAX_OPERATOR_NOTE_LENGTH} characters`, {
      maxLength: MAX_OPERATOR_NOTE_LENGTH
    }, 400);
  }
  return note || null;
}

function hasSystemManagedMetadata(metadata) {
  return SYSTEM_MANAGED_METADATA_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(metadata || {}, key)
  );
}

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
async function resolveAvailabilityBlockTarget({
  cabinId,
  unitId = null,
  targetScope = null,
  allowLegacyTargetResolution = false
}) {
  const requestedCabinId = objectIdOrValidationError(cabinId, 'cabinId');
  let cabin = await Cabin.findById(requestedCabinId)
    .select('_id inventoryType cabinTypeId cabinTypeRef isActive')
    .lean();

  if (!cabin && allowLegacyTargetResolution) {
    const cabinType = await CabinType.findById(requestedCabinId).select('_id').lean();
    if (cabinType) {
      const parents = await Cabin.find({
        $or: [{ cabinTypeId: cabinType._id }, { cabinTypeRef: cabinType._id }]
      })
        .select('_id inventoryType cabinTypeId cabinTypeRef isActive')
        .limit(2)
        .lean();
      if (parents.length > 1) {
        throw createDomainError(
          'validation',
          'Legacy accommodation target is ambiguous; choose a parent cabin explicitly',
          { cabinTypeId: String(cabinType._id) },
          409
        );
      }
      cabin = parents[0] || null;
    }
  }

  if (!cabin) {
    throw createDomainError('validation', 'Cabin target not found', { cabinId: String(cabinId) }, 404);
  }
  if (cabin.isActive === false) {
    throw createDomainError('validation', 'Cabin target is inactive', { cabinId: String(cabin._id) }, 409);
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
      targetScope: TARGET_SCOPES.SINGLE_CABIN,
      cabinTypeId: null,
      inventoryType: cabin.inventoryType || 'single'
    };
  }

  if (!cabinTypeId) {
    throw createDomainError('validation', 'Multi-unit cabin is missing its cabin type', {
      cabinId: String(cabin._id)
    });
  }

  if (!unitId) {
    const resolvedTargetScope =
      targetScope || (allowLegacyTargetResolution ? TARGET_SCOPES.ALL_UNITS : null);
    if (resolvedTargetScope !== TARGET_SCOPES.ALL_UNITS) {
      throw createDomainError(
        'validation',
        'Choose a physical unit or explicitly request an all-units block',
        { cabinId: String(cabin._id), targetScope }
      );
    }
    return {
      cabinId: cabin._id,
      unitId: null,
      targetScope: resolvedTargetScope,
      cabinTypeId,
      inventoryType: cabin.inventoryType
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
    targetScope: TARGET_SCOPES.UNIT,
    cabinTypeId,
    inventoryType: cabin.inventoryType
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
  manualBlockPurpose = null,
  operatorNote = null,
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
  let normalizedPurpose = null;
  const normalizedNote = normalizeOperatorNote(operatorNote);
  if (blockType === 'manual_block') {
    try {
      normalizedPurpose = normalizeManualBlockPurpose(manualBlockPurpose, normalizedNote);
    } catch (error) {
      throw createDomainError('validation', error.message, { code: error.code }, 400);
    }
  } else if (manualBlockPurpose != null) {
    throw createDomainError('validation', 'Maintenance blocks do not use manual-block purposes');
  }
  if (hasSystemManagedMetadata(metadata)) {
    throw createDomainError('validation', 'System-managed block metadata cannot be set by a caller');
  }
  const target = await resolveAvailabilityBlockTarget({
    cabinId,
    unitId,
    targetScope
  });
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
        endDate: normalized.endDate,
        manualBlockPurpose: normalizedPurpose,
        operatorNote: normalizedNote
      },
      metadata: {
        manualBlockPurpose: normalizedPurpose,
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
      ...(normalizedPurpose ? { manualBlockPurpose: normalizedPurpose } : {}),
      ...(blockType === 'manual_block' && normalizedNote ? { operatorNote: normalizedNote } : {}),
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

async function editBlock({
  blockId,
  startDate,
  endDate,
  reason = null,
  manualBlockPurpose,
  operatorNote,
  metadata = {},
  ctx = {}
}) {
  const block = await AvailabilityBlock.findById(blockId);
  if (!block) throw createDomainError('validation', 'Availability block not found', { blockId }, 404);
  if (!['manual_block', 'maintenance'].includes(block.blockType)) {
    throw createDomainError('validation', 'Only manual/maintenance blocks are editable via this action');
  }
  if (block.metadata?.conversionAttemptId) {
    throw createDomainError('conflict', 'This block is being converted; refresh before editing', { blockId }, 409);
  }
  if (hasSystemManagedMetadata(metadata)) {
    throw createDomainError('validation', 'System-managed block metadata cannot be edited');
  }
  if (block.blockType === 'maintenance' && metadata?.manualBlockPurpose != null) {
    throw createDomainError('validation', 'Maintenance blocks do not use manual-block purposes');
  }
  if (
    block.blockType === 'manual_block' &&
    manualBlockPurpose !== undefined ||
    Object.prototype.hasOwnProperty.call(metadata || {}, 'manualBlockPurpose')
  ) {
    try {
      manualBlockPurpose = normalizeManualBlockPurpose(
        manualBlockPurpose ?? metadata.manualBlockPurpose,
        operatorNote ?? block.metadata?.operatorNote
      );
    } catch (error) {
      throw createDomainError('validation', error.message, { code: error.code }, 400);
    }
  }

  requirePermission({
    role: ctx.user?.role,
    action: actionFor(block.blockType, 'edit')
  });

  const normalized = normalizeExclusiveDateRange(startDate ?? block.startDate, endDate ?? block.endDate);
  const normalizedNote = operatorNote === undefined
    ? (block.metadata?.operatorNote || null)
    : normalizeOperatorNote(operatorNote);
  if (block.blockType === 'manual_block' && manualBlockPurpose === undefined) {
    manualBlockPurpose = block.metadata?.manualBlockPurpose || null;
  }
  if (block.blockType === 'manual_block' && manualBlockPurpose) {
    try {
      manualBlockPurpose = normalizeManualBlockPurpose(manualBlockPurpose, normalizedNote);
    } catch (error) {
      throw createDomainError('validation', error.message, { code: error.code }, 400);
    }
  }
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
        endDate: block.endDate,
        manualBlockPurpose: block.metadata?.manualBlockPurpose || null,
        operatorNote: block.metadata?.operatorNote || null
      },
      afterSnapshot: {
        startDate: normalized.startDate,
        endDate: normalized.endDate,
        manualBlockPurpose: block.blockType === 'manual_block' ? manualBlockPurpose : null,
        operatorNote: block.blockType === 'manual_block' ? normalizedNote : null
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

  const edited = await AvailabilityBlock.findOneAndUpdate(
    {
      _id: block._id,
      status: 'active',
      ...(block.updatedAt ? { updatedAt: block.updatedAt } : { updatedAt: { $exists: false } }),
      'metadata.conversionAttemptId': { $exists: false }
    },
    {
      $set: {
        startDate: normalized.startDate,
        endDate: normalized.endDate,
        metadata: {
          ...(block.metadata || {}),
          ...(block.blockType === 'manual_block'
            ? {
                manualBlockPurpose,
                ...(normalizedNote ? { operatorNote: normalizedNote } : { operatorNote: null })
              }
            : {})
        }
      }
    },
    { new: true, runValidators: true }
  );
  if (!edited) {
    throw createDomainError('conflict', 'Block changed while editing; refresh and try again', { blockId }, 409);
  }

  return {
    blockId: String(edited._id),
    blockType: edited.blockType,
    status: edited.status,
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
  if (block.metadata?.conversionAttemptId) {
    throw createDomainError('conflict', 'This block is being converted; refresh before removing it', { blockId }, 409);
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

  const tombstoned = await AvailabilityBlock.findOneAndUpdate(
    {
      _id: block._id,
      status: 'active',
      ...(block.updatedAt ? { updatedAt: block.updatedAt } : { updatedAt: { $exists: false } }),
      'metadata.conversionAttemptId': { $exists: false }
    },
    {
      $set: {
        status: 'tombstoned',
        tombstonedAt: new Date(),
        tombstoneReason: reason || 'tombstone'
      }
    },
    { new: true, runValidators: true }
  );
  if (!tombstoned) {
    throw createDomainError('conflict', 'Block changed while removing it; refresh and try again', { blockId }, 409);
  }

  return {
    blockId: String(tombstoned._id),
    status: tombstoned.status
  };
}

module.exports = {
  createBlock,
  editBlock,
  tombstoneBlock,
  resolveAvailabilityBlockTarget,
  TARGET_SCOPES
};
