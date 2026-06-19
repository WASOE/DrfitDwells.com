'use strict';

const { formatSofiaDateOnly } = require('../../../utils/dateTime');
const { resolveBookingPropertyKind } = require('./propertyKindJoin');

function bookingRevenueCents(booking) {
  if (Number.isFinite(booking?.totalValueCents) && booking.totalValueCents != null) {
    return Math.max(0, Math.round(booking.totalValueCents));
  }
  const totalPrice = Number(booking?.totalPrice);
  if (!Number.isFinite(totalPrice)) return 0;
  return Math.max(0, Math.round(totalPrice * 100));
}

function bookingCashCollectedCents(booking) {
  if (!Number.isFinite(booking?.stripePaidAmountCents) || booking.stripePaidAmountCents == null) {
    return 0;
  }
  return Math.max(0, Math.round(booking.stripePaidAmountCents));
}

function resolveChannel(booking) {
  const source = String(booking?.provenance?.source || '').trim();
  if (source === 'guest_portal') return 'website';
  if (source === 'admin_manual' || source === 'operator_manual') return 'staff';
  return 'other';
}

function normalizeStayRow(booking, maps) {
  const { propertyKind, issue } = resolveBookingPropertyKind(booking, maps);
  const channel = resolveChannel(booking);

  return {
    bookingId: String(booking._id),
    propertyKind,
    propertyKindIssue: issue,
    status: booking.status,
    channel,
    checkInDateOnly: booking.checkIn ? formatSofiaDateOnly(booking.checkIn) : null,
    checkOutDateOnly: booking.checkOut ? formatSofiaDateOnly(booking.checkOut) : null,
    bookedRevenueCents: bookingRevenueCents(booking),
    cashCollectedCents: bookingCashCollectedCents(booking),
    cabinId: booking.cabinId ? String(booking.cabinId) : null,
    cabinTypeId: booking.cabinTypeId ? String(booking.cabinTypeId) : null,
    unitId: booking.unitId ? String(booking.unitId) : null,
    provenanceSource: booking?.provenance?.source || null,
    isZeroPriceManual:
      channel === 'staff' && bookingRevenueCents(booking) === 0,
    isMissingUnitOnValley:
      propertyKind === 'valley' && Boolean(booking.cabinTypeId) && !booking.unitId
  };
}

module.exports = {
  bookingRevenueCents,
  bookingCashCollectedCents,
  resolveChannel,
  normalizeStayRow
};
