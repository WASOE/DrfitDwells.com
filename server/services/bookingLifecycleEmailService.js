const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const EmailEvent = require('../models/EmailEvent');
const emailService = require('./emailService');

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

function resolveSendStatus(sendResult) {
  if (!sendResult) return { sendStatus: 'failed', deliveryMethod: 'unknown' };
  if (sendResult.success && sendResult.method === 'skipped-duplicate') {
    return { sendStatus: 'skipped', deliveryMethod: sendResult.method };
  }
  if (sendResult.success) {
    return { sendStatus: 'success', deliveryMethod: sendResult.method || 'sent' };
  }
  return { sendStatus: 'failed', deliveryMethod: sendResult.method || 'failed' };
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
  messageId
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
      deliveryMethod
    }
  };
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
  entity = null
}) {
  if (!booking?._id) {
    throw new Error('booking with _id is required');
  }
  if (!isValidGuestTemplateKey(templateKey)) {
    throw new Error(`Invalid templateKey: ${templateKey}`);
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
  const payload = composePayload(templateKey, booking, entityResolved);
  const emailTrigger = TRIGGER_BY_TEMPLATE[templateKey];
  const skipIdempotencyWindow = lifecycleSource === 'manual_resend';

  const sendResult = await emailService.sendEmail({
    to: recipient,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    trigger: emailTrigger,
    bookingId: booking._id,
    skipIdempotencyWindow
  });

  const { sendStatus, deliveryMethod } = resolveSendStatus(sendResult);

  const emailEvent = await persistLifecycleEmailEvent({
    bookingId: booking._id,
    templateKey,
    lifecycleSource,
    emailTrigger,
    sendStatus,
    deliveryMethod,
    to: recipient,
    subject: payload.subject,
    overrideRecipientUsed: Boolean(normalizedOverride),
    guestEmailAtSend: guestEmail || null,
    errorMessage: sendResult.success ? undefined : sendResult.error,
    actorId: actorContext?.actorId,
    actorRole: actorContext?.actorRole,
    messageId: sendResult.messageId
  });

  return {
    success: sendResult.success,
    method: sendResult.method || deliveryMethod,
    sendResult,
    emailEvent,
    recipient,
    templateKey,
    sendStatus,
    deliveryMethod
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
    errorMessage: sendResult.success ? undefined : sendResult.error,
    actorId: undefined,
    actorRole: undefined,
    messageId: sendResult.messageId
  });

  return {
    success: sendResult.success,
    method: sendResult.method || deliveryMethod,
    sendResult,
    emailEvent
  };
}

module.exports = {
  TEMPLATE_KEYS,
  isValidGuestTemplateKey,
  loadEntityForBooking,
  sendBookingLifecycleEmail,
  sendInternalNewBookingNotification
};
