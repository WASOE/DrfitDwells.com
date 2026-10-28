'use strict';

/**
 * Read-only report of checkout sessions and PaymentIntents in a UTC window
 * that do not have a finalized booking.
 *
 * Mutation, refund, cancel, capture, finalize, and email are rejected.
 * A future write mode requires an explicit flag and a separately reviewed task.
 * Output is an allowlist. Guest PII and Stripe client secrets are dropped.
 */

const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const FINALIZED_BOOKING_STATUSES = new Set(['confirmed', 'in_house', 'completed']);
const CLASSIFICATIONS = new Set([
  'succeeded',
  'processing',
  'requires_action',
  'requires_payment_method',
  'cancelled',
  'unknown'
]);

const MUTATION_FLAGS = [
  'execute',
  'mutate',
  'refund',
  'cancel',
  'capture',
  'finalize',
  'email',
  'write'
];

function mutationRequested(options = {}) {
  return MUTATION_FLAGS.some((flag) => options[flag] === true);
}

function assertReadOnly(options = {}) {
  if (!mutationRequested(options)) return;
  const err = new Error(
    'This report is read-only. Refund, cancel, capture, finalize, email, and other mutations are not implemented. Any future mutation capability requires an explicit flag and a separately reviewed task.'
  );
  err.code = 'MUTATION_NOT_PERMITTED';
  throw err;
}

function parseUtcInstant(value, label) {
  if (value == null || String(value).trim() === '') {
    const err = new Error(`${label} is required (UTC ISO-8601).`);
    err.code = 'INVALID_WINDOW';
    throw err;
  }
  const text = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00.000Z` : text;
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(normalized)) {
    const err = new Error(`${label} must be UTC (Z or an explicit offset).`);
    err.code = 'INVALID_WINDOW';
    throw err;
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    const err = new Error(`${label} is not a valid timestamp.`);
    err.code = 'INVALID_WINDOW';
    throw err;
  }
  return date;
}

function assertWindow(since, until) {
  if (since.getTime() >= until.getTime()) {
    const err = new Error('since must be earlier than until.');
    err.code = 'INVALID_WINDOW';
    throw err;
  }
  if (until.getTime() - since.getTime() > MAX_WINDOW_MS) {
    const err = new Error('The UTC window must be 7 days or less.');
    err.code = 'INVALID_WINDOW';
    throw err;
  }
}

function classifyStripeStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'succeeded') return 'succeeded';
  if (value === 'processing') return 'processing';
  if (value === 'requires_action') return 'requires_action';
  if (value === 'requires_payment_method') return 'requires_payment_method';
  if (value === 'canceled' || value === 'cancelled') return 'cancelled';
  return 'unknown';
}

function safeId(value, prefix) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) return null;
  if (prefix && !trimmed.startsWith(prefix)) return null;
  if (!/^[A-Za-z0-9:_-]+$/.test(trimmed)) return null;
  return trimmed;
}

function safeBookingStatus(value) {
  const text = String(value || '').trim();
  if (['pending', 'confirmed', 'in_house', 'completed', 'cancelled'].includes(text)) return text;
  return null;
}

function isFinalizedBooking(booking) {
  return FINALIZED_BOOKING_STATUSES.has(safeBookingStatus(booking?.status));
}

function safeTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function unixSecondsToIso(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function emptyCounts() {
  return {
    succeeded: 0,
    processing: 0,
    requires_action: 0,
    requires_payment_method: 0,
    cancelled: 0,
    unknown: 0
  };
}

/**
 * @param {object} options
 * @param {string} options.since
 * @param {string} options.until
 * @param {{ listCreatedBetween: Function }} options.checkoutSessionSource
 * @param {{ listByCheckoutOrPaymentIntent: Function }} options.bookingSource
 * @param {{ listCreatedBetween: Function }} [options.paymentIntentSource]
 */
async function buildUnfinalizedCheckoutPaymentReport(options = {}) {
  assertReadOnly(options);
  const since = parseUtcInstant(options.since, 'since');
  const until = parseUtcInstant(options.until, 'until');
  assertWindow(since, until);

  const sessions = await options.checkoutSessionSource.listCreatedBetween({ since, until });
  const paymentIntents = options.paymentIntentSource
    ? await options.paymentIntentSource.listCreatedBetween({ since, until })
    : [];

  const sessionList = Array.isArray(sessions) ? sessions : [];
  const intentList = Array.isArray(paymentIntents) ? paymentIntents : [];

  const checkoutIds = new Set();
  const paymentIntentIds = new Set();
  for (const session of sessionList) {
    const checkoutId = safeId(session?.checkoutId, 'chk_') || safeId(session?.checkoutId);
    if (checkoutId) checkoutIds.add(checkoutId);
    const pi = safeId(session?.canonicalPaymentIntentId, 'pi_');
    if (pi) paymentIntentIds.add(pi);
  }
  for (const intent of intentList) {
    const pi = safeId(intent?.id, 'pi_') || safeId(intent?.paymentIntentId, 'pi_');
    if (pi) paymentIntentIds.add(pi);
  }

  const bookings = await options.bookingSource.listByCheckoutOrPaymentIntent({
    checkoutIds: [...checkoutIds],
    paymentIntentIds: [...paymentIntentIds]
  });
  const bookingList = Array.isArray(bookings) ? bookings : [];

  const finalizedCheckouts = new Set();
  const finalizedIntents = new Set();
  for (const booking of bookingList) {
    if (!isFinalizedBooking(booking)) continue;
    const checkoutId = safeId(booking.checkoutId);
    if (checkoutId) finalizedCheckouts.add(checkoutId);
    const pi = safeId(booking.stripePaymentIntentId, 'pi_');
    if (pi) finalizedIntents.add(pi);
  }

  const intentById = new Map();
  for (const intent of intentList) {
    const pi = safeId(intent?.id, 'pi_') || safeId(intent?.paymentIntentId, 'pi_');
    if (pi) intentById.set(pi, intent);
  }

  const records = [];
  const seen = new Set();
  const seenIntents = new Set();

  function pushRecord({ checkoutId, paymentIntentId, stripeStatus, createdAt }) {
    if (paymentIntentId && seenIntents.has(paymentIntentId)) return;
    const key = `${checkoutId || ''}|${paymentIntentId || ''}`;
    if (seen.has(key)) return;
    if (checkoutId && finalizedCheckouts.has(checkoutId)) return;
    if (paymentIntentId && finalizedIntents.has(paymentIntentId)) return;
    seen.add(key);
    if (paymentIntentId) seenIntents.add(paymentIntentId);
    const classification = classifyStripeStatus(stripeStatus);
    records.push({
      checkoutId: checkoutId || null,
      paymentIntentId: paymentIntentId || null,
      classification,
      stripeStatus: classification === 'unknown' ? null : classification === 'cancelled' ? 'canceled' : classification,
      bookingFinalized: false,
      createdAt: createdAt || null
    });
  }

  for (const session of sessionList) {
    const checkoutId = safeId(session?.checkoutId);
    const paymentIntentId = safeId(session?.canonicalPaymentIntentId, 'pi_');
    const intent = paymentIntentId ? intentById.get(paymentIntentId) : null;
    pushRecord({
      checkoutId,
      paymentIntentId,
      stripeStatus: intent?.status || session?.stripeStatus || null,
      createdAt: safeTimestamp(session?.createdAt)
    });
  }

  for (const intent of intentList) {
    const paymentIntentId = safeId(intent?.id, 'pi_') || safeId(intent?.paymentIntentId, 'pi_');
    pushRecord({
      checkoutId: safeId(intent?.checkoutId),
      paymentIntentId,
      stripeStatus: intent?.status || null,
      createdAt: safeTimestamp(intent?.createdAt) || unixSecondsToIso(intent?.created)
    });
  }

  const counts = emptyCounts();
  for (const record of records) counts[record.classification] += 1;

  return {
    ok: true,
    mode: 'read_only',
    mutated: false,
    mutationImplemented: false,
    window: { since: since.toISOString(), until: until.toISOString() },
    counts,
    records
  };
}

module.exports = {
  MAX_WINDOW_MS,
  CLASSIFICATIONS,
  classifyStripeStatus,
  assertReadOnly,
  buildUnfinalizedCheckoutPaymentReport
};
