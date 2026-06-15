'use strict';

const Booking = require('../../../models/Booking');
const Cabin = require('../../../models/Cabin');
const CabinType = require('../../../models/CabinType');
const Unit = require('../../../models/Unit');
const { formatSofiaDisplayDate, formatSofiaDateOnly } = require('../../../utils/dateTime');
const {
  resolvePropertyKindFromCabinDoc,
  resolvePropertyKindFromCabinTypeDoc,
  PropertyKindUnresolvedError
} = require('../../messaging/propertyKindResolver');

const SCHEDULABLE_STATUSES = new Set(['confirmed', 'in_house']);

function formatGuestName(guestInfo) {
  const first = String(guestInfo?.firstName || '').trim();
  const last = String(guestInfo?.lastName || '').trim();
  return [first, last].filter(Boolean).join(' ') || 'Guest';
}

function guestCount(booking) {
  const adults = Math.max(0, parseInt(booking?.adults, 10) || 0);
  const children = Math.max(0, parseInt(booking?.children, 10) || 0);
  return Math.max(1, adults + children);
}

async function resolvePropertyLabel(booking) {
  let propertyLabel = 'Property';
  if (booking?.cabinId) {
    const cabin = await Cabin.findById(booking.cabinId).select('name propertyKind').lean();
    if (cabin?.name) {
      propertyLabel = cabin.name;
    }
    return { propertyLabel, cabin, cabinType: null };
  }
  if (booking?.cabinTypeId) {
    const cabinType = await CabinType.findById(booking.cabinTypeId).select('name propertyKind').lean();
    if (cabinType?.name) {
      propertyLabel = cabinType.name;
    }
    if (booking?.unitId) {
      const unit = await Unit.findById(booking.unitId).select('displayName unitNumber').lean();
      if (unit?.displayName) {
        propertyLabel = `${propertyLabel} · ${unit.displayName}`;
      } else if (unit?.unitNumber) {
        propertyLabel = `${propertyLabel} · Unit ${unit.unitNumber}`;
      }
    }
    return { propertyLabel, cabin: null, cabinType };
  }
  return { propertyLabel, cabin: null, cabinType: null };
}

async function resolveBookingPropertyKind(booking) {
  if (booking?.cabinId) {
    const cabin = await Cabin.findById(booking.cabinId).select('propertyKind').lean();
    return resolvePropertyKindFromCabinDoc(cabin);
  }
  if (booking?.cabinTypeId) {
    const cabinType = await CabinType.findById(booking.cabinTypeId).select('propertyKind').lean();
    return resolvePropertyKindFromCabinTypeDoc(cabinType);
  }
  throw new PropertyKindUnresolvedError(
    'Booking has neither cabinId nor cabinTypeId; cannot resolve propertyKind.',
    { reason: 'no_stay_target' }
  );
}

async function loadOpsPushBookingContext(bookingId) {
  const booking = await Booking.findById(bookingId)
    .select(
      'guestInfo checkIn checkOut status cabinId cabinTypeId unitId adults children paymentMethod stripePaymentIntentId'
    )
    .lean();
  if (!booking) {
    return null;
  }

  const { propertyLabel } = await resolvePropertyLabel(booking);
  let propertyKind = null;
  let propertyKindError = null;
  try {
    propertyKind = await resolveBookingPropertyKind(booking);
  } catch (err) {
    propertyKindError = err;
  }

  return {
    booking,
    bookingId: String(booking._id),
    guestName: formatGuestName(booking.guestInfo),
    propertyLabel,
    propertyKind,
    propertyKindError,
    guestCount: guestCount(booking),
    checkInSofia: formatSofiaDisplayDate(booking.checkIn),
    checkOutSofia: formatSofiaDisplayDate(booking.checkOut),
    checkInSofiaDate: formatSofiaDateOnly(booking.checkIn),
    checkOutSofiaDate: formatSofiaDateOnly(booking.checkOut),
    status: booking.status || 'pending',
    isSchedulable: SCHEDULABLE_STATUSES.has(booking.status)
  };
}

function buildPayloadSnapshot(ctx) {
  if (!ctx?.booking) {
    return {};
  }
  return {
    bookingStatus: ctx.booking.status || null,
    checkIn: ctx.booking.checkIn || null,
    checkOut: ctx.booking.checkOut || null,
    propertyKind: ctx.propertyKind || null,
    propertyLabel: ctx.propertyLabel || null,
    checkInSofiaDate: ctx.checkInSofiaDate || null,
    checkOutSofiaDate: ctx.checkOutSofiaDate || null
  };
}

module.exports = {
  SCHEDULABLE_STATUSES,
  formatGuestName,
  guestCount,
  loadOpsPushBookingContext,
  buildPayloadSnapshot,
  resolveBookingPropertyKind
};
