'use strict';

const crypto = require('crypto');
const Booking = require('../../../models/Booking');
const Guest = require('../../../models/Guest');
const ReservationNote = require('../../../models/ReservationNote');
const { appendAuditEvent } = require('../../auditWriter');

const PROCESSING_LEASE_MS = 5 * 60 * 1000;
const REVIEW_FAILURE_THRESHOLD = 3;
const HOOK_STEPS = Object.freeze([
  'guest_upsert',
  'guest_contact_preferences',
  'reservation_note',
  'confirmation_email_queue',
  'message_orchestrator',
  'immediate_ops_push',
  'scheduled_ops_push'
]);

function safeErrorCode(error) {
  const code = String(error?.code || error?.name || 'CONVERSION_HOOK_FAILED');
  return /^[A-Z0-9_.:-]{1,80}$/i.test(code) ? code : 'CONVERSION_HOOK_FAILED';
}

async function runStep(step, { booking, blockId, cabin, note, initialStatus, ctx }) {
  switch (step) {
    case 'guest_upsert':
      await Guest.findOneAndUpdate(
        { email: booking.guestInfo.email },
        {
          $set: {
            firstName: booking.guestInfo.firstName,
            lastName: booking.guestInfo.lastName,
            email: booking.guestInfo.email,
            phone: booking.guestInfo.phone,
            source: 'internal_admin'
          },
          $setOnInsert: { importedAt: new Date(), sourceReference: String(booking._id) }
        },
        { new: true, upsert: true }
      );
      return;
    case 'guest_contact_preferences': {
      const { syncGuestContactPreferencesForBooking } = require('../../messaging/guestContactPreferenceSync');
      await syncGuestContactPreferencesForBooking(booking, { throwOnError: true });
      return;
    }
    case 'reservation_note':
      if (!note || !String(note).trim()) return;
      {
        const sourceBlockId = String(blockId);
        const existing = await ReservationNote.findOne({
          reservationId: booking._id,
          'metadata.conversionSourceBlockId': sourceBlockId
        }).select('_id').lean();
        if (existing) return;
        const noteId = new mongooseObjectIdFromHash(`${booking._id}:${sourceBlockId}:manual-note`);
        await appendAuditEvent(
          {
            actorType: 'user',
            actorId: ctx.user?.id || 'admin',
            entityType: 'Reservation',
            entityId: String(booking._id),
            action: 'reservation_note_add',
            beforeSnapshot: null,
            afterSnapshot: { noteId: String(noteId), kind: 'manual_intake' },
            metadata: { noteId: String(noteId), conversionSourceBlockId: sourceBlockId },
            reason: null,
            dedupeKey: `manual_block_conversion_note:${sourceBlockId}`,
            sourceContext: { route: ctx.route || null, namespace: 'ops' }
          },
          { req: ctx.req }
        );
        try {
          await ReservationNote.create({
            _id: noteId,
            reservationId: booking._id,
            author: {
              actorType: 'user',
              actorId: ctx.user?.id || 'admin',
              role: ctx.user?.role || 'admin'
            },
            content: String(note).trim().slice(0, 5000),
            metadata: { kind: 'manual_intake', conversionSourceBlockId: sourceBlockId }
          });
        } catch (error) {
          if (error?.code !== 11000) throw error;
          const raced = await ReservationNote.findOne({
            reservationId: booking._id,
            'metadata.conversionSourceBlockId': sourceBlockId
          }).select('_id').lean();
          if (!raced) throw error;
        }
      }
      return;
    case 'confirmation_email_queue':
      if (
        booking.provenance?.conversionHooks?.sendGuestConfirmationEmail !== true ||
        initialStatus !== 'confirmed'
      ) return;
      {
        const { processBookingConfirmationDelivery } = require('../../email/bookingConfirmationDeliveryService');
        const result = await processBookingConfirmationDelivery({
          booking,
          source: 'ops_manual_block_conversion',
          send: false
        });
        if (result?.ok === false && !result?.skipped) {
          const error = new Error('Confirmation delivery could not be queued');
          error.code = 'CONVERSION_CONFIRMATION_QUEUE_FAILED';
          throw error;
        }
      }
      return;
    case 'message_orchestrator': {
      const result = await require('../../messaging/messageOrchestrator')
        .notifyManualReservationCreated({ bookingId: booking._id });
      if (result?.error) {
        const error = new Error('Message scheduling failed');
        error.code = 'CONVERSION_MESSAGE_SCHEDULE_FAILED';
        throw error;
      }
      return;
    }
    case 'immediate_ops_push': {
      const result = await require('../push/opsPushEventNotifications')
        .notifyOpsPushManualReservationCreated({ bookingId: booking._id, throwOnFailure: true });
      if (result?.error) {
        const error = new Error('Immediate operations notification failed');
        error.code = 'CONVERSION_OPS_PUSH_FAILED';
        throw error;
      }
      return;
    }
    case 'scheduled_ops_push':
      await require('../push/opsPushScheduleOrchestrator').scheduleOpsPushForBooking({
        bookingId: booking._id
      });
      return;
    default:
      throw new Error(`Unknown conversion hook step: ${step}`);
  }
}

function mongooseObjectIdFromHash(value) {
  const mongoose = require('mongoose');
  const hex = crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
  return new mongoose.Types.ObjectId(hex);
}

async function claimHooks(bookingId, owner, now) {
  const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
  return Booking.findOneAndUpdate(
    {
      _id: bookingId,
      'provenance.conversionHooks.status': {
        $in: ['pending', 'failed', 'processing', null]
      },
      $or: [
        {
          $or: [
            { 'provenance.conversionHooks.status': { $in: ['pending', 'failed', null] } },
            { 'provenance.conversionHooks.status': { $exists: false } }
          ]
        },
        {
          'provenance.conversionHooks.status': 'processing',
          'provenance.conversionHooks.processingLeaseAt': { $lte: staleBefore }
        }
      ]
    },
    {
      $set: {
        'provenance.conversionHooks.status': 'processing',
        'provenance.conversionHooks.processingLeaseAt': now,
        'provenance.conversionHooks.processingOwner': owner
      },
      $inc: { 'provenance.conversionHooks.attemptCount': 1 }
    },
    { new: true }
  ).lean();
}

async function persistStep(bookingId, owner, step) {
  const updated = await Booking.updateOne(
    {
      _id: bookingId,
      'provenance.conversionHooks.status': 'processing',
      'provenance.conversionHooks.processingOwner': owner
    },
    { $addToSet: { 'provenance.conversionHooks.completedSteps': step } }
  );
  if (updated.modifiedCount !== 1) {
    const error = new Error('Conversion hook lease was lost');
    error.code = 'CONVERSION_HOOK_LEASE_LOST';
    throw error;
  }
}

async function openRepeatedFailureReview(booking, blockId, attemptCount, errorCode) {
  if (attemptCount < REVIEW_FAILURE_THRESHOLD) return;
  const { openManualReviewItem } = require('../ingestion/manualReviewService');
  await openManualReviewItem({
    category: 'manual_block_conversion_hook_failure',
    severity: 'high',
    entityType: 'Booking',
    entityId: String(booking._id),
    title: 'Manual block conversion follow-up failed',
    details: 'Conversion follow-up actions need operator review; retry is safe after inspecting delivery state.',
    provenance: {
      source: 'manual_block_conversion',
      sourceReference: String(blockId)
    },
    evidence: {
      blockId: String(blockId),
      bookingId: String(booking._id),
      attemptCount,
      errorCode
    }
  });
}

async function processConversionHooks({ bookingId, blockId, cabin, note, initialStatus, ctx = {} }) {
  const owner = crypto.randomUUID();
  const claimed = await claimHooks(bookingId, owner, new Date());
  if (!claimed) {
    const current = await Booking.findById(bookingId)
      .select('provenance.conversionHooks')
      .lean();
    if (current?.provenance?.conversionHooks?.status === 'completed') {
      return { completed: true, alreadyCompleted: true };
    }
    return { completed: false, inProgress: current?.provenance?.conversionHooks?.status === 'processing' };
  }
  const completedSteps = new Set(claimed.provenance?.conversionHooks?.completedSteps || []);
  const job = {
    booking: claimed,
    blockId,
    cabin,
    note,
    initialStatus,
    ctx
  };
  try {
    for (const step of HOOK_STEPS) {
      if (completedSteps.has(step)) continue;
      await runStep(step, job);
      await persistStep(bookingId, owner, step);
    }
    const updated = await Booking.findOneAndUpdate(
      {
        _id: bookingId,
        'provenance.conversionHooks.status': 'processing',
        'provenance.conversionHooks.processingOwner': owner
      },
      {
        $set: {
          'provenance.conversionHooks.status': 'completed',
          'provenance.conversionHooks.completedAt': new Date(),
          'provenance.conversionHooks.processingLeaseAt': null,
          'provenance.conversionHooks.processingOwner': null,
          'provenance.conversionHooks.lastErrorCode': null
        }
      },
      { new: true }
    ).lean();
    if (!updated) {
      const error = new Error('Conversion hook lease was lost before completion');
      error.code = 'CONVERSION_HOOK_LEASE_LOST';
      throw error;
    }
    return { completed: true };
  } catch (error) {
    const errorCode = safeErrorCode(error);
    const failed = await Booking.findOneAndUpdate(
      {
        _id: bookingId,
        'provenance.conversionHooks.status': 'processing',
        'provenance.conversionHooks.processingOwner': owner
      },
      {
        $set: {
          'provenance.conversionHooks.status': 'failed',
          'provenance.conversionHooks.processingLeaseAt': null,
          'provenance.conversionHooks.processingOwner': null,
          'provenance.conversionHooks.lastFailureAt': new Date(),
          'provenance.conversionHooks.lastErrorCode': errorCode
        }
      },
      { new: true }
    ).lean();
    if (failed) {
      await openRepeatedFailureReview(
        claimed,
        blockId,
        failed.provenance?.conversionHooks?.attemptCount || 0,
        errorCode
      );
    }
    throw error;
  }
}

module.exports = {
  HOOK_STEPS,
  PROCESSING_LEASE_MS,
  REVIEW_FAILURE_THRESHOLD,
  processConversionHooks
};
