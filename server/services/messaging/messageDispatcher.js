'use strict';

/**
 * MessageDispatcher.
 *
 * Processes ONE claimed `ScheduledMessageJob` at a time. The scheduler worker
 * (Batch 6) is the only caller. This module is the SOLE writer of
 * `MessageDispatch` rows for automatic sends.
 *
 * Provider abstraction (Batch 8 + Batch 9):
 *
 *   - Each provider declares `shadow: true | false`. Shadow providers cannot
 *     produce real sends; real providers do real I/O. The dispatcher reads
 *     `provider.shadow` and branches accordingly:
 *
 *       * Shadow path (Batch 8 semantics):
 *           - No outbox row.
 *           - Provider call → on success write a single `accepted`
 *             MessageDispatch with `providerName='internal'`,
 *             `providerMessageId=null`, `details.shadow=true`.
 *           - Retryable provider errors return without writing a row;
 *             the job is rescheduled with backoff.
 *
 *       * Real path (Batch 9 — email only):
 *           - OUTBOX: reserve a `MessageDispatch { status: 'pending' }` row
 *             BEFORE calling the provider. The dispatchId is pre-allocated so
 *             it can be stamped into Postmark tag/metadata for webhook
 *             correlation. If the row insert fails, the provider is NOT
 *             called.
 *           - Provider call → on success update the SAME row to `accepted`
 *             with `providerName='postmark'`, `providerMessageId=<id>`,
 *             `details.shadow=false`. On failure update the SAME row to
 *             `failed`. Never insert a second row for the same
 *             idempotencyKey.
 *           - In Batch 9 every real-provider error is non-retryable: once a
 *             pending/failed row exists for `(jobId, channel)` the dispatcher
 *             refuses to call the provider again. This prevents duplicate
 *             real emails when the worker crashes mid-send. OPS handles
 *             manual recovery.
 *
 * Public surface:
 *   - processClaimedJob(jobId)        // called by schedulerWorker after claim
 *   - __internals                      // exported for tests only
 *
 * Feature flag (default OFF):
 *   - `MESSAGE_DISPATCHER_ENABLED=1` → dispatcher runs on claimed jobs.
 *   - Email real vs shadow is chosen from `MessageAutomationRule.mode` AND
 *     `MESSAGE_EMAIL_PROVIDER_ENABLED`: for `mode: 'auto'`, real adapter only
 *     when the env flag is `'1'`; for `mode: 'shadow'`, always shadow email;
 *     `mode: 'manual_approve'` is handled in the dispatcher before any provider
 *     (no automatic sends until approval exists).
 *
 * Job status transitions (only writes terminal statuses when flag on AND
 * job is currently `claimed`):
 *   - any accepted MessageDispatch row → 'sent'
 *   - cancelled booking                → 'cancelled'
 *   - booking missing                  → 'failed'  + MRI dispatcher_processing_failed
 *   - status guard fail                → 'skipped_status_guard'
 *   - propertyKind mismatch / stale    → 'failed'  + MRI comms_property_mismatch_blocked
 *   - payment-proof guard fail         → 'failed'
 *   - all channels suppressed          → 'suppressed'
 *   - all channels no-consent          → 'skipped_no_consent'
 *   - template_not_available           → 'failed'  + MRI comms_template_not_approved
 *   - missing_required_variables       → 'failed'  + MRI comms_missing_variables
 *   - all channels skipped_no_recipient → 'failed'
 *   - retryable failure (SHADOW path)  → reschedule with backoff (or 'failed'
 *                                         if attemptCount hits maxAttempts)
 *   - real-provider failure            → terminal failed (no auto-retry)
 *
 * Idempotency (CRITICAL):
 *   - Automatic dispatches use:
 *       MessageDispatch.idempotencyKey = `${scheduledMessageJobId}:${channel}`
 *     This is STABLE across retries / backoff (the job _id never changes)
 *     so a retry of the same job cannot create a duplicate real send.
 *   - Existing-row handling for the same key:
 *       * accepted:    do not call provider; treat channel as successful.
 *       * pending:     do not call provider; mark job failed and open MRI
 *                      `comms_dispatcher_processing_failed`. The pending row
 *                      proves a previous worker started a real send and may
 *                      have already delivered it.
 *       * failed:      do not call provider; mark job failed.
 *       * skipped_*:   preserve the original skipped semantics (no resend).
 *   - Manual sends will use a different key shape (Batch 10).
 *
 * See:
 *   - docs/guest-message-automation/02_V1_SPEC.md §§17, 18, 20, 21, 24, 31
 *   - docs/guest-message-automation/03_IMPLEMENTATION_BATCHES.md Batch 8 & 9
 */

const mongoose = require('mongoose');

const ScheduledMessageJob = require('../../models/ScheduledMessageJob');
const MessageDispatch = require('../../models/MessageDispatch');
const MessageAutomationRule = require('../../models/MessageAutomationRule');
const Booking = require('../../models/Booking');
const Cabin = require('../../models/Cabin');
const CabinType = require('../../models/CabinType');
const GuestContactPreference = require('../../models/GuestContactPreference');

const {
  resolvePropertyKindFromCabinDoc,
  resolvePropertyKindFromCabinTypeDoc,
  PropertyKindUnresolvedError
} = require('./propertyKindResolver');
const { normaliseGuestPhoneRaw } = require('./phoneNormalisationService');
const { findApprovedTemplate } = require('./messageTemplateLookupService');
const { resolveVariables } = require('./messageVariableResolver');
const { getProviderForChannel } = require('./providers/providerRegistry');

const ENV_FLAG = 'MESSAGE_DISPATCHER_ENABLED';
const ENV_INTERNAL_EMAIL = 'EMAIL_TO_INTERNAL';

const BACKOFF_BASE_MS = 5 * 60_000;
const BACKOFF_CAP_MS = 30 * 60_000;

const MRI_PROCESSING_FAILED = 'comms_dispatcher_processing_failed';
const MRI_TEMPLATE_NOT_APPROVED = 'comms_template_not_approved';
const MRI_MISSING_VARIABLES = 'comms_missing_variables';
const MRI_PROPERTY_MISMATCH = 'comms_property_mismatch_blocked';

// Channel-level outcome strings used internally. Kept distinct from the
// MessageDispatch status enum so callers can carry retryable hints.
const CHANNEL_OUTCOME = Object.freeze({
  ACCEPTED: 'accepted',
  FAILED_NON_RETRYABLE: 'failed_non_retryable',
  FAILED_RETRYABLE: 'failed_retryable',
  SKIPPED_NO_RECIPIENT: 'skipped_no_recipient',
  SKIPPED_NO_CONSENT: 'skipped_no_consent',
  SKIPPED_SUPPRESSED: 'skipped_suppressed',
  SKIPPED_NO_CHANNEL_TEMPLATE: 'skipped_no_channel_template'
});

function isDispatcherEnabled() {
  return String(process.env[ENV_FLAG] || '').trim() === '1';
}

function logLine(level, phase, fields) {
  const payload = JSON.stringify({
    source: 'message-dispatcher',
    phase,
    ...fields
  });
  if (level === 'error') console.error(payload);
  else if (level === 'warn') console.warn(payload);
  else console.log(payload);
}

function computeBackoffMs(nextAttempt) {
  const idx = Math.max(0, nextAttempt - 1);
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, idx));
}

async function safeOpenManualReviewItem(params) {
  try {
    const { openManualReviewItem } = require('../ops/ingestion/manualReviewService');
    return await openManualReviewItem(params);
  } catch (err) {
    logLine('error', 'manual_review_item_open_failed', {
      category: params?.category,
      entityId: params?.entityId ? String(params.entityId) : null,
      error: err?.message || String(err)
    });
    return null;
  }
}

/**
 * Strict payment-proof guard (D-12). Mirrors the orchestrator's check so the
 * dispatcher rejects jobs whose underlying booking lost its payment proof
 * between scheduling and processing (very rare but possible).
 */
function passesPaymentProofGuard(booking) {
  if (!booking) return false;
  const method = booking.paymentMethod;
  const piId = typeof booking.stripePaymentIntentId === 'string'
    && booking.stripePaymentIntentId.trim().length > 0;
  const redemptionId = booking.giftVoucherRedemptionId != null;
  if (method === 'stripe' && piId) return true;
  if (method === 'stripe_plus_gift_voucher' && piId) return true;
  if (method === 'gift_voucher' && redemptionId) return true;
  return false;
}

function ruleScopeMatches(rule, propertyKind) {
  if (!rule?.propertyScope) return false;
  if (rule.propertyScope === 'any') return true;
  return rule.propertyScope === propertyKind;
}

async function resolveStayTarget(booking) {
  if (booking?.cabinId) {
    return Cabin.findById(booking.cabinId).lean();
  }
  if (booking?.cabinTypeId) {
    return CabinType.findById(booking.cabinTypeId).lean();
  }
  return null;
}

function resolveStayPropertyKind(stayTarget, stayKind) {
  if (!stayTarget) {
    throw new PropertyKindUnresolvedError(
      'Booking has neither cabinId nor cabinTypeId; cannot resolve propertyKind.',
      { reason: 'no_stay_target' }
    );
  }
  if (stayKind === 'cabin') return resolvePropertyKindFromCabinDoc(stayTarget);
  if (stayKind === 'cabinType') return resolvePropertyKindFromCabinTypeDoc(stayTarget);
  throw new PropertyKindUnresolvedError(
    `Unknown stayKind ${JSON.stringify(stayKind)}`,
    { reason: 'invalid_stay_kind' }
  );
}

function detectStayKind(booking) {
  if (booking?.cabinId) return 'cabin';
  if (booking?.cabinTypeId) return 'cabinType';
  return null;
}

/**
 * Resolve which channel attempts to make for a rule's channelStrategy.
 *
 * Returns an ordered list of `{ channel, strategy }` describing how to
 * react to failures:
 *   - strategy 'single'         → no fallback; outcome of this channel is
 *                                  the outcome of the job.
 *   - strategy 'primary'        → if outcome is a non-retryable skip/fail
 *                                  on this channel, the NEXT entry is the
 *                                  fallback channel.
 *   - strategy 'fallback'       → only reached if previous entry skipped/
 *                                  failed-non-retryably.
 *   - strategy 'parallel'       → run regardless of others' outcomes
 *                                  ("both" strategy).
 */
function planChannelAttempts(channelStrategy) {
  switch (channelStrategy) {
    case 'whatsapp_only':
      return [{ channel: 'whatsapp', strategy: 'single' }];
    case 'email_only':
      return [{ channel: 'email', strategy: 'single' }];
    case 'whatsapp_first_email_fallback':
      return [
        { channel: 'whatsapp', strategy: 'primary' },
        { channel: 'email', strategy: 'fallback' }
      ];
    case 'both':
      return [
        { channel: 'whatsapp', strategy: 'parallel' },
        { channel: 'email', strategy: 'parallel' }
      ];
    default:
      return [];
  }
}

async function loadGuestContactPreference(recipientType, recipientValue) {
  if (!recipientType || !recipientValue) return null;
  return GuestContactPreference
    .findOne({ recipientType, recipientValue: String(recipientValue).toLowerCase() })
    .lean();
}

/**
 * Transactional consent semantics for V1:
 *   - missing GuestContactPreference row = permissive
 *   - transactional === 'unknown'        = permissive
 *   - transactional === 'granted'        = permissive
 *   - transactional === 'denied'         = blocked
 *
 * Marketing is out of V1.
 */
function isTransactionalConsentBlocked(contactPref) {
  if (!contactPref) return false;
  return contactPref.transactional === 'denied';
}

function isSuppressed(contactPref) {
  return Boolean(contactPref?.suppressed);
}

/**
 * Idempotency key for AUTOMATIC dispatches. `jobId` is the durable unit of
 * work — it survives retries, backoff and `scheduledFor` updates, so a
 * retried job cannot generate a new key and accidentally trigger a duplicate
 * real send. Manual sends will use a different key shape (Batch 10).
 *
 * The legacy `ruleKey:bookingId:iso:channel` shape from Batch 8 is removed
 * because it failed this property: `scheduledFor` can move on retry.
 */
function buildIdempotencyKey({ jobId, channel }) {
  if (!jobId) throw new Error('buildIdempotencyKey: missing jobId');
  if (!channel) throw new Error('buildIdempotencyKey: missing channel');
  return `${String(jobId)}:${channel}`;
}

async function findExistingDispatch(idempotencyKey) {
  return MessageDispatch.findOne({ idempotencyKey }).lean();
}

/**
 * Attempt a single channel. This is the heart of the dispatcher. Returns a
 * structured outcome that the caller uses to decide job-level status.
 *
 * Returns: {
 *   outcome,                     // CHANNEL_OUTCOME.*
 *   retryable,                   // boolean
 *   dispatchRow,                 // the inserted/found MessageDispatch row (or null)
 *   errorCode,                   // when outcome is failure
 *   templateNotApproved,         // for MRI
 *   missingVariables             // for MRI
 * }
 */
/**
 * Map an existing-row status to the channel outcome the dispatcher should
 * return WITHOUT calling the provider. This is the durable-outbox safety net:
 * if any MessageDispatch row already exists for `(jobId, channel)`, we trust
 * it and refuse to send.
 */
function outcomeForExistingDispatch(existing) {
  switch (existing.status) {
    case 'accepted':
      return { outcome: CHANNEL_OUTCOME.ACCEPTED, retryable: false, dispatchRow: existing };
    case 'pending':
      // A previous worker started a real send and crashed (or is still
      // running concurrently — but a unique idempotencyKey forbids that).
      // We cannot tell whether the provider actually delivered. Refuse to
      // resend; the job will be marked failed and OPS will investigate.
      return {
        outcome: CHANNEL_OUTCOME.FAILED_NON_RETRYABLE,
        retryable: false,
        dispatchRow: existing,
        errorCode: 'dispatch_pending_requires_review',
        dispatcherProcessingFailed: { reason: 'pending_dispatch_found', dispatchId: String(existing._id) }
      };
    case 'failed':
      return {
        outcome: CHANNEL_OUTCOME.FAILED_NON_RETRYABLE,
        retryable: false,
        dispatchRow: existing,
        errorCode: existing.error?.code || 'previous_attempt_failed'
      };
    case 'skipped_no_recipient':
      return { outcome: CHANNEL_OUTCOME.SKIPPED_NO_RECIPIENT, retryable: false, dispatchRow: existing };
    case 'skipped_no_consent':
      return { outcome: CHANNEL_OUTCOME.SKIPPED_NO_CONSENT, retryable: false, dispatchRow: existing };
    case 'skipped_suppressed':
      return { outcome: CHANNEL_OUTCOME.SKIPPED_SUPPRESSED, retryable: false, dispatchRow: existing };
    case 'skipped_status_guard':
    case 'skipped_wrong_property':
      return {
        outcome: CHANNEL_OUTCOME.FAILED_NON_RETRYABLE,
        retryable: false,
        dispatchRow: existing,
        errorCode: existing.status
      };
    default:
      return {
        outcome: CHANNEL_OUTCOME.FAILED_NON_RETRYABLE,
        retryable: false,
        dispatchRow: existing,
        errorCode: 'unknown_existing_dispatch_status'
      };
  }
}

async function attemptChannel({
  job,
  rule,
  booking,
  stayTarget,
  propertyKind,
  channel
}) {
  const idempotencyKey = buildIdempotencyKey({ jobId: job._id, channel });

  const existing = await findExistingDispatch(idempotencyKey);
  if (existing) {
    logLine('log', 'existing_dispatch_short_circuit', {
      jobId: String(job._id), channel, idempotencyKey, existingStatus: existing.status
    });
    return outcomeForExistingDispatch(existing);
  }

  // Resolve recipient + contact preferences.
  const recipientInfo = await resolveRecipient({ channel, rule, booking });
  if (!recipientInfo.ok) {
    if (recipientInfo.outcome === CHANNEL_OUTCOME.SKIPPED_NO_RECIPIENT) {
      const row = await writeDispatchRow({
        job, rule, channel, propertyKind,
        recipient: recipientInfo.recipient || 'unknown',
        recipientChannelId: null,
        templateKey: rule.templateKeyByChannel?.[channel] || 'unknown',
        templateVersion: 1,
        status: 'skipped_no_recipient',
        idempotencyKey,
        error: { code: 'invalid_recipient', detail: recipientInfo.reason || null }
      });
      return { outcome: CHANNEL_OUTCOME.SKIPPED_NO_RECIPIENT, retryable: false, dispatchRow: row };
    }
    return { outcome: CHANNEL_OUTCOME.FAILED_NON_RETRYABLE, retryable: false, dispatchRow: null, errorCode: 'invalid_recipient' };
  }

  const { recipient, recipientType, contactPref } = recipientInfo;

  // Suppression / consent (guest audience only).
  if (rule.audience === 'guest') {
    if (isSuppressed(contactPref)) {
      const row = await writeDispatchRow({
        job, rule, channel, propertyKind,
        recipient, recipientChannelId: null,
        templateKey: rule.templateKeyByChannel?.[channel] || 'unknown',
        templateVersion: 1,
        status: 'skipped_suppressed',
        idempotencyKey,
        error: { code: 'suppressed', reason: contactPref?.suppressedReason || null }
      });
      return { outcome: CHANNEL_OUTCOME.SKIPPED_SUPPRESSED, retryable: false, dispatchRow: row };
    }
    if (isTransactionalConsentBlocked(contactPref)) {
      const row = await writeDispatchRow({
        job, rule, channel, propertyKind,
        recipient, recipientChannelId: null,
        templateKey: rule.templateKeyByChannel?.[channel] || 'unknown',
        templateVersion: 1,
        status: 'skipped_no_consent',
        idempotencyKey,
        error: { code: 'no_transactional_consent' }
      });
      return { outcome: CHANNEL_OUTCOME.SKIPPED_NO_CONSENT, retryable: false, dispatchRow: row };
    }
  }

  // Approved template lookup.
  const templateKey = rule.templateKeyByChannel?.[channel];
  if (!templateKey) {
    return { outcome: CHANNEL_OUTCOME.SKIPPED_NO_CHANNEL_TEMPLATE, retryable: false, dispatchRow: null, errorCode: 'no_channel_template_key' };
  }
  const lookup = await findApprovedTemplate({
    templateKey,
    channel,
    locale: 'en',
    propertyKind: rule.propertyScope === 'any' ? 'any' : propertyKind
  });
  if (!lookup.approved) {
    const row = await writeDispatchRow({
      job, rule, channel, propertyKind,
      recipient, recipientChannelId: null,
      templateKey, templateVersion: 1,
      status: 'failed',
      idempotencyKey,
      error: { code: 'template_not_available', draftCandidates: lookup.draftCandidates }
    });
    return {
      outcome: CHANNEL_OUTCOME.FAILED_NON_RETRYABLE,
      retryable: false,
      dispatchRow: row,
      errorCode: 'template_not_available',
      templateNotApproved: { templateKey, channel, draftCandidates: lookup.draftCandidates }
    };
  }
  const approvedTemplate = lookup.approved;

  // Variable resolution.
  const varResult = resolveVariables({ booking, stayTarget });
  if (!varResult.ok) {
    const row = await writeDispatchRow({
      job, rule, channel, propertyKind,
      recipient, recipientChannelId: null,
      templateKey, templateVersion: approvedTemplate.version,
      status: 'failed',
      idempotencyKey,
      error: { code: 'missing_required_variables', missing: varResult.missing }
    });
    return {
      outcome: CHANNEL_OUTCOME.FAILED_NON_RETRYABLE,
      retryable: false,
      dispatchRow: row,
      errorCode: 'missing_required_variables',
      missingVariables: { missing: varResult.missing, channel }
    };
  }
  const variables = varResult.variables;

  // Resolve provider and branch on `shadow` flag. Missing flag defaults to
  // shadow for safety — a provider that forgot to declare `shadow:false`
  // cannot accidentally send.
  const provider = getProviderForChannel(channel, { automationMode: rule.mode });
  const isRealProvider = provider && provider.shadow === false;

  if (!isRealProvider) {
    return attemptShadowChannel({
      job, rule, channel, propertyKind, idempotencyKey,
      recipient, recipientType, templateKey, approvedTemplate, variables, provider
    });
  }

  return attemptRealChannel({
    job, rule, channel, propertyKind, idempotencyKey,
    recipient, recipientType, templateKey, approvedTemplate, variables, provider
  });
}

/**
 * Shadow path: keep Batch 8 semantics. Provider call → write a single
 * `accepted` row on success; retryable errors do NOT write a row.
 */
async function attemptShadowChannel({
  job, rule, channel, propertyKind, idempotencyKey,
  recipient, recipientType, templateKey, approvedTemplate, variables, provider
}) {
  let providerResult;
  try {
    if (channel === 'whatsapp') {
      providerResult = await provider.sendTemplate({
        to: recipient,
        templateName: approvedTemplate.whatsappTemplateName || templateKey,
        locale: approvedTemplate.whatsappLocale || approvedTemplate.locale || 'en',
        variables
      });
    } else {
      providerResult = await provider.sendEmail({
        to: recipient,
        subject: renderTemplateString(approvedTemplate.emailSubject || templateKey, variables),
        html: renderTemplateString(approvedTemplate.emailBodyMarkup || '', variables)
      });
    }
  } catch (err) {
    const retryable = err?.retryable !== false && (err?.code === 'provider_unavailable' || err?.code === 'rate_limited' || err?.code === 'provider_throw' || err?.code == null);
    const errorCode = err?.code || (retryable ? 'provider_throw' : 'invalid_input');
    if (!retryable) {
      const row = await writeDispatchRow({
        job, rule, channel, propertyKind,
        recipient, recipientChannelId: null,
        templateKey, templateVersion: approvedTemplate.version,
        status: 'failed',
        idempotencyKey,
        error: { code: errorCode, message: err?.message || String(err) }
      });
      return { outcome: CHANNEL_OUTCOME.FAILED_NON_RETRYABLE, retryable: false, dispatchRow: row, errorCode };
    }
    // Retryable: do NOT write a row (the unique idempotencyKey would block
    // any future attempt). Surface the retryable signal so the whole job is
    // rescheduled with backoff.
    return { outcome: CHANNEL_OUTCOME.FAILED_RETRYABLE, retryable: true, dispatchRow: null, errorCode };
  }

  const row = await writeDispatchRow({
    job, rule, channel, propertyKind,
    recipient, recipientChannelId: recipientType === 'whatsapp_phone' ? recipient : null,
    templateKey, templateVersion: approvedTemplate.version,
    status: 'accepted',
    idempotencyKey,
    providerName: providerResult?.providerName || 'internal',
    providerMessageId: null,
    details: { shadow: true, providerStatus: providerResult?.providerStatus || 'shadow_accepted' }
  });
  return { outcome: CHANNEL_OUTCOME.ACCEPTED, retryable: false, dispatchRow: row };
}

/**
 * Real path (Batch 9 — email only). Implements the outbox pattern:
 *
 *   1. Pre-allocate `dispatchId = new ObjectId()`.
 *   2. Insert MessageDispatch { _id: dispatchId, status: 'pending', ... }.
 *      If the unique-key insert races a concurrent worker (E11000),
 *      short-circuit on the winning row.
 *   3. Call provider.sendEmail({ ..., dispatchId }). The adapter stamps
 *      `dispatch:<id>` Postmark tag + Metadata.dispatchId.
 *   4. On success: update SAME row → accepted + providerMessageId.
 *   5. On failure: update SAME row → failed. Job will be terminal failed.
 *      NO automatic retry: a duplicate real email is worse than a missed
 *      one. OPS handles manual recovery.
 */
async function attemptRealChannel({
  job, rule, channel, propertyKind, idempotencyKey,
  recipient, recipientType, templateKey, approvedTemplate, variables, provider
}) {
  const dispatchId = new mongoose.Types.ObjectId();
  const subject = renderTemplateString(approvedTemplate.emailSubject || templateKey, variables);
  const html = renderTemplateString(approvedTemplate.emailBodyMarkup || '', variables);

  // STEP 1: Insert the pending outbox row BEFORE the provider call.
  let pendingRow;
  try {
    pendingRow = await MessageDispatch.create({
      _id: dispatchId,
      scheduledMessageJobId: job?._id || null,
      bookingId: job?.bookingId || null,
      ruleKey: rule.ruleKey,
      templateKey,
      templateVersion: approvedTemplate.version,
      channel,
      recipient,
      recipientChannelId: recipientType === 'whatsapp_phone' ? recipient : null,
      lifecycleSource: 'automatic',
      status: 'pending',
      providerName: provider.PROVIDER_NAME || 'postmark',
      providerMessageId: null,
      error: null,
      idempotencyKey,
      details: { shadow: false, phase: 'provider_call_pending' }
    });
  } catch (err) {
    if (err && (err.code === 11000 || /E11000/.test(String(err.message)))) {
      const existing = await MessageDispatch.findOne({ idempotencyKey }).lean();
      logLine('warn', 'real_dispatch_race_existing_found', {
        jobId: String(job._id), channel, idempotencyKey, existingStatus: existing?.status || null
      });
      if (existing) return outcomeForExistingDispatch(existing);
    }
    throw err;
  }

  // STEP 2: Call the provider with the pre-stamped dispatchId.
  let providerResult;
  try {
    providerResult = await provider.sendEmail({
      to: recipient,
      subject,
      html,
      dispatchId,
      bookingId: job?.bookingId || null,
      ruleKey: rule.ruleKey,
      templateKey
    });
  } catch (err) {
    // STEP 3a: Provider failed → mark SAME row failed. Non-retryable in V1.
    const errorCode = err?.code || 'provider_throw';
    await MessageDispatch.updateOne(
      { _id: dispatchId, status: 'pending' },
      {
        $set: {
          status: 'failed',
          error: { code: errorCode, message: err?.message || String(err) },
          details: {
            ...(pendingRow?.details ? (pendingRow.toObject ? pendingRow.toObject().details : pendingRow.details) : {}),
            shadow: false,
            phase: 'provider_call_failed',
            providerStatus: errorCode
          }
        }
      }
    );
    const updated = await MessageDispatch.findById(dispatchId).lean();
    return {
      outcome: CHANNEL_OUTCOME.FAILED_NON_RETRYABLE,
      retryable: false,
      dispatchRow: updated,
      errorCode
    };
  }

  // STEP 3b: Provider succeeded → mark SAME row accepted.
  await MessageDispatch.updateOne(
    { _id: dispatchId, status: 'pending' },
    {
      $set: {
        status: 'accepted',
        providerName: providerResult?.providerName || provider.PROVIDER_NAME || 'postmark',
        providerMessageId: providerResult?.providerMessageId || null,
        error: null,
        details: {
          shadow: false,
          phase: 'provider_call_accepted',
          providerStatus: providerResult?.providerStatus || 'sent'
        }
      }
    }
  );
  const updated = await MessageDispatch.findById(dispatchId).lean();
  return { outcome: CHANNEL_OUTCOME.ACCEPTED, retryable: false, dispatchRow: updated };
}

/**
 * Minimal mustache-style `{{key}}` rendering. Pure: no `with`, no `eval`,
 * no nested lookups. The dispatcher's variables are the locked V1 keys.
 */
function renderTemplateString(template, variables) {
  if (typeof template !== 'string' || template.length === 0) return '';
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (m, key) => {
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      const v = variables[key];
      return v == null ? '' : String(v);
    }
    return '';
  });
}

async function resolveRecipient({ channel, rule, booking }) {
  // OPS audience: recipient is the internal address from env. No
  // GuestContactPreference lookup.
  if (rule.audience === 'ops') {
    const internal = (process.env[ENV_INTERNAL_EMAIL] || '').trim();
    if (channel === 'email') {
      if (!internal || !internal.includes('@')) {
        return { ok: false, outcome: CHANNEL_OUTCOME.SKIPPED_NO_RECIPIENT, reason: 'ops_internal_email_not_configured' };
      }
      return { ok: true, recipient: internal.toLowerCase(), recipientType: 'email', contactPref: null };
    }
    // OPS WhatsApp is not used in V1.
    return { ok: false, outcome: CHANNEL_OUTCOME.SKIPPED_NO_RECIPIENT, reason: 'ops_channel_not_supported' };
  }

  // Guest audience.
  if (channel === 'email') {
    const email = (booking?.guestInfo?.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return { ok: false, outcome: CHANNEL_OUTCOME.SKIPPED_NO_RECIPIENT, reason: 'no_guest_email' };
    }
    const contactPref = await loadGuestContactPreference('email', email);
    return { ok: true, recipient: email, recipientType: 'email', contactPref };
  }

  if (channel === 'whatsapp') {
    const phoneRaw = booking?.guestInfo?.phone || '';
    const normalised = normaliseGuestPhoneRaw(phoneRaw);
    if (normalised.phoneStatus !== 'valid' || !normalised.recipientValue) {
      return { ok: false, outcome: CHANNEL_OUTCOME.SKIPPED_NO_RECIPIENT, reason: 'invalid_whatsapp_phone' };
    }
    const contactPref = await loadGuestContactPreference('whatsapp_phone', normalised.recipientValue);
    return { ok: true, recipient: normalised.recipientValue, recipientType: 'whatsapp_phone', contactPref };
  }

  return { ok: false, outcome: CHANNEL_OUTCOME.SKIPPED_NO_RECIPIENT, reason: 'unknown_channel' };
}

async function writeDispatchRow({
  job, rule, channel, propertyKind,
  recipient, recipientChannelId,
  templateKey, templateVersion,
  status, idempotencyKey,
  providerName,
  providerMessageId,
  error,
  details
}) {
  const doc = {
    scheduledMessageJobId: job?._id || null,
    bookingId: job?.bookingId || null,
    ruleKey: rule.ruleKey,
    templateKey,
    templateVersion,
    channel,
    recipient,
    recipientChannelId: recipientChannelId || null,
    lifecycleSource: 'automatic',
    status,
    providerName: providerName || 'internal',
    providerMessageId: providerMessageId || null,
    error: error || null,
    actorId: null,
    actorRole: null,
    idempotencyKey,
    details: details || { shadow: true }
  };
  try {
    const created = await MessageDispatch.create(doc);
    return created.toObject ? created.toObject() : created;
  } catch (err) {
    if (err && (err.code === 11000 || /E11000/.test(String(err.message)))) {
      const existing = await MessageDispatch.findOne({ idempotencyKey }).lean();
      logLine('log', 'dispatch_row_duplicate_idempotency', {
        jobId: job?._id ? String(job._id) : null,
        channel, idempotencyKey
      });
      return existing;
    }
    throw err;
  }
}

/**
 * Aggregate per-channel outcomes into a single job status decision.
 */
function reduceChannelOutcomes(outcomes, channelStrategy) {
  const anyAccepted = outcomes.some((o) => o.outcome === CHANNEL_OUTCOME.ACCEPTED);
  if (anyAccepted) {
    return { kind: 'terminal', jobStatus: 'sent' };
  }
  const anyRetryable = outcomes.some((o) => o.retryable);
  if (anyRetryable) {
    const first = outcomes.find((o) => o.retryable);
    return { kind: 'retryable', errorCode: first?.errorCode || 'provider_throw' };
  }
  // All non-retryable. Pick the most-specific terminal job status.
  const codes = outcomes.map((o) => o.outcome);
  const allSuppressed = codes.length > 0 && codes.every((c) => c === CHANNEL_OUTCOME.SKIPPED_SUPPRESSED);
  if (allSuppressed) {
    return { kind: 'terminal', jobStatus: 'suppressed' };
  }
  const allNoConsent = codes.length > 0 && codes.every((c) => c === CHANNEL_OUTCOME.SKIPPED_NO_CONSENT || c === CHANNEL_OUTCOME.SKIPPED_SUPPRESSED);
  if (allNoConsent) {
    return { kind: 'terminal', jobStatus: 'skipped_no_consent' };
  }
  return { kind: 'terminal', jobStatus: 'failed' };
}

/**
 * Walk the channel attempt plan and stop early when strategy semantics
 * dictate. Returns the flat list of channel outcomes consumed.
 */
async function runChannelPlan({ job, rule, booking, stayTarget, propertyKind }) {
  const plan = planChannelAttempts(rule.channelStrategy);
  const outcomes = [];
  let primaryFailedNonRetryably = false;

  for (let i = 0; i < plan.length; i += 1) {
    const step = plan[i];
    if (step.strategy === 'fallback' && !primaryFailedNonRetryably) {
      // Skip fallback: primary succeeded or threw retryably (the job will
      // be retried as a whole, not the email fallback).
      continue;
    }
    const result = await attemptChannel({
      job, rule, booking, stayTarget, propertyKind,
      channel: step.channel
    });
    outcomes.push(result);

    if (step.strategy === 'primary') {
      if (result.outcome === CHANNEL_OUTCOME.ACCEPTED) {
        // Done; don't try fallback.
        return outcomes;
      }
      if (result.retryable) {
        // Retry the whole job (don't try fallback yet).
        return outcomes;
      }
      primaryFailedNonRetryably = true;
      continue;
    }
    if (step.strategy === 'single') {
      return outcomes;
    }
    // 'parallel' or 'fallback' (after primary failed): continue loop.
  }
  return outcomes;
}

/**
 * Transition a job's status atomically from 'claimed' to the requested
 * terminal status. Returns true if the update was applied, false if the
 * row was not in 'claimed' (lost the race).
 */
async function transitionClaimedJob({ jobId, $set }) {
  const r = await ScheduledMessageJob.updateOne(
    { _id: jobId, status: 'claimed' },
    {
      $set: {
        ...$set,
        claimedBy: null,
        claimedAt: null,
        visibilityTimeoutAt: null
      }
    }
  );
  return r.modifiedCount === 1;
}

async function rescheduleClaimedJobForRetry({ job, errorCode, now }) {
  const currentAttempt = Number.isFinite(job.attemptCount) ? job.attemptCount : 0;
  const cap = Number.isFinite(job.maxAttempts) && job.maxAttempts > 0 ? job.maxAttempts : 3;
  const nextAttempt = currentAttempt + 1;
  if (nextAttempt >= cap) {
    const ok = await transitionClaimedJob({
      jobId: job._id,
      $set: {
        status: 'failed',
        attemptCount: nextAttempt,
        lastError: `retryable_exhausted:${errorCode || 'unknown'}`
      }
    });
    logLine('warn', 'retry_exhausted_terminal_failed', {
      jobId: String(job._id),
      attemptCount: nextAttempt,
      errorCode: errorCode || null,
      applied: ok
    });
    return { rescheduled: false, terminal: 'failed', attemptCount: nextAttempt, applied: ok };
  }
  const backoffMs = computeBackoffMs(nextAttempt);
  const nextScheduledFor = new Date((now || new Date()).getTime() + backoffMs);
  const ok = await transitionClaimedJob({
    jobId: job._id,
    $set: {
      status: 'scheduled',
      attemptCount: nextAttempt,
      scheduledFor: nextScheduledFor,
      lastError: `retryable:${errorCode || 'unknown'}`
    }
  });
  logLine('log', 'retry_rescheduled', {
    jobId: String(job._id),
    attemptCount: nextAttempt,
    backoffMs,
    nextScheduledFor: nextScheduledFor.toISOString(),
    errorCode: errorCode || null,
    applied: ok
  });
  return { rescheduled: true, attemptCount: nextAttempt, applied: ok };
}

/**
 * Top-level entrypoint called by the scheduler worker. Does nothing when
 * the dispatcher flag is off — the job stays `claimed` and is reclaimed by
 * the existing visibility-timeout sweeper.
 */
async function processClaimedJob(jobId, options = {}) {
  if (!isDispatcherEnabled()) {
    return { ran: false, disabled: true };
  }
  if (jobId == null) return { ran: false, error: 'missing_job_id' };
  const now = options.now || new Date();

  const job = await ScheduledMessageJob.findById(jobId).lean();
  if (!job) {
    logLine('warn', 'job_not_found', { jobId: String(jobId) });
    return { ran: true, missing: true };
  }
  if (job.status !== 'claimed') {
    logLine('log', 'job_not_claimed_skip', { jobId: String(jobId), status: job.status });
    return { ran: true, skippedReason: 'not_claimed', status: job.status };
  }

  try {
    return await processClaimedJobInner({ job, now });
  } catch (err) {
    logLine('error', 'processing_failed', {
      jobId: String(jobId),
      error: err?.message || String(err),
      stack: err?.stack ? String(err.stack).split('\n').slice(0, 4).join(' | ') : null
    });
    // Top-level safety net: try to reschedule for retry. If that also fails,
    // leave the job claimed so the sweeper can reclaim it.
    try {
      const retry = await rescheduleClaimedJobForRetry({ job, errorCode: 'dispatcher_processing_failed', now });
      await safeOpenManualReviewItem({
        category: MRI_PROCESSING_FAILED,
        severity: 'high',
        entityType: 'ScheduledMessageJob',
        entityId: String(job._id),
        title: 'MessageDispatcher processing failed',
        details: err?.message || String(err),
        provenance: { source: 'message-dispatcher', sourceReference: 'processClaimedJob' },
        evidence: {
          ruleKey: job.ruleKey || null,
          bookingId: job.bookingId ? String(job.bookingId) : null,
          attemptCount: retry?.attemptCount ?? null
        }
      });
      return { ran: true, error: true, retry };
    } catch (innerErr) {
      logLine('error', 'processing_failed_fatal', {
        jobId: String(jobId),
        error: innerErr?.message || String(innerErr)
      });
      return { ran: true, error: true, fatal: true };
    }
  }
}

async function processClaimedJobInner({ job, now }) {
  // Resolve rule (live, current row — stale snapshots not re-honored here;
  // the spec treats `ruleVersionAtSchedule` as informational in V1).
  const rule = await MessageAutomationRule.findOne({ ruleKey: job.ruleKey }).lean();
  if (!rule) {
    await transitionClaimedJob({
      jobId: job._id,
      $set: { status: 'failed', lastError: 'rule_not_found' }
    });
    return { ran: true, terminal: 'failed', reason: 'rule_not_found' };
  }
  if (!rule.enabled) {
    await transitionClaimedJob({
      jobId: job._id,
      $set: { status: 'skipped_status_guard', lastError: 'rule_disabled_at_dispatch' }
    });
    return { ran: true, terminal: 'skipped_status_guard', reason: 'rule_disabled' };
  }

  if (rule.mode === 'manual_approve') {
    await transitionClaimedJob({
      jobId: job._id,
      $set: { status: 'failed', lastError: 'manual_approve_not_supported_yet' }
    });
    return { ran: true, terminal: 'failed', reason: 'manual_approve_not_supported_yet' };
  }

  // Load booking (or null for no-booking jobs, which V1 does not produce
  // but the schema allows).
  let booking = null;
  if (job.bookingId) {
    if (!mongoose.isValidObjectId(job.bookingId)) {
      await transitionClaimedJob({
        jobId: job._id,
        $set: { status: 'failed', lastError: 'invalid_booking_id' }
      });
      return { ran: true, terminal: 'failed', reason: 'invalid_booking_id' };
    }
    booking = await Booking.findById(job.bookingId).lean();
    if (!booking) {
      await transitionClaimedJob({
        jobId: job._id,
        $set: { status: 'failed', lastError: 'booking_missing' }
      });
      await safeOpenManualReviewItem({
        category: MRI_PROCESSING_FAILED,
        severity: 'high',
        entityType: 'ScheduledMessageJob',
        entityId: String(job._id),
        title: 'Booking missing at dispatch time',
        details: 'Booking referenced by ScheduledMessageJob no longer exists.',
        provenance: { source: 'message-dispatcher', sourceReference: 'booking_missing' },
        evidence: { ruleKey: job.ruleKey, bookingId: String(job.bookingId) }
      });
      return { ran: true, terminal: 'failed', reason: 'booking_missing' };
    }
    if (booking.status === 'cancelled') {
      await transitionClaimedJob({
        jobId: job._id,
        $set: { status: 'cancelled', lastError: 'booking_cancelled', cancelReason: 'booking_cancelled', cancelActor: 'dispatcher' }
      });
      return { ran: true, terminal: 'cancelled', reason: 'booking_cancelled' };
    }
    if (!Array.isArray(rule.requiredBookingStatus) || rule.requiredBookingStatus.length === 0 || !rule.requiredBookingStatus.includes(booking.status)) {
      await transitionClaimedJob({
        jobId: job._id,
        $set: { status: 'skipped_status_guard', lastError: `status_guard:${booking.status}` }
      });
      return { ran: true, terminal: 'skipped_status_guard', reason: 'status_guard' };
    }
    if (!passesPaymentProofGuard(booking)) {
      await transitionClaimedJob({
        jobId: job._id,
        $set: { status: 'failed', lastError: 'payment_proof_guard_blocked' }
      });
      return { ran: true, terminal: 'failed', reason: 'payment_proof_guard_blocked' };
    }
  }

  // Resolve propertyKind from the current stay target.
  const stayKind = detectStayKind(booking || {});
  let stayTarget = null;
  let propertyKind = null;
  if (booking) {
    try {
      stayTarget = await resolveStayTarget(booking);
      propertyKind = resolveStayPropertyKind(stayTarget, stayKind);
    } catch (err) {
      if (err instanceof PropertyKindUnresolvedError) {
        await transitionClaimedJob({
          jobId: job._id,
          $set: { status: 'failed', lastError: 'property_kind_unresolved' }
        });
        await safeOpenManualReviewItem({
          category: MRI_PROPERTY_MISMATCH,
          severity: 'high',
          entityType: 'ScheduledMessageJob',
          entityId: String(job._id),
          title: 'Booking propertyKind could not be resolved at dispatch',
          details: err.message,
          provenance: { source: 'message-dispatcher', sourceReference: 'property_kind_unresolved' },
          evidence: { ruleKey: job.ruleKey, bookingId: String(job.bookingId || '') }
        });
        return { ran: true, terminal: 'failed', reason: 'property_kind_unresolved' };
      }
      throw err;
    }
    if (!ruleScopeMatches(rule, propertyKind)) {
      await transitionClaimedJob({
        jobId: job._id,
        $set: { status: 'failed', lastError: `wrong_property_scope:${propertyKind}` }
      });
      await safeOpenManualReviewItem({
        category: MRI_PROPERTY_MISMATCH,
        severity: 'medium',
        entityType: 'ScheduledMessageJob',
        entityId: String(job._id),
        title: 'Rule scope no longer matches booking propertyKind',
        details: `rule.propertyScope=${rule.propertyScope}, propertyKind=${propertyKind}`,
        provenance: { source: 'message-dispatcher', sourceReference: 'wrong_property_scope' },
        evidence: { ruleKey: job.ruleKey, bookingId: String(job.bookingId || ''), propertyKind }
      });
      return { ran: true, terminal: 'failed', reason: 'wrong_property_scope' };
    }
    // Stale snapshot check: if the snapshot encoded a different propertyKind,
    // we consider the job stale and refuse to dispatch.
    const snapshotPk = job?.payloadSnapshot?.propertyKind;
    if (snapshotPk && snapshotPk !== propertyKind) {
      await transitionClaimedJob({
        jobId: job._id,
        $set: { status: 'failed', lastError: `stale_snapshot:${snapshotPk}->${propertyKind}` }
      });
      await safeOpenManualReviewItem({
        category: MRI_PROPERTY_MISMATCH,
        severity: 'medium',
        entityType: 'ScheduledMessageJob',
        entityId: String(job._id),
        title: 'Stale propertyKind snapshot at dispatch',
        details: `snapshot=${snapshotPk}, current=${propertyKind}`,
        provenance: { source: 'message-dispatcher', sourceReference: 'stale_snapshot' },
        evidence: { ruleKey: job.ruleKey, bookingId: String(job.bookingId || ''), snapshotPk, propertyKind }
      });
      return { ran: true, terminal: 'failed', reason: 'stale_snapshot' };
    }
  }

  // Run the channel plan.
  const outcomes = await runChannelPlan({ job, rule, booking, stayTarget, propertyKind });
  const decision = reduceChannelOutcomes(outcomes, rule.channelStrategy);

  // MRIs for template_not_available / missing_required_variables / the new
  // "pending dispatch found on retry" surface. The "once per rule/channel/day"
  // debouncing is deferred to a future batch when ManualReviewItem dedupe is
  // available.
  for (const o of outcomes) {
    if (o.templateNotApproved) {
      await safeOpenManualReviewItem({
        category: MRI_TEMPLATE_NOT_APPROVED,
        severity: 'medium',
        entityType: 'ScheduledMessageJob',
        entityId: String(job._id),
        title: 'Approved template missing for rule channel',
        details: `templateKey=${o.templateNotApproved.templateKey}, channel=${o.templateNotApproved.channel}, drafts=${o.templateNotApproved.draftCandidates}`,
        provenance: { source: 'message-dispatcher', sourceReference: 'template_not_available' },
        evidence: { ruleKey: rule.ruleKey, ...o.templateNotApproved }
      });
    }
    if (o.missingVariables) {
      await safeOpenManualReviewItem({
        category: MRI_MISSING_VARIABLES,
        severity: 'medium',
        entityType: 'ScheduledMessageJob',
        entityId: String(job._id),
        title: 'Required template variables missing at dispatch',
        details: `missing=${(o.missingVariables.missing || []).join(',')}, channel=${o.missingVariables.channel}`,
        provenance: { source: 'message-dispatcher', sourceReference: 'missing_required_variables' },
        evidence: { ruleKey: rule.ruleKey, ...o.missingVariables }
      });
    }
    if (o.dispatcherProcessingFailed) {
      // Batch 9: a pending dispatch row was found at attempt time. We do not
      // know whether the previous worker's provider call delivered the
      // message; refusing to resend is the conservative choice. OPS must
      // investigate.
      await safeOpenManualReviewItem({
        category: MRI_PROCESSING_FAILED,
        severity: 'high',
        entityType: 'ScheduledMessageJob',
        entityId: String(job._id),
        title: 'Pending MessageDispatch found at retry — manual review required',
        details: `${o.dispatcherProcessingFailed.reason}; dispatchId=${o.dispatcherProcessingFailed.dispatchId || ''}`,
        provenance: { source: 'message-dispatcher', sourceReference: 'dispatch_pending_requires_review' },
        evidence: {
          ruleKey: rule.ruleKey,
          bookingId: job.bookingId ? String(job.bookingId) : null,
          dispatchId: o.dispatcherProcessingFailed.dispatchId || null
        }
      });
    }
  }

  if (decision.kind === 'retryable') {
    const retry = await rescheduleClaimedJobForRetry({ job, errorCode: decision.errorCode, now });
    return { ran: true, terminal: retry.terminal || null, retry, outcomes };
  }

  // Terminal job status.
  const applied = await transitionClaimedJob({
    jobId: job._id,
    $set: {
      status: decision.jobStatus,
      lastError: decision.jobStatus === 'sent' ? null : (outcomes.find((o) => o.errorCode)?.errorCode || decision.jobStatus)
    }
  });
  logLine('log', 'job_terminal', {
    jobId: String(job._id),
    ruleKey: rule.ruleKey,
    jobStatus: decision.jobStatus,
    applied,
    channelOutcomes: outcomes.map((o) => o.outcome)
  });
  return { ran: true, terminal: decision.jobStatus, applied, outcomes };
}

module.exports = {
  processClaimedJob,
  isDispatcherEnabled,
  ENV_FLAG,
  ENV_INTERNAL_EMAIL,
  // Exposed for tests only. Treat as internal.
  __internals: {
    passesPaymentProofGuard,
    planChannelAttempts,
    reduceChannelOutcomes,
    buildIdempotencyKey,
    renderTemplateString,
    computeBackoffMs,
    isTransactionalConsentBlocked,
    isSuppressed,
    attemptChannel,
    attemptShadowChannel,
    attemptRealChannel,
    outcomeForExistingDispatch,
    resolveRecipient,
    rescheduleClaimedJobForRetry,
    CHANNEL_OUTCOME,
    MRI_TEMPLATE_NOT_APPROVED,
    MRI_MISSING_VARIABLES,
    MRI_PROPERTY_MISMATCH,
    MRI_PROCESSING_FAILED
  }
};
