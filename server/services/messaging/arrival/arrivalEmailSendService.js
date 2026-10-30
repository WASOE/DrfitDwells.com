'use strict';

const mongoose = require('mongoose');
const MessageDispatch = require('../../../models/MessageDispatch');
const emailService = require('../../emailService');
const { classifyEmailDeliveryResult } = require('../../email/emailDeliveryResultContract');
const { composeArrivalGuestEmail } = require('./arrivalEmailComposer');
const {
  buildInitialArrivalIdempotencyKey,
  buildResendArrivalIdempotencyKey,
  buildCorrectionArrivalIdempotencyKey
} = require('./arrivalDispatchIdentity');
const { isArrivalEmailV2Enabled } = require('./arrivalFeatureFlags');

function normalizeEmail(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s || !s.includes('@') || s.length > 254) return null;
  return s;
}

function mapExistingDispatch(existing) {
  return {
    ok: existing.status === 'accepted',
    duplicate: true,
    dispatchId: String(existing._id),
    status: existing.status,
    providerMessageId: existing.providerMessageId || null,
    messageId: existing.providerMessageId || null,
    authoritative: existing.status === 'accepted' && existing.details?.shadow !== true,
    classification: existing.status === 'accepted' ? 'provider_sent' : existing.status,
    error: existing.error || null,
    retriable: existing.details?.retriable === true,
    uncertain: existing.details?.reconciliation === 'needed' || existing.details?.phase === 'uncertain'
  };
}

function isDefinitivePreProviderFailure(existing) {
  if (!existing || existing.status !== 'failed') return false;
  if (existing.details?.reconciliation === 'needed') return false;
  if (existing.details?.phase === 'uncertain') return false;
  if (existing.providerMessageId) return false;
  if (existing.details?.retriable !== true) return false;
  return true;
}

/**
 * Atomically reclaim a failed-but-retriable dispatch for another SMTP attempt
 * under the same durable idempotency key (initial or resend opId).
 */
async function tryReclaimRetriableDispatch(existing, actor) {
  if (!isDefinitivePreProviderFailure(existing)) return null;

  const claimed = await MessageDispatch.findOneAndUpdate(
    {
      _id: existing._id,
      status: 'failed',
      'details.retriable': true,
      providerMessageId: null,
      $or: [
        { 'details.reconciliation': { $exists: false } },
        { 'details.reconciliation': { $ne: 'needed' } }
      ]
    },
    {
      $set: {
        status: 'pending',
        error: null,
        actorId: actor.id != null ? String(actor.id) : existing.actorId || null,
        actorRole: actor.role != null ? String(actor.role) : existing.actorRole || null,
        details: {
          ...(existing.details && typeof existing.details === 'object' ? existing.details : {}),
          shadow: false,
          phase: 'reclaimed',
          retriable: true,
          reclaimedAt: new Date(),
          arrivalEmailV2: true
        }
      },
      $unset: { providerMessageId: 1 }
    },
    { new: true }
  ).lean();

  return claimed;
}

function isDefinitiveNonSubmissionClassification(classified) {
  const c = classified?.classification;
  // Only outcomes that mean the provider never accepted the message.
  return c === 'logged_fallback' || c === 'unavailable' || classified?.method === 'logged' || classified?.method === 'unavailable';
}

async function markDefinitiveFailure(dispatchId, composed, classified, sendResult) {
  const retriable = isDefinitiveNonSubmissionClassification(classified);
  await MessageDispatch.updateOne(
    { _id: dispatchId },
    {
      $set: {
        status: 'failed',
        providerMessageId: null,
        error: {
          code: classified.classification || classified.reason || 'send_failed',
          message: classified.reason || sendResult?.error || 'Arrival email not authoritatively sent',
          method: classified.method || sendResult?.method || null
        },
        details: {
          shadow: false,
          phase: retriable ? 'pre_provider_failed' : 'provider_call_failed',
          retriable,
          reconciliation: retriable ? 'not_needed' : 'needed',
          propertyKind: composed.propertyKind,
          propertyName: composed.propertyName,
          arrivalEmailV2: true,
          classification: classified.classification
        }
      }
    }
  );
  return retriable;
}

async function openArrivalDispatchManualReview({ bookingId, dispatchId, code, message, severity = 'high' }) {
  try {
    const { openManualReviewItem } = require('../../ops/ingestion/manualReviewService');
    await openManualReviewItem({
      category: 'comms_arrival_dispatch_requires_review',
      severity,
      entityType: 'Booking',
      entityId: bookingId != null ? String(bookingId) : null,
      title: 'Arrival email dispatch requires review',
      details: message || 'Arrival V2 dispatch outcome is uncertain or stuck; refuse duplicate SMTP until reconciled.',
      provenance: {
        source: 'arrival_email_v2',
        sourceReference: dispatchId ? `dispatch:${String(dispatchId)}` : null
      },
      evidence: {
        dispatchId: dispatchId != null ? String(dispatchId) : null,
        code: code || null,
        message: message || null
      }
    });
  } catch (err) {
    console.error('[arrival] failed to open MRI for dispatch review', {
      bookingId: bookingId != null ? String(bookingId) : null,
      dispatchId: dispatchId != null ? String(dispatchId) : null,
      error: err?.message || String(err)
    });
  }
}

async function markUncertainFailure(dispatchId, composed, errorPayload) {
  await MessageDispatch.updateOne(
    { _id: dispatchId },
    {
      $set: {
        status: 'failed',
        error: errorPayload,
        details: {
          shadow: false,
          phase: 'uncertain',
          retriable: false,
          reconciliation: 'needed',
          propertyKind: composed?.propertyKind || null,
          propertyName: composed?.propertyName || null,
          arrivalEmailV2: true
        }
      }
    }
  );
}

/**
 * Send property-specific arrival email with durable MessageDispatch outbox.
 *
 * Recovery rules:
 * - Definitive pre-provider failure (logged/unavailable, never submitted): reclaim same key.
 * - Ambiguous outcome after provider call started (throw / unknown): block duplicate SMTP.
 * - Accepted: return durable duplicate without re-SMTP.
 * - Pending in-flight: refuse until reconciled.
 */
async function sendArrivalEmailV2({
  booking,
  kind = 'send',
  operationId = null,
  revision = null,
  actor = {},
  scheduledMessageJobId = null,
  lifecycleSource = null
}) {
  if (!isArrivalEmailV2Enabled()) {
    const err = new Error('Arrival email V2 is disabled');
    err.code = 'ARRIVAL_EMAIL_V2_DISABLED';
    err.status = 409;
    throw err;
  }

  if (!booking?._id) {
    const err = new Error('Booking is required');
    err.code = 'validation';
    err.status = 400;
    throw err;
  }

  if (booking.status === 'cancelled') {
    const err = new Error('Cannot send arrival instructions for a cancelled booking');
    err.code = 'validation';
    err.status = 400;
    throw err;
  }

  const recipient = normalizeEmail(booking.guestInfo?.email);
  if (!recipient) {
    const err = new Error('Guest email is missing for arrival instructions');
    err.code = 'validation';
    err.status = 400;
    throw err;
  }

  const isResend = kind === 'resend';
  const isCorrection = kind === 'correction';
  if (kind !== 'send' && kind !== 'resend' && kind !== 'correction') {
    const err = new Error(`Unsupported arrival send kind: ${kind}`);
    err.code = 'validation';
    err.status = 400;
    throw err;
  }

  let idempotencyKey;
  try {
    if (isResend) {
      idempotencyKey = buildResendArrivalIdempotencyKey(booking._id, operationId);
    } else if (isCorrection) {
      idempotencyKey = buildCorrectionArrivalIdempotencyKey(booking._id, revision);
    } else {
      idempotencyKey = buildInitialArrivalIdempotencyKey(booking._id);
    }
  } catch (e) {
    const err = new Error(e.message || 'Invalid arrival idempotency input');
    err.code = 'validation';
    err.status = 400;
    throw err;
  }

  const resolvedLifecycleSource =
    lifecycleSource ||
    (isResend ? 'manual_resend' : isCorrection ? 'automatic' : 'manual_first_send');
  const resolvedRuleKey = isResend
    ? 'manual_arrival_resend'
    : isCorrection
      ? 'arrival_correction'
      : scheduledMessageJobId
        ? 'arrival_instructions_auto'
        : 'manual_arrival_send';
  const triggerKind = isResend ? 'resend' : isCorrection ? 'correction' : 'send';

  let existing = await MessageDispatch.findOne({ idempotencyKey }).lean();
  if (existing) {
    if (existing.status === 'accepted') {
      return mapExistingDispatch(existing);
    }
    if (existing.status === 'pending') {
      await openArrivalDispatchManualReview({
        bookingId: booking._id,
        dispatchId: existing._id,
        code: 'dispatch_pending_requires_review',
        message: 'A previous send attempt is still pending review; refusing duplicate SMTP'
      });
      return {
        ok: false,
        duplicate: true,
        uncertain: true,
        dispatchId: String(existing._id),
        status: 'pending',
        code: 'dispatch_pending_requires_review',
        message: 'A previous send attempt is still pending review; refusing duplicate SMTP'
      };
    }
    if (existing.status === 'failed' && !isDefinitivePreProviderFailure(existing)) {
      await openArrivalDispatchManualReview({
        bookingId: booking._id,
        dispatchId: existing._id,
        code: 'provider_outcome_uncertain',
        message:
          'Prior arrival dispatch has an uncertain or non-retriable failure; refusing duplicate SMTP until reconciled'
      });
      return {
        ...mapExistingDispatch(existing),
        ok: false,
        uncertain: true,
        code: 'provider_outcome_uncertain',
        message:
          'Prior arrival dispatch has an uncertain or non-retriable failure; refusing duplicate SMTP until reconciled'
      };
    }
    if (isDefinitivePreProviderFailure(existing)) {
      const reclaimed = await tryReclaimRetriableDispatch(existing, actor);
      if (!reclaimed) {
        // Lost race — re-read
        existing = await MessageDispatch.findOne({ idempotencyKey }).lean();
        if (existing?.status === 'accepted') return mapExistingDispatch(existing);
        if (existing?.status === 'pending') {
          return {
            ok: false,
            duplicate: true,
            uncertain: true,
            dispatchId: String(existing._id),
            status: 'pending',
            code: 'dispatch_pending_requires_review',
            message: 'A previous send attempt is still pending review; refusing duplicate SMTP'
          };
        }
        return mapExistingDispatch(existing);
      }
      return finishSendWithDispatch({
        dispatchId: reclaimed._id,
        idempotencyKey,
        booking,
        composed: null,
        recipient,
        triggerKind,
        actor,
        recompose: true
      });
    }
  }

  const composed = await composeArrivalGuestEmail({ booking, purpose: 'arrival' });
  if (!composed.ok) {
    const err = new Error(composed.message || 'Unable to compose arrival email');
    err.code = composed.code || 'validation';
    err.status = 400;
    err.details = composed.details || null;
    throw err;
  }

  const dispatchId = new mongoose.Types.ObjectId();

  try {
    await MessageDispatch.create({
      _id: dispatchId,
      scheduledMessageJobId: scheduledMessageJobId || null,
      bookingId: booking._id,
      ruleKey: resolvedRuleKey,
      templateKey: composed.templateKey,
      templateVersion: composed.templateVersion,
      channel: 'email',
      recipient,
      recipientChannelId: null,
      lifecycleSource: resolvedLifecycleSource,
      status: 'pending',
      providerName: 'postmark',
      providerMessageId: null,
      error: null,
      actorId: actor.id != null ? String(actor.id) : null,
      actorRole: actor.role != null ? String(actor.role) : null,
      idempotencyKey,
      details: {
        shadow: false,
        phase: 'reserved',
        retriable: true,
        propertyKind: composed.propertyKind,
        propertyName: composed.propertyName,
        arrivalEmailV2: true,
        kind,
        revision: isCorrection ? Number(revision) : null
      }
    });
  } catch (err) {
    if (err && (err.code === 11000 || /E11000/.test(String(err.message)))) {
      const winner = await MessageDispatch.findOne({ idempotencyKey }).lean();
      if (winner) {
        if (winner.status === 'accepted') return mapExistingDispatch(winner);
        if (winner.status === 'pending') {
          return {
            ok: false,
            duplicate: true,
            uncertain: true,
            dispatchId: String(winner._id),
            status: 'pending',
            code: 'dispatch_pending_requires_review',
            message: 'A previous send attempt is still pending review; refusing duplicate SMTP'
          };
        }
        if (isDefinitivePreProviderFailure(winner)) {
          const reclaimed = await tryReclaimRetriableDispatch(winner, actor);
          if (reclaimed) {
            return finishSendWithDispatch({
              dispatchId: reclaimed._id,
              idempotencyKey,
              booking,
              composed,
              recipient,
              triggerKind,
              actor,
              recompose: false
            });
          }
        }
        return mapExistingDispatch(winner);
      }
    }
    throw err;
  }

  return finishSendWithDispatch({
    dispatchId,
    idempotencyKey,
    booking,
    composed,
    recipient,
    triggerKind,
    actor,
    recompose: false
  });
}

async function markSupersededDuplicateReservation(dispatchId, winningDispatchId) {
  await MessageDispatch.updateOne(
    { _id: dispatchId, status: 'pending' },
    {
      $set: {
        status: 'failed',
        error: {
          code: 'superseded_duplicate_reservation',
          message: 'Another dispatch row owns SMTP for this idempotency key'
        },
        details: {
          shadow: false,
          phase: 'superseded_duplicate',
          retriable: false,
          reconciliation: 'not_needed',
          arrivalEmailV2: true,
          winningDispatchId: winningDispatchId ? String(winningDispatchId) : null
        }
      }
    }
  );
}

/**
 * Atomically claim the durable dispatch identity for a single provider call.
 *
 * Primary guarantee: unique idempotencyKey index → one reserved row.
 * Defense if that index is missing:
 *   1) If any row for the key is already accepted or phase=sending, losers
 *      supersede (do not let remaining reserved twins become a new winner).
 *   2) Otherwise only the lowest _id among reserved|reclaimed may claim.
 */
async function claimDispatchForSmtp({ dispatchId, idempotencyKey, body, recipient }) {
  const activeWinner = await MessageDispatch.findOne({
    idempotencyKey,
    $or: [
      { status: 'accepted' },
      { status: 'pending', 'details.phase': 'sending' }
    ]
  })
    .sort({ _id: 1 })
    .select({ _id: 1, status: 1, details: 1 })
    .lean();

  if (activeWinner) {
    if (String(activeWinner._id) !== String(dispatchId)) {
      await markSupersededDuplicateReservation(dispatchId, activeWinner._id);
      return { ok: false, reason: 'superseded', claimed: null };
    }
    // Our row is already sending/accepted — do not enter provider again.
    return { ok: false, reason: 'claim_lost' };
  }

  const canonical = await MessageDispatch.findOne({
    idempotencyKey,
    status: 'pending',
    'details.phase': { $in: ['reserved', 'reclaimed'] }
  })
    .sort({ _id: 1 })
    .select({ _id: 1 })
    .lean();

  if (!canonical) {
    return { ok: false, reason: 'claim_lost' };
  }

  if (String(canonical._id) !== String(dispatchId)) {
    await markSupersededDuplicateReservation(dispatchId, canonical._id);
    return { ok: false, reason: 'superseded', claimed: null };
  }

  const claimed = await MessageDispatch.findOneAndUpdate(
    {
      _id: dispatchId,
      idempotencyKey,
      status: 'pending',
      'details.phase': { $in: ['reserved', 'reclaimed'] }
    },
    {
      $set: {
        templateKey: body.templateKey,
        templateVersion: body.templateVersion,
        recipient,
        'details.phase': 'sending',
        'details.sendingAt': new Date(),
        'details.propertyKind': body.propertyKind,
        'details.propertyName': body.propertyName,
        'details.arrivalEmailV2': true,
        'details.retriable': true,
        'details.smtpClaimedByDispatchId': String(dispatchId)
      }
    },
    { new: true }
  );

  if (!claimed) {
    return { ok: false, reason: 'claim_lost' };
  }

  // Re-check: a twin may have been accepted, or another sender may have
  // claimed a different reserved row during our window. Only proceed if we
  // are still the sole sending/accepted row (lowest _id among actives).
  const activeAfter = await MessageDispatch.find({
    idempotencyKey,
    $or: [
      { status: 'accepted' },
      { status: 'pending', 'details.phase': 'sending' }
    ]
  })
    .sort({ _id: 1 })
    .select({ _id: 1 })
    .lean();

  if (
    activeAfter.length !== 1 ||
    String(activeAfter[0]._id) !== String(dispatchId)
  ) {
    // Roll back our claim if we are not the sole active owner.
    if (String(activeAfter[0]?._id) !== String(dispatchId)) {
      await MessageDispatch.updateOne(
        { _id: dispatchId, status: 'pending', 'details.phase': 'sending' },
        {
          $set: {
            status: 'failed',
            error: {
              code: 'superseded_duplicate_reservation',
              message: 'Lost SMTP ownership after claim race'
            },
            details: {
              shadow: false,
              phase: 'superseded_duplicate',
              retriable: false,
              reconciliation: 'not_needed',
              arrivalEmailV2: true,
              winningDispatchId: activeAfter[0] ? String(activeAfter[0]._id) : null
            }
          }
        }
      );
    }
    return { ok: false, reason: 'superseded', claimed: null };
  }

  return { ok: true, claimed };
}

async function finishSendWithDispatch({
  dispatchId,
  idempotencyKey,
  booking,
  composed,
  recipient,
  triggerKind,
  actor,
  recompose
}) {
  let body = composed;
  if (recompose || !body) {
    body = await composeArrivalGuestEmail({ booking, purpose: 'arrival' });
    if (!body.ok) {
      await MessageDispatch.updateOne(
        { _id: dispatchId },
        {
          $set: {
            status: 'failed',
            error: { code: body.code || 'compose_failed', message: body.message || 'compose failed' },
            details: {
              shadow: false,
              phase: 'pre_provider_failed',
              retriable: true,
              reconciliation: 'not_needed',
              arrivalEmailV2: true
            }
          }
        }
      );
      const err = new Error(body.message || 'Unable to compose arrival email');
      err.code = body.code || 'validation';
      err.status = 400;
      throw err;
    }
  }

  const claim = await claimDispatchForSmtp({
    dispatchId,
    idempotencyKey,
    body,
    recipient
  });
  if (!claim.ok) {
    const winner = await MessageDispatch.findOne({ idempotencyKey }).lean();
    if (winner?.status === 'accepted') return mapExistingDispatch(winner);
    if (winner?.status === 'pending') {
      return {
        ok: false,
        duplicate: true,
        uncertain: true,
        dispatchId: String(winner._id),
        status: 'pending',
        code: 'dispatch_pending_requires_review',
        message: 'A previous send attempt is still pending review; refusing duplicate SMTP'
      };
    }
    if (winner) return mapExistingDispatch(winner);
    return {
      ok: false,
      duplicate: true,
      dispatchId: String(dispatchId),
      status: 'failed',
      code: 'smtp_claim_lost',
      message: 'Lost SMTP claim for arrival dispatch identity'
    };
  }

  const sendDispatchId = claim.claimed._id;

  let sendResult;
  let enteredProviderCall = false;
  try {
    enteredProviderCall = true;
    sendResult = await emailService.sendEmail({
      to: recipient,
      subject: body.subject,
      html: body.html,
      text: body.text,
      trigger: `arrival_v2:${triggerKind || 'send'}:${String(sendDispatchId)}`,
      bookingId: String(booking._id),
      skipIdempotencyWindow: true,
      omitBodyFromLogs: true,
      postmarkTag: `dispatch:${String(sendDispatchId)}`,
      postmarkMetadata: {
        dispatchId: String(sendDispatchId),
        bookingId: String(booking._id),
        templateKey: body.templateKey,
        channel: 'email',
        arrivalEmailV2: '1'
      }
    });
  } catch (err) {
    // Ambiguous: provider may have accepted before the client saw the error.
    await markUncertainFailure(sendDispatchId, body, {
      code: 'provider_outcome_uncertain',
      message: err?.message || String(err)
    });
    await openArrivalDispatchManualReview({
      bookingId: booking._id,
      dispatchId: sendDispatchId,
      code: 'provider_outcome_uncertain',
      message: err?.message || 'Provider outcome uncertain after send started'
    });
    return {
      ok: false,
      uncertain: true,
      dispatchId: String(sendDispatchId),
      status: 'failed',
      code: 'provider_outcome_uncertain',
      message: err?.message || 'Provider outcome uncertain after send started'
    };
  }

  const classified = classifyEmailDeliveryResult(sendResult, {});

  if (classified.authoritativeDelivered) {
    const providerMessageId = classified.providerMessageId || sendResult.messageId || null;
    await MessageDispatch.updateOne(
      { _id: sendDispatchId },
      {
        $set: {
          status: 'accepted',
          providerName: 'postmark',
          providerMessageId,
          error: null,
          details: {
            shadow: false,
            phase: 'provider_call_accepted',
            retriable: false,
            propertyKind: body.propertyKind,
            propertyName: body.propertyName,
            arrivalEmailV2: true,
            classification: classified.classification
          }
        }
      }
    );
    return {
      ok: true,
      duplicate: false,
      dispatchId: String(sendDispatchId),
      status: 'accepted',
      providerMessageId,
      messageId: providerMessageId,
      authoritative: true,
      subject: body.subject,
      propertyKind: body.propertyKind,
      propertyName: body.propertyName
    };
  }

  const uncertain =
    enteredProviderCall &&
    (classified.classification === 'unknown' ||
      classified.classification === 'ambiguous' ||
      classified.reason === 'malformed_or_null_result');

  if (uncertain) {
    await markUncertainFailure(sendDispatchId, body, {
      code: 'provider_outcome_uncertain',
      message: classified.reason || sendResult?.error || 'Arrival email outcome uncertain',
      method: classified.method || sendResult?.method || null
    });
    await openArrivalDispatchManualReview({
      bookingId: booking._id,
      dispatchId: sendDispatchId,
      code: 'provider_outcome_uncertain',
      message: classified.reason || 'Arrival email outcome uncertain after provider call'
    });
    return {
      ok: false,
      duplicate: false,
      uncertain: true,
      dispatchId: String(sendDispatchId),
      status: 'failed',
      code: 'provider_outcome_uncertain',
      message: classified.reason || 'Arrival email outcome uncertain after provider call',
      classification: classified.classification,
      method: classified.method || sendResult?.method || null
    };
  }

  // Definitive non-delivery (logged / unavailable) is reclaimable; other failures need review.
  const retriable = await markDefinitiveFailure(sendDispatchId, body, classified, sendResult);
  if (!retriable) {
    await openArrivalDispatchManualReview({
      bookingId: booking._id,
      dispatchId: sendDispatchId,
      code: classified.classification || 'send_failed',
      message: classified.reason || 'Arrival email was not accepted by the provider'
    });
  }
  return {
    ok: false,
    duplicate: false,
    uncertain: !retriable,
    retriable,
    dispatchId: String(sendDispatchId),
    status: 'failed',
    code: classified.classification || classified.reason || 'send_failed',
    message: classified.reason || 'Arrival email was not accepted by the provider',
    classification: classified.classification,
    method: classified.method || sendResult?.method || null
  };
}

module.exports = {
  sendArrivalEmailV2,
  normalizeEmail,
  isDefinitivePreProviderFailure,
  tryReclaimRetriableDispatch
};
