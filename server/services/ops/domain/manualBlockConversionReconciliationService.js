'use strict';

const mongoose = require('mongoose');
const Booking = require('../../../models/Booking');
const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const ManualReviewItem = require('../../../models/ManualReviewItem');

const CONVERSION_HOOK_LEASE_MS = 5 * 60 * 1000;
const CONVERSION_LEASE_MS = 10 * 60 * 1000;

function idOf(value) {
  return value == null ? null : String(value);
}

async function reconcileManualBlockConversions({ now = new Date(), limit = 100 } = {}) {
  const cappedLimit = Math.min(500, Math.max(1, Number(limit) || 100));
  const staleConversionAt = new Date(now.getTime() - CONVERSION_LEASE_MS);
  const staleHookAt = new Date(now.getTime() - CONVERSION_HOOK_LEASE_MS);
  const bookings = await Booking.find({
    'provenance.convertedFromAvailabilityBlockId': { $type: 'objectId' }
  })
    .select('_id status unitId provenance')
    .sort({ _id: 1 })
    .limit(cappedLimit)
    .lean();
  const sourceBlockIds = bookings.map((booking) => booking.provenance.convertedFromAvailabilityBlockId);
  const sourceBlocks = await AvailabilityBlock.find({ _id: { $in: sourceBlockIds } })
    .select('_id status reservationId metadata')
    .sort({ _id: 1 })
    .lean();
  const conversionBlocks = await AvailabilityBlock.find({
    blockType: 'manual_block',
    $or: [
      { 'metadata.conversionReservationId': { $exists: true } },
      { 'metadata.conversionAttemptId': { $exists: true } },
      { 'metadata.conversionHandoffStatus': { $exists: true } }
    ]
  })
    .select('_id status reservationId metadata')
    .sort({ _id: 1 })
    .limit(cappedLimit * 2)
    .lean();
  const blockById = new Map(
    [...sourceBlocks, ...conversionBlocks].map((block) => [String(block._id), block])
  );
  const blocks = [...blockById.values()];
  const bookingById = new Map(bookings.map((booking) => [String(booking._id), booking]));
  const linkedIds = [...new Set(blocks.flatMap((block) => [
    idOf(block.reservationId),
    idOf(block.metadata?.conversionReservationId)
  ]).filter((id) => id && mongoose.Types.ObjectId.isValid(id)))];
  const linkedBookings = await Booking.find({
    _id: { $in: linkedIds.map((id) => new mongoose.Types.ObjectId(id)) }
  })
    .select('_id provenance.convertedFromAvailabilityBlockId')
    .lean();
  for (const booking of linkedBookings) bookingById.set(String(booking._id), booking);
  const blocksWithBookings = new Set((await Booking.distinct(
    'provenance.convertedFromAvailabilityBlockId',
    { 'provenance.convertedFromAvailabilityBlockId': { $in: blocks.map((block) => block._id) } }
  )).map(String));
  const cases = [];
  const add = (type, blockId, bookingId, details = {}) => {
    cases.push({ type, blockId: idOf(blockId), bookingId: idOf(bookingId), ...details });
  };

  for (const booking of bookings) {
    const sourceBlockId = idOf(booking.provenance?.convertedFromAvailabilityBlockId);
    const block = blockById.get(sourceBlockId);
    if (!block) {
      add('booking_source_block_missing', sourceBlockId, booking._id);
    } else {
      if (block.status === 'active') add('booking_points_to_active_block', block._id, booking._id);
      if (
        block.status === 'tombstoned' &&
        idOf(block.reservationId) !== idOf(booking._id)
      ) {
        add('tombstoned_block_linkage_disagrees', block._id, booking._id);
      }
      if (
        block.metadata?.conversionReservationId &&
        idOf(block.metadata.conversionReservationId) !== idOf(booking._id)
      ) {
        add('booking_block_linkage_disagrees', block._id, booking._id);
      }
    }
    const hookState = booking.provenance?.conversionHooks || {};
    if (['pending', 'failed'].includes(hookState.status)) {
      add(`hooks_${hookState.status}`, sourceBlockId, booking._id, {
        attemptCount: hookState.attemptCount || 0,
        errorCode: hookState.lastErrorCode || null
      });
    } else if (
      hookState.status === 'processing' &&
      (!hookState.processingLeaseAt || new Date(hookState.processingLeaseAt) <= staleHookAt)
    ) {
      add('hooks_stale_processing', sourceBlockId, booking._id, {
        attemptCount: hookState.attemptCount || 0
      });
    }
  }

  for (const block of blocks) {
    const linkedId = idOf(block.reservationId || block.metadata?.conversionReservationId);
    for (const [field, value] of [
      ['reservationId', block.reservationId],
      ['metadata.conversionReservationId', block.metadata?.conversionReservationId]
    ]) {
      const id = idOf(value);
      if (id && !mongoose.Types.ObjectId.isValid(id)) {
        add('block_has_invalid_booking_linkage', block._id, null, {
          linkageField: field,
          linkedValue: value
        });
      }
    }
    if (
      block.metadata?.conversionHandoffStatus &&
      block.status === 'tombstoned' &&
      !block.reservationId &&
      !block.metadata?.conversionReservationId
    ) {
      add('tombstoned_block_missing_linkage', block._id, null);
    }
    if (linkedId && mongoose.Types.ObjectId.isValid(linkedId) && !bookingById.has(linkedId)) {
      add('block_points_to_missing_booking', block._id, linkedId);
    }
    if (
      block.status === 'active' &&
      block.metadata?.conversionAttemptId &&
      block.metadata?.conversionStartedAt &&
      new Date(block.metadata.conversionStartedAt) <= staleConversionAt &&
      !blocksWithBookings.has(String(block._id))
    ) {
      add('stale_conversion_lease_without_booking', block._id, null);
    }
  }

  const blockIds = [...blockById.keys()];
  const bookingIds = [...bookingById.keys()];
  const reviewItems = blockIds.length || bookingIds.length
    ? await ManualReviewItem.find({
        status: 'open',
        $or: [
          {
            entityType: 'AvailabilityBlock',
            category: { $in: [
              'manual_block_conversion_handoff_incomplete',
              'manual_block_conversion_audit_incomplete'
            ] },
            entityId: { $in: blockIds }
          },
          {
            entityType: 'Booking',
            category: 'manual_block_conversion_hook_failure',
            entityId: { $in: bookingIds }
          }
        ]
      })
        .select('_id category severity status entityType entityId title details createdAt')
        .sort({ _id: 1 })
        .limit(cappedLimit * 3)
        .lean()
    : [];

  return {
    generatedAt: now,
    cases,
    manualReviewItems: reviewItems.map((item) => {
      const isBooking = item.entityType === 'Booking';
      const block = isBooking ? null : blockById.get(item.entityId);
      const booking = isBooking ? bookingById.get(item.entityId) : null;
      const linkedId = idOf(block?.reservationId || block?.metadata?.conversionReservationId);
      return {
        id: String(item._id),
        category: item.category,
        severity: item.severity,
        status: item.status,
        entityType: item.entityType,
        entityId: item.entityId,
        blockId: isBooking
          ? idOf(booking?.provenance?.convertedFromAvailabilityBlockId)
          : item.entityId,
        bookingId: isBooking
          ? item.entityId
          : (linkedId && mongoose.Types.ObjectId.isValid(linkedId) ? linkedId : null),
        title: item.title,
        details: item.details,
        createdAt: item.createdAt
      };
    })
  };
}

module.exports = { reconcileManualBlockConversions };
