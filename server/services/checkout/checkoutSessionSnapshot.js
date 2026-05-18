const crypto = require('crypto');
const { toDateOnly } = require('./checkoutSessionFingerprints');

const SNAPSHOT_SCHEMA_VERSION = 1;

function eurosToCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100));
}

function toIntegerCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function stableSortKeys(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stableSortKeys);
  }
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = stableSortKeys(value[key]);
  }
  return sorted;
}

function stableStringify(value) {
  return JSON.stringify(stableSortKeys(value));
}

/**
 * Pricing-relevant subset for hash (order-independent via stable stringify).
 */
function buildQuoteSnapshotHashPayload(snapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    entityType: snapshot.entityType,
    cabinId: snapshot.cabinId || null,
    cabinTypeId: snapshot.cabinTypeId || null,
    checkInDateOnly: snapshot.checkInDateOnly,
    checkOutDateOnly: snapshot.checkOutDateOnly,
    adults: snapshot.adults,
    children: snapshot.children,
    experienceKeys: snapshot.experienceKeys,
    transportMethod: snapshot.transportMethod || '',
    romanticSetup: Boolean(snapshot.romanticSetup),
    promoCode: snapshot.promoCode || '',
    voucherCode: snapshot.voucherCode || '',
    subtotalCents: snapshot.subtotalCents,
    discountAmountCents: snapshot.discountAmountCents,
    totalValueCents: snapshot.totalValueCents,
    voucherAppliedCents: snapshot.voucherAppliedCents,
    stripeAmountCents: snapshot.stripeAmountCents,
    fullVoucherCoverage: Boolean(snapshot.fullVoucherCoverage)
  };
}

function hashQuoteSnapshot(snapshot) {
  const payload = buildQuoteSnapshotHashPayload(snapshot);
  return crypto.createHash('sha256').update(stableStringify(payload), 'utf8').digest('hex');
}

/**
 * @param {{ normalizedInput: object, quote: object }} params
 * quote shape: buildPublicBookingQuote ok result (entity, dates, prices, voucher fields).
 */
function buildQuoteSnapshot({ normalizedInput, quote }) {
  const entity = quote.entity || {};
  const entityType = quote.entityType === 'cabinType' ? 'cabinType' : 'cabin';
  const checkInDateOnly =
    normalizedInput.checkInDateOnly || toDateOnly(quote.checkInDate || normalizedInput.checkIn);
  const checkOutDateOnly =
    normalizedInput.checkOutDateOnly || toDateOnly(quote.checkOutDate || normalizedInput.checkOut);

  const totalValueCents = eurosToCents(quote.totalPrice);
  const voucherAppliedCents = toIntegerCents(
    quote.voucherAppliedCents != null ? quote.voucherAppliedCents : 0
  );
  const remainingDueCents =
    quote.remainingDueCents != null
      ? toIntegerCents(quote.remainingDueCents)
      : Math.max(0, totalValueCents - voucherAppliedCents);
  const stripeAmountCents = Math.max(0, remainingDueCents);
  const fullVoucherCoverage = Boolean(quote.fullVoucherCoverage);

  const promoSnapshot = quote.promo?.snapshot ?? quote.promoSnapshot ?? null;
  const appliedPromoCode = quote.appliedPromoCode || normalizedInput.promoCode || '';

  const snapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    entityType,
    cabinId: entityType === 'cabin' ? String(entity._id || normalizedInput.cabinId || '') : null,
    cabinTypeId:
      entityType === 'cabinType' ? String(entity._id || normalizedInput.cabinTypeId || '') : null,
    checkInDateOnly,
    checkOutDateOnly,
    checkInISO: quote.checkInDate ? new Date(quote.checkInDate).toISOString() : null,
    checkOutISO: quote.checkOutDate ? new Date(quote.checkOutDate).toISOString() : null,
    adults: normalizedInput.adults,
    children: normalizedInput.children,
    experienceKeys: [...(normalizedInput.experienceKeys || [])],
    transportMethod: normalizedInput.transportMethod || '',
    romanticSetup: Boolean(normalizedInput.romanticSetup),
    promoCode: normalizedInput.promoCode || '',
    voucherCode: normalizedInput.voucherCode || '',
    promoSnapshot: promoSnapshot ? stableSortKeys(promoSnapshot) : null,
    appliedPromoCode,
    subtotalCents: eurosToCents(quote.subtotalPrice),
    discountAmountCents: eurosToCents(quote.discountAmount),
    totalValueCents,
    voucherAppliedCents,
    stripeAmountCents,
    fullVoucherCoverage,
    currency: 'EUR',
    minNights: entity.minNights != null ? Number(entity.minNights) : null,
    capacity: entity.capacity != null ? Number(entity.capacity) : null,
    pricingModel: entity.pricingModel || null
  };

  return snapshot;
}

module.exports = {
  SNAPSHOT_SCHEMA_VERSION,
  buildQuoteSnapshot,
  hashQuoteSnapshot,
  buildQuoteSnapshotHashPayload,
  stableStringify,
  eurosToCents,
  toIntegerCents
};
