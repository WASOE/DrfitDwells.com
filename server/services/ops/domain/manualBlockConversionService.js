'use strict';

const mongoose = require('mongoose');
const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const Booking = require('../../../models/Booking');
const AuditEvent = require('../../../models/AuditEvent');
const Cabin = require('../../../models/Cabin');
const Unit = require('../../../models/Unit');
const { requirePermission, ACTIONS } = require('../../permissionService');
const { appendAuditEvent } = require('../../auditWriter');
const { normalizeExclusiveDateRange } = require('../../../utils/dateTime');
const { evaluateTargetConflicts } = require('./conflictService');
const { resolveAvailabilityBlockTarget } = require('./availabilityWriteService');
const { createDomainError } = require('./errors');
const {
  createManualReservation,
} = require('./reservationWriteService');
const { normalizeManualReservationPurpose } = require('../manualReservationEmailPolicy');
const { assertManualBlockConversionIndex } = require('./manualBlockConversionIndexService');
const { processConversionHooks } = require('./manualBlockConversionHooksService');
const { openManualReviewItem } = require('../ingestion/manualReviewService');

const CONVERSION_LEASE_MS = 10 * 60 * 1000;

function validObjectId(value, field) {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw createDomainError('validation', `${field} must be a valid id`, { field }, 400);
  }
  return new mongoose.Types.ObjectId(String(value));
}

async function readCompletedConversion(block) {
  const bookingId = block.metadata?.conversionReservationId || block.reservationId;
  if (!bookingId) return null;
  const booking = await Booking.findById(bookingId)
    .select('_id status cabinId cabinTypeId unitId provenance.convertedFromAvailabilityBlockId')
    .lean();
  if (!booking) {
    throw createDomainError(
      'dependency_failure',
      'This block is linked to a reservation that could not be found',
      { blockId: String(block._id), reservationId: String(bookingId) },
      500
    );
  }
  if (
    block.status !== 'tombstoned' ||
    String(block.reservationId || '') !== String(booking._id) ||
    String(booking.provenance?.convertedFromAvailabilityBlockId || '') !== String(block._id)
  ) {
    throw createDomainError(
      'conflict',
      'The existing reservation link is incomplete or inconsistent; resolve it before retrying',
      { blockId: String(block._id), reservationId: String(booking._id) },
      409
    );
  }
  return {
    reservationId: String(booking._id),
    status: booking.status,
    cabinId: booking.cabinId ? String(booking.cabinId) : null,
    cabinTypeId: booking.cabinTypeId ? String(booking.cabinTypeId) : null,
    unitId: booking.unitId ? String(booking.unitId) : null,
    converted: true,
    idempotentReplay: true
  };
}

async function ensureConversionIntentAudit({ block, actorId, ctx }) {
  const dedupeKey = `manual_block_conversion_intent:${String(block._id)}`;
  const exists = await AuditEvent.exists({ dedupeKey });
  if (!exists) {
    try {
      await appendAuditEvent(
        {
          actorType: 'user',
          actorId: actorId || 'admin',
          entityType: 'AvailabilityBlock',
          entityId: String(block._id),
          action: 'manual_block_conversion_prepared',
          beforeSnapshot: {
            status: block.status,
            blockType: block.blockType,
            startDate: block.startDate,
            endDate: block.endDate,
            manualBlockPurpose: block.metadata?.manualBlockPurpose || null
          },
          afterSnapshot: { conversionState: 'prepared' },
          metadata: { conversionState: 'prepared' },
          dedupeKey,
          sourceContext: {
            route: ctx.route || 'POST /api/ops/availability/manual-blocks/:id/convert',
            namespace: 'ops'
          }
        },
        { req: ctx.req }
      );
    } catch (error) {
      if (
        error?.code !== 11000 ||
        error.keyValue?.dedupeKey !== dedupeKey ||
        !(await AuditEvent.exists({ dedupeKey }))
      ) {
        throw error;
      }
    }
  }
  await AvailabilityBlock.updateOne(
    { _id: block._id, status: 'active' },
    { $set: { 'metadata.conversionHandoffStatus': 'prepared' } }
  );
}

async function ensureConversionCompletionAudit({ blockId, booking, actorId, ctx }) {
  const dedupeKey = `manual_block_conversion_complete:${String(blockId)}`;
  const exists = await AuditEvent.exists({ dedupeKey });
  try {
    if (!exists) {
      try {
        await appendAuditEvent(
          {
            actorType: 'user',
            actorId: actorId || 'admin',
            entityType: 'AvailabilityBlock',
            entityId: String(blockId),
            action: 'manual_block_convert_to_reservation',
            beforeSnapshot: { status: 'active' },
            afterSnapshot: {
              status: 'tombstoned',
              reservationId: String(booking._id),
              allocatedUnitId: booking.unitId ? String(booking.unitId) : null
            },
            metadata: {
              reservationId: String(booking._id),
              conversionState: 'completed'
            },
            dedupeKey,
            sourceContext: {
              route: ctx.route || 'POST /api/ops/availability/manual-blocks/:id/convert',
              namespace: 'ops'
            }
          },
          { req: ctx.req }
        );
      } catch (error) {
        if (
          error?.code !== 11000 ||
          error.keyValue?.dedupeKey !== dedupeKey ||
          !(await AuditEvent.exists({ dedupeKey }))
        ) {
          throw error;
        }
      }
    }
    await AvailabilityBlock.updateOne(
      { _id: blockId },
      {
        $unset: {
          'metadata.conversionCompletionAuditPending': '',
          'metadata.conversionCompletionAuditFailureAt': ''
        }
      }
    );
  } catch (error) {
    await AvailabilityBlock.updateOne(
      { _id: blockId, status: 'tombstoned', reservationId: booking._id },
      {
        $set: {
          'metadata.conversionCompletionAuditPending': true,
          'metadata.conversionCompletionAuditFailureAt': new Date()
        }
      }
    );
    await openManualReviewItem({
      category: 'manual_block_conversion_audit_incomplete',
      severity: 'high',
      entityType: 'AvailabilityBlock',
      entityId: String(blockId),
      title: 'Manual block conversion audit is incomplete',
      details: 'The reservation handoff succeeded, but its completion audit needs retry or operator review.',
      provenance: { source: 'manual_block_conversion', sourceReference: String(blockId) },
      evidence: { blockId: String(blockId), bookingId: String(booking._id), errorCode: 'AUDIT_WRITE_FAILED' }
    });
    throw error;
  }
}

async function finishConversion({ blockId, booking, source, cabin, ctx, initialStatus, reason }) {
    await ensureConversionCompletionAudit({ blockId, booking, actorId: ctx.user?.id, ctx });
    await processConversionHooks({
      bookingId: booking._id,
      blockId,
      cabin,
      note: reason || source.metadata?.operatorNote || null,
      initialStatus: initialStatus || booking.status,
      ctx
    });
  }
function conflictSummary(conflicts) {
  return {
    hardConflicts: conflicts.hardConflicts || [],
    warnings: conflicts.warnings || []
  };
}

async function convertManualBlockToReservation({
  blockId,
  guestInfo,
  adults = 2,
  children = 0,
  initialStatus = 'pending',
  manualReservationPurpose,
  acceptExternalHoldWarnings = false,
  unitId = null,
  sendGuestConfirmationEmail = false,
  reason = null,
  ctx = {}
}) {
  const role = ctx.user?.role;
  requirePermission({ role, action: ACTIONS.OPS_RESERVATION_MANUAL_CREATE });
  requirePermission({ role, action: ACTIONS.OPS_AVAILABILITY_MANUAL_BLOCK_REMOVE });
  await assertManualBlockConversionIndex();

  const sourceId = validObjectId(blockId, 'blockId');
  const source = await AvailabilityBlock.findById(sourceId).lean();
  if (!source) throw createDomainError('validation', 'Manual block not found', { blockId }, 404);
  if (source.blockType !== 'manual_block') {
    throw createDomainError('validation', 'Only a manual block can be converted to a reservation');
  }
  const alreadyConverted = await readCompletedConversion(source);
  if (alreadyConverted) {
    const booking = await Booking.findById(alreadyConverted.reservationId).lean();
    const cabin = booking?.cabinId
      ? await Cabin.findById(booking.cabinId).select('name').lean()
      : await Cabin.findById(source.cabinId).select('name').lean();
    await finishConversion({
      blockId: sourceId,
      booking,
      source,
      cabin,
      ctx,
      initialStatus: booking.status,
      reason
    });
    return alreadyConverted;
  }
  if (source.status !== 'active') {
    throw createDomainError('conflict', 'Only an active manual block can be converted', { blockId }, 409);
  }
  if (source.metadata?.scope === 'location_wide') {
    throw createDomainError(
      'validation',
      'Convert a single-property block; location-wide groups cannot be converted as one reservation'
    );
  }
  if (!guestInfo || !guestInfo.firstName || !guestInfo.lastName || !guestInfo.email || !guestInfo.phone) {
    throw createDomainError('validation', 'Guest name, email, and phone are required');
  }
  if (!['pending', 'confirmed'].includes(initialStatus)) {
    throw createDomainError('validation', 'initialStatus must be pending or confirmed');
  }
  try {
    if (!normalizeManualReservationPurpose(manualReservationPurpose)) {
      throw new Error('Choose a reservation purpose');
    }
  } catch (error) {
    throw createDomainError('validation', error.message, { manualReservationPurpose }, 400);
  }

  const priorBooking = await Booking.findOne({
    'provenance.convertedFromAvailabilityBlockId': sourceId
  }).lean();
  if (
    priorBooking &&
    (!['pending', 'confirmed', 'in_house'].includes(priorBooking.status) ||
      new Date(priorBooking.checkIn).getTime() !== new Date(source.startDate).getTime() ||
      new Date(priorBooking.checkOut).getTime() !== new Date(source.endDate).getTime())
  ) {
    throw createDomainError(
      'conflict',
      'A reservation already exists for this block but no longer matches its active dates/status; resolve it before retrying',
      { blockId: String(sourceId), reservationId: String(priorBooking._id) },
      409
    );
  }
  const attemptId = new mongoose.Types.ObjectId().toString();
  const now = new Date();
  const leaseClauses = [
    { 'metadata.conversionAttemptId': { $exists: false } },
    { 'metadata.conversionStartedAt': { $lt: new Date(now.getTime() - CONVERSION_LEASE_MS) } }
  ];
  if (priorBooking) {
    leaseClauses.push({ 'metadata.conversionAttemptId': { $exists: true } });
  }
  const leaseResult = await AvailabilityBlock.findOneAndUpdate(
    {
      _id: sourceId,
      status: 'active',
      blockType: 'manual_block',
      ...(source.updatedAt ? { updatedAt: source.updatedAt } : { updatedAt: { $exists: false } }),
      'metadata.conversionReservationId': { $exists: false },
      $or: leaseClauses
    },
    {
      $set: {
        'metadata.conversionAttemptId': attemptId,
        'metadata.conversionStartedAt': now
      }
    },
    { new: true }
  ).lean();
  if (!leaseResult) {
    const latest = await AvailabilityBlock.findById(sourceId).lean();
    const replay = latest ? await readCompletedConversion(latest) : null;
    if (replay) return replay;
    throw createDomainError(
      'conflict',
      'This block is already being converted; refresh the calendar before trying again',
      { blockId },
      409
    );
  }

  let created = null;
  let reservationSecured = Boolean(priorBooking);
  let unitIdForCleanup = null;
  try {
    const targetScope = source.unitId ? 'unit' : source.metadata?.availabilityTargetScope || null;
    const target = await resolveAvailabilityBlockTarget({
      cabinId: source.cabinId,
      unitId: source.unitId,
      targetScope,
      allowLegacyTargetResolution: true
    });
    const normalized = normalizeExclusiveDateRange(source.startDate, source.endDate);
    const cabin = await Cabin.findById(target.cabinId).select('name').lean();
    if (!cabin) throw createDomainError('validation', 'The block accommodation no longer exists', null, 404);

    let units = [];
    if (target.inventoryType === 'multi') {
      const activeUnits = target.unitId
        ? await Unit.find({ _id: target.unitId, isActive: { $ne: false } }).sort({ unitNumber: 1 }).lean()
        : await Unit.find({ cabinTypeId: target.cabinTypeId, isActive: { $ne: false } })
            .sort({ unitNumber: 1 })
            .lean();
      if (!activeUnits.length) {
        throw createDomainError('conflict', 'No active physical unit is available for this block', {
          cabinTypeId: String(target.cabinTypeId)
        }, 409);
      }
      if (target.unitId) {
        if (unitId && String(unitId) !== String(target.unitId)) {
          throw createDomainError('validation', 'A unit-specific block cannot be reassigned during conversion', {
            unitId: String(unitId),
            blockUnitId: String(target.unitId)
          });
        }
        units = activeUnits;
      } else {
        if (!unitId) {
          throw createDomainError('validation', 'Choose a physical unit for this parent-wide block', {
            cabinTypeId: String(target.cabinTypeId)
          });
        }
        units = activeUnits.filter((unit) => String(unit._id) === String(unitId));
        if (!units.length) {
          throw createDomainError('validation', 'The selected unit does not belong to this accommodation', {
            cabinTypeId: String(target.cabinTypeId),
            unitId: String(unitId)
          });
        }
      }
    } else {
      if (unitId) {
        throw createDomainError('validation', 'A single-cabin block cannot be assigned to a physical unit');
      }
      units = [null];
    }

    if (priorBooking) {
      created = {
        reservationId: String(priorBooking._id),
        status: priorBooking.status,
        cabinId: priorBooking.cabinId ? String(priorBooking.cabinId) : null,
        cabinTypeId: priorBooking.cabinTypeId ? String(priorBooking.cabinTypeId) : null,
        unitId: priorBooking.unitId ? String(priorBooking.unitId) : null
      };
      unitIdForCleanup = priorBooking.unitId || null;
    }

    let latestConflicts = null;
    for (const unit of created ? [] : units) {
      let conflicts = null;
      if (unit) {
        conflicts = await evaluateTargetConflicts({
          cabinId: target.cabinId,
          unitId: unit._id,
          cabinTypeId: target.cabinTypeId,
          startDate: normalized.startDate,
          endDate: normalized.endDate,
          excludeAvailabilityBlockId: sourceId
        });
        if (conflicts.hasHardConflicts) {
          latestConflicts = conflicts;
          continue;
        }
      }
      await ensureConversionIntentAudit({ block: source, actorId: ctx.user?.id, ctx });
      try {
        created = await createManualReservation({
          cabinId: target.cabinId,
          unitId: unit?._id || null,
          cabinTypeId: unit ? target.cabinTypeId : null,
          checkInDate: normalized.startDate,
          checkOutDate: normalized.endDate,
          adults,
          children,
          guestInfo,
          initialStatus,
          manualReservationPurpose,
          sendGuestConfirmationEmail,
          acceptExternalHoldWarnings,
          excludeAvailabilityBlockId: sourceId,
          convertedFromAvailabilityBlockId: sourceId,
          conversionHooksPending: true,
          deferPostCreateHooks: true,
          skipIdempotencyCache: true,
          note: reason || source.metadata?.operatorNote || null,
          reason,
          ctx: {
            ...ctx,
            idempotencyKey: `manual-block-conversion:${String(sourceId)}`,
            route: ctx.route || 'POST /api/ops/availability/manual-blocks/:id/convert'
          }
        });
        reservationSecured = true;
        unitIdForCleanup = unit?._id || null;
        break;
      } catch (error) {
        if (error.details?.warnings && !acceptExternalHoldWarnings) {
          throw error;
        }
        if (unit && error.type === 'conflict') {
          latestConflicts = error.details || latestConflicts;
          continue;
        }
        throw error;
      }
    }

    if (!created) {
      throw createDomainError(
        'conflict',
        'No eligible physical unit is available for these dates',
        latestConflicts ? conflictSummary(latestConflicts) : { blockId: String(sourceId) },
        409
      );
    }

    const bookingId = validObjectId(created.reservationId, 'reservationId');
    const completed = await AvailabilityBlock.findOneAndUpdate(
      {
        _id: sourceId,
        status: 'active',
        'metadata.conversionAttemptId': attemptId
      },
      {
        $set: {
          status: 'tombstoned',
          tombstonedAt: new Date(),
          tombstoneReason: 'converted_to_reservation',
          reservationId: bookingId,
          'metadata.conversionReservationId': String(bookingId),
          'metadata.convertedAt': new Date(),
          'metadata.conversionHandoffStatus': 'completed'
        },
        $unset: {
          'metadata.conversionAttemptId': '',
          'metadata.conversionStartedAt': ''
        }
      },
      { new: true }
    ).lean();
    if (!completed) {
      throw createDomainError(
        'conflict',
        'The reservation was secured but the source block handoff did not complete; retry this conversion',
        { blockId: String(sourceId), reservationId: String(bookingId), unitId: unitIdForCleanup ? String(unitIdForCleanup) : null },
        409
      );
    }

    const linkedBooking = await Booking.findById(bookingId).lean();
    await finishConversion({
      blockId: sourceId,
      booking: linkedBooking,
      source: completed,
      cabin,
      ctx,
      initialStatus,
      reason
    });

    return {
      reservationId: String(bookingId),
      status: created.status,
      cabinId: created.cabinTypeId ? null : created.cabinId,
      cabinTypeId: created.cabinTypeId,
      unitId: created.unitId,
      converted: true,
      idempotentReplay: false
    };
  } catch (error) {
    if (!reservationSecured) {
      await AvailabilityBlock.updateOne(
        { _id: sourceId, status: 'active', 'metadata.conversionAttemptId': attemptId },
        { $unset: { 'metadata.conversionAttemptId': '', 'metadata.conversionStartedAt': '' } }
      );
    }
    if (reservationSecured) {
      const linkedId = created?.reservationId;
      const latestBlock = await AvailabilityBlock.findById(sourceId).select('status').lean();
      if (latestBlock?.status === 'active') {
        await AvailabilityBlock.updateOne(
          { _id: sourceId, status: 'active' },
          { $set: { 'metadata.conversionHandoffStatus': 'needs_recovery' } }
        );
        await openManualReviewItem({
          category: 'manual_block_conversion_handoff_incomplete',
          severity: 'high',
          entityType: 'AvailabilityBlock',
          entityId: String(sourceId),
          title: 'Manual block conversion handoff needs recovery',
          details: 'A canonical reservation exists while the source block handoff remains incomplete. Retry the conversion or reconcile manually.',
          provenance: { source: 'manual_block_conversion', sourceReference: String(sourceId) },
          evidence: {
            blockId: String(sourceId),
            bookingId: linkedId || (priorBooking?._id ? String(priorBooking._id) : null),
            errorCode: String(error?.code || error?.type || 'CONVERSION_HANDOFF_FAILED').slice(0, 80)
          }
        });
      }
    }
    throw error;
  }
}

module.exports = { convertManualBlockToReservation };
