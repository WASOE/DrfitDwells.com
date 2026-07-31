const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const EmailEvent = require('../models/EmailEvent');
const emailService = require('./emailService');
const {
  sanitizeManualResendHtml,
  derivePlainTextFromHtml,
  hashManualResendHtml
} = require('../utils/manualLifecycleResendContent');
const { bookingLifecycleCorrelationKey } = require('./email/emailDeliveryCorrelation');
const { applyEmailDeliveryAttempt } = require('./email/emailDeliveryStateService');
const { classifyEmailDeliveryResult } = require('./email/emailDeliveryResultContract');

const TEMPLATE_KEYS = {
  BOOKING_RECEIVED: 'booking_received',
  BOOKING_CONFIRMED: 'booking_confirmed',
  BOOKING_CANCELLED: 'booking_cancelled',
  BOOKING_RECEIVED_INTERNAL: 'booking_received_internal'
};

const TRIGGER_BY_TEMPLATE = {
  [TEMPLATE_KEYS.BOOKING_RECEIVED]: 'booking_received',
  [TEMPLATE_KEYS.BOOKING_CONFIRMED]: 'booking_confirmed',
  [TEMPLATE_KEYS.BOOKING_CANCELLED]: 'booking_cancelled',
  [TEMPLATE_KEYS.BOOKING_RECEIVED_INTERNAL]: 'booking_received_internal'
};

function isValidGuestTemplateKey(key) {
  return (
    key === TEMPLATE_KEYS.BOOKING_RECEIVED ||
    key === TEMPLATE_KEYS.BOOKING_CONFIRMED ||
    key === TEMPLATE_KEYS.BOOKING_CANCELLED
  );
}

async function loadEntityForBooking(booking) {
  if (booking.cabinId) {
    const id = booking.cabinId._id || booking.cabinId;
    const cabin = await Cabin.findById(id).lean();
    if (cabin) return cabin;
  }
  if (booking.cabinTypeId) {
    const id = booking.cabinTypeId._id || booking.cabinTypeId;
    const cabinType = await CabinType.findById(id).lean();
    if (cabinType) return cabinType;
  }
  return { name: 'Your stay', location: '' };
}

function normalizeRecipientOverride(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return s.toLowerCase();
}

function isPlausibleEmail(email) {
  if (!email || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function composePayload(templateKey, booking, entity) {
  if (templateKey === TEMPLATE_KEYS.BOOKING_RECEIVED) {
    return emailService.generateBookingReceivedEmail(booking, entity);
  }
  if (templateKey === TEMPLATE_KEYS.BOOKING_CONFIRMED) {
    return emailService.generateBookingConfirmedEmail(booking, entity);
  }
  if (templateKey === TEMPLATE_KEYS.BOOKING_CANCELLED) {
    return emailService.generateBookingCancelledEmail(booking, entity);
  }
  throw new Error(`Unknown templateKey: ${templateKey}`);
}

/**
 * Map emailService outcomes to EmailEvent sendStatus using the shared classifier.
 * Logged / unavailable / generic success are never EmailEvent success.
 */
function resolveSendStatus(sendResult, context = {}) {
  if (!sendResult) return { sendStatus: 'failed', deliveryMethod: 'unknown' };
  const classified = classifyEmailDeliveryResult(sendResult, context);
  const method = classified.method || sendResult.method || 'failed';

  if (classified.authoritativeDelivered) {
    return { sendStatus: 'success', deliveryMethod: 'sent', classification: classified };
  }
  if (classified.classification === 'skipped_duplicate' && classified.adoptPriorDelivery) {
    return { sendStatus: 'skipped', deliveryMethod: method, classification: classified };
  }
  if (classified.classification === 'skipped_duplicate') {
    return {
      sendStatus: 'failed',
      deliveryMethod: method,
      classification: classified,
      errorMessage: classified.reason
    };
  }
  return {
    sendStatus: 'failed',
    deliveryMethod: method || 'failed',
    classification: classified,
    errorMessage: classified.reason || sendResult.error || 'non_authoritative_delivery'
  };
}

async function persistLifecycleEmailEvent({
  bookingId,
  templateKey,
  lifecycleSource,
  emailTrigger,
  sendStatus,
  deliveryMethod,
  to,
  subject,
  overrideRecipientUsed,
  guestEmailAtSend,
  errorMessage,
  actorId,
  actorRole,
  messageId,
  manualEditDetails = null,
  deliveryCorrelationKey = null
}) {
  const doc = {
    provider: 'app',
    stream: 'transactional',
    type: 'LifecycleEmail',
    bookingId,
    to,
    subject,
    tag: `lifecycle:${templateKey}`,
    templateKey,
    lifecycleSource,
    emailTrigger,
    sendStatus,
    deliveryMethod,
    overrideRecipientUsed: Boolean(overrideRecipientUsed),
    guestEmailAtSend: guestEmailAtSend || undefined,
    errorMessage: errorMessage || undefined,
    actorId: actorId || undefined,
    actorRole: actorRole || undefined,
    details: {
      templateKey,
      lifecycleSource,
      emailTrigger,
      deliveryMethod,
      ...(manualEditDetails && typeof manualEditDetails === 'object' ? manualEditDetails : {})
    }
  };
  if (deliveryCorrelationKey) {
    doc.deliveryCorrelationKey = deliveryCorrelationKey;
  }
  if (messageId) {
    doc.messageId = messageId;
  }
  try {
    return await EmailEvent.create(doc);
  } catch (err) {
    if (err && err.code === 11000 && messageId) {
      delete doc.messageId;
      return await EmailEvent.create(doc);
    }
    throw err;
  }
}

/**
 * Guest-facing lifecycle templates only (not internal ops notification).
 */
async function sendBookingLifecycleEmail({
  booking,
  templateKey,
  overrideRecipient = null,
  lifecycleSource,
  actorContext = null,
  entity = null,
  manualContentOverride = null,
  /** Batch 6: confirmation delivery SM owns EmailDeliveryState; skip legacy apply. */
  skipDeliveryStateApply = false,
  /** Confirmation SM: invoked by emailService immediately before sendMail */
  onProviderAttemptStarted = null,
  /** When true, skipped-duplicate may map to EmailEvent skipped (prior delivery) */
  hasDefinitivePriorDelivery = false
}) {
  if (!booking?._id) {
    throw new Error('booking with _id is required');
  }
  if (!isValidGuestTemplateKey(templateKey)) {
    throw new Error(`Invalid templateKey: ${templateKey}`);
  }

  if (manualContentOverride != null) {
    if (lifecycleSource !== 'manual_resend') {
      const err = new Error('Manual content overrides are only allowed for manual resend');
      err.code = 'CONTENT_OVERRIDE_NOT_ALLOWED';
      throw err;
    }
    if (typeof manualContentOverride !== 'object') {
      const err = new Error('manualContentOverride must be an object');
      err.code = 'INVALID_MANUAL_EDIT';
      throw err;
    }
    const s = manualContentOverride.subject != null ? String(manualContentOverride.subject).trim() : '';
    const h = manualContentOverride.html != null ? String(manualContentOverride.html) : '';
    if (!s || !h.trim()) {
      const err = new Error('Edited subject and HTML are required for manual content override');
      err.code = 'INVALID_MANUAL_EDIT';
      throw err;
    }
  }

  const normalizedOverride = normalizeRecipientOverride(overrideRecipient);
  if (normalizedOverride && !isPlausibleEmail(normalizedOverride)) {
    const err = new Error('overrideRecipient must be a valid email address');
    err.code = 'INVALID_OVERRIDE_EMAIL';
    throw err;
  }

  const guestEmail = (booking.guestInfo?.email && String(booking.guestInfo.email).trim().toLowerCase()) || '';
  const recipient = normalizedOverride || guestEmail;
  if (!recipient) {
    const err = new Error('No recipient email available');
    err.code = 'MISSING_RECIPIENT';
    throw err;
  }

  const entityResolved = entity || (await loadEntityForBooking(booking));
  const basePayload = composePayload(templateKey, booking, entityResolved);
  const emailTrigger = TRIGGER_BY_TEMPLATE[templateKey];
  const skipIdempotencyWindow = lifecycleSource === 'manual_resend';

  let finalSubject = basePayload.subject;
  let finalHtml = basePayload.html;
  let finalText = basePayload.text;
  let manualEditDetails = null;

  if (manualContentOverride) {
    finalSubject = String(manualContentOverride.subject).trim();
    finalHtml = sanitizeManualResendHtml(String(manualContentOverride.html));
    finalText = derivePlainTextFromHtml(finalHtml);
    const defaultHtmlSanitized = sanitizeManualResendHtml(basePayload.html);
    const subjectEdited = finalSubject !== String(basePayload.subject).trim();
    const bodyEdited = finalHtml !== defaultHtmlSanitized;
    const manualContentEdited = subjectEdited || bodyEdited;
    manualEditDetails = {
      manualContentEdited,
      subjectEdited,
      bodyEdited,
      contentHash: hashManualResendHtml(finalHtml)
    };
  }

  const sendResult = await emailService.sendEmail({
    to: recipient,
    subject: finalSubject,
    html: finalHtml,
    text: finalText,
    trigger: emailTrigger,
    bookingId: booking._id,
    skipIdempotencyWindow,
    onProviderAttemptStarted:
      typeof onProviderAttemptStarted === 'function' ? onProviderAttemptStarted : null
  });

  const resolved = resolveSendStatus(sendResult, {
    hasDefinitivePriorDelivery: Boolean(hasDefinitivePriorDelivery)
  });
  const { sendStatus, deliveryMethod } = resolved;

  const deliveryCorrelationKey = bookingLifecycleCorrelationKey({
    bookingId: booking._id,
    templateKey,
    recipientEmail: recipient
  });

  let emailEvent;
  try {
    emailEvent = await persistLifecycleEmailEvent({
      bookingId: booking._id,
      templateKey,
      lifecycleSource,
      emailTrigger,
      sendStatus,
      deliveryMethod,
      to: recipient,
      subject: finalSubject,
      overrideRecipientUsed: Boolean(normalizedOverride),
      guestEmailAtSend: guestEmail || null,
      errorMessage:
        sendStatus === 'success'
          ? undefined
          : resolved.errorMessage || sendResult.error || undefined,
      actorId: actorContext?.actorId,
      actorRole: actorContext?.actorRole,
      messageId: sendStatus === 'success' ? sendResult.messageId : undefined,
      manualEditDetails,
      deliveryCorrelationKey
    });
  } catch (persistErr) {
    // If SMTP already accepted, persistence failure is uncertain for confirmation SM.
    if (resolved.classification?.authoritativeDelivered) {
      const err = persistErr instanceof Error ? persistErr : new Error(String(persistErr));
      err.code = 'EMAIL_EVENT_PERSIST_AFTER_SEND';
      err.providerAccepted = true;
      throw err;
    }
    throw persistErr;
  }

  if (!skipDeliveryStateApply) {
    await applyEmailDeliveryAttempt({
      correlationKey: deliveryCorrelationKey,
      domain: 'booking_lifecycle',
      bookingId: booking._id,
      templateKey,
      recipient,
      sendStatus,
      lifecycleSource,
      emailEventId: emailEvent?._id,
      errorMessage: sendStatus === 'success' ? undefined : resolved.errorMessage || sendResult.error,
      actorId: actorContext?.actorId,
      actorRole: actorContext?.actorRole
    });
  }

  return {
    success: sendStatus === 'success',
    method: sendResult.method || deliveryMethod,
    sendResult,
    emailEvent,
    recipient,
    templateKey,
    sendStatus,
    deliveryMethod,
    classification: resolved.classification || null
  };
}

/**
 * Internal new-booking notification (ops inbox). Logged to EmailEvent for the same bookingId.
 */
async function sendInternalNewBookingNotification({ booking, entity, lifecycleSource = 'automatic' }) {
  if (!booking?._id) {
    throw new Error('booking with _id is required');
  }
  const entityResolved = entity || (await loadEntityForBooking(booking));
  const internalEmail = emailService.generateInternalNotificationEmail(booking, entityResolved);
  const to = process.env.EMAIL_TO_INTERNAL || 'ops@driftdwells.com';
  const emailTrigger = TRIGGER_BY_TEMPLATE[TEMPLATE_KEYS.BOOKING_RECEIVED_INTERNAL];

  const sendResult = await emailService.sendEmail({
    to,
    subject: internalEmail.subject,
    html: internalEmail.html,
    text: internalEmail.text,
    trigger: emailTrigger,
    bookingId: booking._id,
    skipIdempotencyWindow: false
  });

  const resolvedInternal = resolveSendStatus(sendResult);
  const { sendStatus, deliveryMethod } = resolvedInternal;

  const emailEvent = await persistLifecycleEmailEvent({
    bookingId: booking._id,
    templateKey: TEMPLATE_KEYS.BOOKING_RECEIVED_INTERNAL,
    lifecycleSource,
    emailTrigger,
    sendStatus,
    deliveryMethod,
    to,
    subject: internalEmail.subject,
    overrideRecipientUsed: false,
    guestEmailAtSend: (booking.guestInfo?.email && String(booking.guestInfo.email).trim().toLowerCase()) || null,
    errorMessage:
      sendStatus === 'success'
        ? undefined
        : resolvedInternal.errorMessage || sendResult.error || undefined,
    actorId: undefined,
    actorRole: undefined,
    messageId: sendStatus === 'success' ? sendResult.messageId : undefined
  });

  return {
    success: sendStatus === 'success',
    method: sendResult.method || deliveryMethod,
    sendResult,
    emailEvent,
    sendStatus,
    deliveryMethod
  };
}

/**
 * Compose-only preview for guest lifecycle templates. No send, no EmailEvent, no recipient requirement.
 */
async function previewGuestLifecycleEmail({ booking, templateKey, entity = null }) {
  if (!booking?._id) {
    throw new Error('booking with _id is required');
  }
  if (!isValidGuestTemplateKey(templateKey)) {
    throw new Error(`Invalid templateKey: ${templateKey}`);
  }

  const entityResolved = entity || (await loadEntityForBooking(booking));
  const payload = composePayload(templateKey, booking, entityResolved);
  return {
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    templateKey
  };
}

module.exports = {
  TEMPLATE_KEYS,
  isValidGuestTemplateKey,
  loadEntityForBooking,
  sendBookingLifecycleEmail,
  previewGuestLifecycleEmail,
  sendInternalNewBookingNotification,
  /** Exported for `node:test` contract coverage of send-status mapping only. */
  resolveSendStatus
};
