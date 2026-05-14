'use strict';

/**
 * messageDeliveryEventIngest (Batch 9)
 *
 * Normalises ONE Postmark webhook payload that belongs to the message
 * automation system into a `MessageDeliveryEvent` upsert. Called only from
 * the `dispatch:*` / `Metadata.dispatchId` branch of `emailWebhookRoutes`.
 *
 * Hard contract:
 *
 *   - Never writes to `EmailEvent`. Never imports `EmailEvent`.
 *   - Never reads `MessageDispatch` (correlation is by `dispatchId`
 *     embedded in the Postmark tag/metadata; no DB lookup needed).
 *   - `providerEventId` is clock-free. It is composed exclusively from
 *     stable fields in the provider payload:
 *       * Bounce / SpamComplaint        → `String(body.ID)` (Postmark's
 *                                          unique numeric event id).
 *       * Other record types            → `${MessageID}:${RecordType}:${ts}`
 *                                          where `ts` is the FIRST present
 *                                          stable timestamp from the payload
 *                                          (DeliveredAt, BouncedAt, OpenedAt,
 *                                          ClickedAt, ReceivedAt,
 *                                          ReceivedAtUtc, ReceivedAtLocal).
 *       * Fallback (no timestamp)       → `${MessageID}:${RecordType}:${sha256(safeSlice)}`.
 *     `new Date()` is never part of `providerEventId`.
 *   - Idempotent: the unique `(provider, providerEventId)` index in
 *     `MessageDeliveryEvent` means re-deliveries of the same Postmark event
 *     are silently absorbed.
 *
 * Returns `{ ingested: boolean, eventType: string|null, duplicate: boolean,
 * reason?: string }`. Never throws.
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
const MessageDeliveryEvent = require('../../models/MessageDeliveryEvent');

const STABLE_TIMESTAMP_FIELDS = Object.freeze([
  'DeliveredAt',
  'BouncedAt',
  'OpenedAt',
  'ClickedAt',
  'ReceivedAt',
  'ReceivedAtUtc',
  'ReceivedAtLocal'
]);

const RECORD_TYPE_MAP = Object.freeze({
  Delivery: { eventType: 'delivered', isTerminal: true },
  Open: { eventType: 'opened', isTerminal: false },
  FirstOpen: { eventType: 'opened', isTerminal: false },
  Click: { eventType: 'clicked', isTerminal: false },
  Bounce: { eventType: 'bounced', isTerminal: true },
  SpamComplaint: { eventType: 'spam_complaint', isTerminal: true }
});

function isValidObjectIdString(s) {
  return typeof s === 'string' && /^[0-9a-fA-F]{24}$/.test(s);
}

function safeString(v) {
  if (v == null) return '';
  return typeof v === 'string' ? v : String(v);
}

function pickStableTimestampString(body) {
  for (const field of STABLE_TIMESTAMP_FIELDS) {
    const v = body?.[field];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

function safePayloadSliceForHash(body) {
  return {
    RecordType: safeString(body?.RecordType || body?.Type),
    MessageID: safeString(body?.MessageID || body?.MessageId),
    MessageStream: safeString(body?.MessageStream),
    Description: safeString(body?.Description),
    BounceType: safeString(body?.BounceType),
    BounceSubtype: safeString(body?.BounceSubtype),
    SuppressSending: Boolean(body?.SuppressSending),
    MetadataDigest: body && body.Metadata
      ? crypto.createHash('sha256').update(JSON.stringify(body.Metadata)).digest('hex')
      : ''
  };
}

function computeProviderEventId(body, recordType) {
  if ((recordType === 'Bounce' || recordType === 'SpamComplaint') && Number.isFinite(body?.ID)) {
    return String(body.ID);
  }
  const messageId = safeString(body?.MessageID || body?.MessageId);
  const ts = pickStableTimestampString(body);
  if (messageId && ts) {
    return `${messageId}:${recordType}:${ts}`;
  }
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify(safePayloadSliceForHash(body)))
    .digest('hex');
  return `${messageId || 'unknown'}:${recordType}:${digest}`;
}

function computeOccurredAt(body) {
  const ts = pickStableTimestampString(body);
  if (ts) {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) return d;
  }
  // Storage-only fallback. `occurredAt` is required by the schema but does
  // NOT participate in `providerEventId`, so idempotency is preserved.
  return new Date();
}

function safePayload(body, recordType) {
  return {
    recordType,
    messageStream: safeString(body?.MessageStream),
    bounceType: safeString(body?.BounceType),
    bounceSubtype: safeString(body?.BounceSubtype),
    description: safeString(body?.Description),
    suppressSending: Boolean(body?.SuppressSending),
    metadata: body && body.Metadata && typeof body.Metadata === 'object' ? body.Metadata : null
  };
}

function logLine(level, phase, fields) {
  const payload = JSON.stringify({
    source: 'messaging-webhook-ingest',
    provider: 'postmark',
    phase,
    ...fields
  });
  if (level === 'error') console.error(payload);
  else if (level === 'warn') console.warn(payload);
  else console.log(payload);
}

/**
 * Extract a 24-hex ObjectId string from the Postmark tag / metadata namespace,
 * or `null` if neither is present in the expected shape.
 */
function extractDispatchId(body) {
  const tag = safeString(body?.Tag || (body?.Message && body.Message.Tag));
  if (tag.startsWith('dispatch:')) {
    const candidate = tag.slice('dispatch:'.length);
    if (isValidObjectIdString(candidate)) return candidate;
  }
  const meta = body?.Metadata;
  if (meta && typeof meta.dispatchId === 'string' && isValidObjectIdString(meta.dispatchId)) {
    return meta.dispatchId;
  }
  return null;
}

async function ingestPostmarkEvent(body) {
  if (!body || typeof body !== 'object') {
    logLine('warn', 'invalid_body', {});
    return { ingested: false, eventType: null, duplicate: false, reason: 'invalid_body' };
  }
  const dispatchId = extractDispatchId(body);
  if (!dispatchId) {
    logLine('warn', 'no_dispatch_id', {});
    return { ingested: false, eventType: null, duplicate: false, reason: 'no_dispatch_id' };
  }

  const recordType = safeString(body?.RecordType || body?.Type);
  const mapping = RECORD_TYPE_MAP[recordType];
  if (!mapping) {
    logLine('log', 'unmapped_record_type', { recordType, dispatchId });
    return { ingested: false, eventType: null, duplicate: false, reason: 'unmapped_record_type' };
  }

  const providerEventId = computeProviderEventId(body, recordType);
  const occurredAt = computeOccurredAt(body);
  const providerMessageId = safeString(body?.MessageID || body?.MessageId) || null;
  const meta = body?.Metadata;
  const bookingId = meta && typeof meta.bookingId === 'string' && isValidObjectIdString(meta.bookingId)
    ? meta.bookingId
    : null;

  const doc = {
    dispatchId: new mongoose.Types.ObjectId(dispatchId),
    bookingId: bookingId ? new mongoose.Types.ObjectId(bookingId) : null,
    provider: 'postmark',
    channel: 'email',
    eventType: mapping.eventType,
    isTerminal: mapping.isTerminal,
    providerEventId,
    providerMessageId,
    occurredAt,
    payload: safePayload(body, recordType)
  };

  try {
    const r = await MessageDeliveryEvent.updateOne(
      { provider: 'postmark', providerEventId },
      { $setOnInsert: doc },
      { upsert: true }
    );
    const duplicate = r.upsertedCount === 0;
    logLine('log', duplicate ? 'duplicate' : 'inserted', {
      recordType,
      eventType: mapping.eventType,
      dispatchId,
      duplicate
    });
    return { ingested: !duplicate, eventType: mapping.eventType, duplicate, reason: null };
  } catch (err) {
    // Duplicate-key race: another concurrent webhook delivery inserted first.
    if (err && (err.code === 11000 || /E11000/.test(String(err.message)))) {
      logLine('log', 'duplicate_race', { recordType, dispatchId });
      return { ingested: false, eventType: mapping.eventType, duplicate: true, reason: null };
    }
    logLine('error', 'ingest_failed', { error: err?.message || String(err), dispatchId, recordType });
    return { ingested: false, eventType: mapping.eventType, duplicate: false, reason: 'ingest_failed' };
  }
}

module.exports = {
  ingestPostmarkEvent,
  // Exported for tests only.
  __internals: {
    RECORD_TYPE_MAP,
    STABLE_TIMESTAMP_FIELDS,
    extractDispatchId,
    computeProviderEventId,
    pickStableTimestampString
  }
};
