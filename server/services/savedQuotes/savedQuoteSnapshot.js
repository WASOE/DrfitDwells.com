'use strict';

const mongoose = require('mongoose');
const { formatSofiaDateOnly, normalizeDateToSofiaDayStart } = require('../../utils/dateTime');
const { eurosToCents } = require('../checkout/checkoutSessionSnapshot');
const {
  SAVED_QUOTE_SCHEMA_VERSION,
  LOCATION_ENTITY_OBJECT_IDS
} = require('./savedQuoteConstants');

function resolvePropertyKindFromEntity(entity) {
  const kind = entity?.propertyKind;
  if (kind === 'cabin' || kind === 'valley') return kind;
  return null;
}

function locationEntityObjectId(locationKey) {
  const key = String(locationKey || '').trim().toLowerCase();
  const hex = LOCATION_ENTITY_OBJECT_IDS[key];
  if (hex && mongoose.Types.ObjectId.isValid(hex)) {
    return new mongoose.Types.ObjectId(hex);
  }
  // Deterministic fallback from location key
  const crypto = require('crypto');
  const digest = crypto.createHash('md5').update(`location:${key}`).digest('hex').slice(0, 24);
  return new mongoose.Types.ObjectId(digest);
}

function buildSavedQuoteSnapshotFromQuoteResult(result, body = {}) {
  const entityType = result.entityType === 'cabinType' ? 'cabin_type' : 'cabin';
  const entity = result.entity || {};
  const entityId = String(entity._id || body.cabinId || body.cabinTypeId || '');
  const propertyKind = resolvePropertyKindFromEntity(entity);
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
    locationKey: null,
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
      experienceKeys: Array.isArray(body.experienceKeys) ? [...body.experienceKeys] : [],
      isLocationBuyout: false
    }
  };
}

/**
 * Valley whole-location quote → immutable snapshot.
 * One location-level journey; does not create per-unit child quotes.
 */
function buildSavedQuoteSnapshotFromLocationQuote(quote, body = {}) {
  if (!quote || quote.available === false) {
    return null;
  }
  const locationKey = String(quote.locationKey || body.locationKey || 'valley').trim().toLowerCase();
  const entityId = locationEntityObjectId(locationKey);
  const checkInDateOnly = String(quote.checkIn || body.checkIn || '').slice(0, 10);
  const checkOutDateOnly = String(quote.checkOut || body.checkOut || '').slice(0, 10);
  const checkIn = normalizeDateToSofiaDayStart(checkInDateOnly);
  const checkOut = normalizeDateToSofiaDayStart(checkOutDateOnly);
  const quotedTotalCents = eurosToCents(quote.totalPrice);
  const lodgingSubtotalCents = eurosToCents(
    quote.lodgingSubtotal != null ? quote.lodgingSubtotal : quote.totalPrice
  );

  // Persist target summary without duplicating child booking journeys.
  const includedTargets = Array.isArray(quote.includedTargets)
    ? quote.includedTargets.map((t) => ({
        targetType: t.targetType || null,
        name: t.name || null,
        unitCount: t.unitCount != null ? Number(t.unitCount) : null,
        sleeps: t.sleeps != null ? Number(t.sleeps) : null,
        lodgingSubtotal: t.lodgingSubtotal != null ? Number(t.lodgingSubtotal) : null
      }))
    : null;

  return {
    schemaVersion: SAVED_QUOTE_SCHEMA_VERSION,
    propertyKind: 'valley',
    entityType: 'location',
    entityId: String(entityId),
    locationKey,
    cabinId: null,
    cabinTypeId: null,
    unitId: null,
    checkIn,
    checkOut,
    checkInDateOnly,
    checkOutDateOnly,
    adults: Number(quote.adults != null ? quote.adults : body.adults) || 0,
    children: Number(quote.children != null ? quote.children : body.children) || 0,
    quotedTotalCents,
    currency: quote.currency || 'EUR',
    pricingSnapshot: {
      baseCents: lodgingSubtotalCents,
      discountsCents: 0,
      extrasCents: 0,
      taxesCents: 0,
      feesCents: 0,
      promoCode: null,
      promoDiscountCents: 0,
      voucherCode: null,
      voucherAppliedCents: 0,
      remainingDueCents: quotedTotalCents,
      subtotalCents: lodgingSubtotalCents,
      lodgingSubtotalCents,
      experienceKeys: [],
      locationKey,
      nights: quote.nights != null ? Number(quote.nights) : null,
      priceDisclaimer: quote.priceDisclaimer || null,
      includedTargets,
      isLocationBuyout: true
    }
  };
}

module.exports = {
  buildSavedQuoteSnapshotFromQuoteResult,
  buildSavedQuoteSnapshotFromLocationQuote,
  resolvePropertyKindFromEntity,
  locationEntityObjectId
};
