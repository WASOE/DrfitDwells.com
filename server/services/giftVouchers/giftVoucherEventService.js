const GiftVoucherEvent = require('../../models/GiftVoucherEvent');
const { assertIntegerCents } = require('./giftVoucherValidationService');

const FINANCIAL_EVENT_TYPES = new Set([
  'redeemed_reserved',
  'redeemed_confirmed',
  'redeemed_released',
  'adjusted',
  'voided',
  'expired',
  'refunded',
  'expiry_extended'
]);

function normalizeActor(actor) {
  const value = String(actor || '').trim();
  return value || null;
}

function normalizeNote(note) {
  if (note == null) return null;
  const value = String(note).trim();
  return value || null;
}

async function appendVoucherEvent({
  giftVoucherId,
  type,
  actor,
  note = null,
  previousBalanceCents = null,
  newBalanceCents = null,
  deltaCents = null,
  metadata = {}
}) {
  const normalizedActor = normalizeActor(actor);
  if (!normalizedActor) {
    const err = new Error('actor is required');
    err.code = 'EVENT_ACTOR_REQUIRED';
    throw err;
  }

  const normalizedNote = normalizeNote(note);
  if (FINANCIAL_EVENT_TYPES.has(type) && !normalizedNote) {
    const err = new Error('note is required for financial voucher events');
    err.code = 'EVENT_NOTE_REQUIRED';
    throw err;
  }

  if (previousBalanceCents != null) assertIntegerCents(previousBalanceCents, 'previousBalanceCents');
  if (newBalanceCents != null) assertIntegerCents(newBalanceCents, 'newBalanceCents');
  if (deltaCents != null) assertIntegerCents(deltaCents, 'deltaCents');

  return GiftVoucherEvent.create({
    giftVoucherId,
    type,
    actor: normalizedActor,
    note: normalizedNote,
    previousBalanceCents,
    newBalanceCents,
    deltaCents,
    metadata: metadata || {}
  });
}

async function appendFinancialVoucherEvent({
  giftVoucherId,
  type,
  actor,
  note,
  previousBalanceCents,
  newBalanceCents,
  deltaCents,
  metadata = {}
}) {
  if (!normalizeActor(actor)) {
    const err = new Error('actor is required for financial voucher events');
    err.code = 'EVENT_ACTOR_REQUIRED';
    throw err;
  }
  if (!normalizeNote(note)) {
    const err = new Error('note is required for financial voucher events');
    err.code = 'EVENT_NOTE_REQUIRED';
    throw err;
  }
  if (previousBalanceCents == null || newBalanceCents == null || deltaCents == null) {
    const err = new Error('previousBalanceCents, newBalanceCents and deltaCents are required');
    err.code = 'EVENT_BALANCE_FIELDS_REQUIRED';
    throw err;
  }

  return appendVoucherEvent({
    giftVoucherId,
    type,
    actor,
    note,
    previousBalanceCents,
    newBalanceCents,
    deltaCents,
    metadata
  });
}

module.exports = {
  appendVoucherEvent,
  appendFinancialVoucherEvent
};
