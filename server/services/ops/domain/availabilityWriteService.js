const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const mongoose = require('mongoose');
const { requirePermission, ACTIONS } = require('../../permissionService');
const { appendAuditEvent } = require('../../auditWriter');
const { normalizeExclusiveDateRange } = require('../../../utils/dateTime');
const { evaluateCabinConflicts } = require('./conflictService');
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

async function createBlock({ blockType, cabinId, unitId = null, startDate, endDate, reason = null, metadata = {}, ctx = {} }) {
  if (!['manual_block', 'maintenance'].includes(blockType)) {
    throw createDomainError('validation', 'Only manual_block or maintenance can be created from ops actions');
  }
  requirePermission({
    role: ctx.user?.role,
    action: actionFor(blockType, 'create')
  });
  const normalized = normalizeExclusiveDateRange(startDate, endDate);
  const conflict = await evaluateCabinConflicts({
    cabinId,
    startDate: normalized.startDate,
    endDate: normalized.endDate
  });

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
        cabinId: String(cabinId),
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
    cabinId,
    unitId,
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
  const conflict = await evaluateCabinConflicts({
    cabinId: block.cabinId,
    startDate: normalized.startDate,
    endDate: normalized.endDate
  });

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
  tombstoneBlock
};
