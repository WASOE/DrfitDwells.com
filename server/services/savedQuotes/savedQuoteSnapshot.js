'use strict';

const { formatSofiaDateOnly } = require('../../utils/dateTime');
const { eurosToCents } = require('../checkout/checkoutSessionSnapshot');
const { SAVED_QUOTE_SCHEMA_VERSION } = require('./savedQuoteConstants');

function resolvePropertyKindFromEntity(entity, entityType) {
  const kind = entity?.propertyKind;
  if (kind === 'cabin' || kind === 'valley') return kind;
  // Valley multi-unit cabin types are typically valley; single cabins may be cabin or valley.
  return null;
}

function buildSavedQuoteSnapshotFromQuoteResult(result, body = {}) {
  const entityType = result.entityType === 'cabinType' ? 'cabin_type' : 'cabin';
  const entity = result.entity || {};
  const entityId = String(entity._id || body.cabinId || body.cabinTypeId || '');
  const propertyKind = resolvePropertyKindFromEntity(entity, entityType);
  const checkInDateOnly = formatSofiaDateOnly(result.checkInDate);
  const checkOutDateOnly = formatSofiaDateOnly(result.checkOutDate);
  const quotedTotalCents = eurosToCents(result.totalPrice);
  const baseCents = eurosToCents(
    result.baseLodgingPrice != null ? result.baseLodgingPrice : result.subtotalPrice
  );
  const extrasCents = eurosToCents(result.extrasTotal != null ? result.extrasTotal : 0);
  const discountsCents = eurosToCents(result.discountAmount);
  const promoCode =
    result.appliedPromoCode ||
    result.promo?.snapshot?.code ||
    (typeof body.promoCode === 'string' ? body.promoCode.trim().toUpperCase() : '') ||
    '';

  return {
    schemaVersion: SAVED_QUOTE_SCHEMA_VERSION,
    propertyKind,
    entityType,
    entityId,
    cabinId: entityType === 'cabin' ? entityId : null,
    cabinTypeId: entityType === 'cabin_type' ? entityId : null,
    unitId: null,
    checkIn: result.checkInDate ? new Date(result.checkInDate) : null,
    checkOut: result.checkOutDate ? new Date(result.checkOutDate) : null,
    checkInDateOnly,
    checkOutDateOnly,
    adults: Number.parseInt(body.adults, 10) || 0,
    children: Number.parseInt(body.children, 10) || 0,
    quotedTotalCents,
    currency: 'EUR',
    pricingSnapshot: {
      baseCents,
      discountsCents,
      extrasCents,
      taxesCents: 0,
      feesCents: 0,
      promoCode: promoCode || null,
      promoDiscountCents: discountsCents,
      voucherCode: typeof body.voucherCode === 'string' ? body.voucherCode.trim().toUpperCase() : null,
      voucherAppliedCents: Number(result.voucherAppliedCents) || 0,
      remainingDueCents:
        result.remainingDueCents != null
          ? Number(result.remainingDueCents)
          : Math.max(0, quotedTotalCents - (Number(result.voucherAppliedCents) || 0)),
      subtotalCents: eurosToCents(result.subtotalPrice),
      experienceKeys: Array.isArray(body.experienceKeys) ? [...body.experienceKeys] : []
    }
  };
}

module.exports = {
  buildSavedQuoteSnapshotFromQuoteResult,
  resolvePropertyKindFromEntity
};
