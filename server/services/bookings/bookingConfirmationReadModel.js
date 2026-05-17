const moment = require('moment');
const { formatSofiaDateOnly } = require('../../utils/dateTime');

const ENTITY_POPULATE_FIELDS =
  'name description imageUrl location meetingPoint packingList arrivalGuideUrl safetyNotes emergencyContact arrivalWindowDefault transportCutoffs';

const FALLBACK_ENTITY = Object.freeze({
  type: 'unknown',
  name: 'Your stay',
  location: '',
  meetingPoint: null,
  arrivalGuideUrl: null,
  packingList: [],
  safetyNotes: null,
  emergencyContact: null,
  arrivalWindowDefault: null
});

function toPlainSubdoc(value) {
  if (!value) return null;
  if (typeof value.toObject === 'function') return value.toObject();
  return value;
}

function normalizeMeetingPoint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const mp = toPlainSubdoc(raw);
  return {
    label: mp.label || null,
    googleMapsUrl: mp.googleMapsUrl || null,
    lat: mp.lat ?? null,
    lng: mp.lng ?? null,
    what3words: mp.what3words || null
  };
}

function mapEntitySourceToDisplay(type, source) {
  const doc = toPlainSubdoc(source);
  if (!doc) return { ...FALLBACK_ENTITY };
  const packingList = Array.isArray(doc.packingList)
    ? doc.packingList.filter((item) => typeof item === 'string' && item.trim())
    : [];
  return {
    type,
    name: String(doc.name || FALLBACK_ENTITY.name).trim() || FALLBACK_ENTITY.name,
    location: String(doc.location || '').trim(),
    meetingPoint: normalizeMeetingPoint(doc.meetingPoint),
    arrivalGuideUrl: doc.arrivalGuideUrl || null,
    packingList,
    safetyNotes: doc.safetyNotes || null,
    emergencyContact: doc.emergencyContact || null,
    arrivalWindowDefault: doc.arrivalWindowDefault || null
  };
}

function isPopulatedEntityRef(ref) {
  return Boolean(ref && typeof ref === 'object' && typeof ref.name === 'string' && ref.name.trim());
}

function buildDisplayEntity(booking) {
  if (isPopulatedEntityRef(booking.cabinId)) {
    return mapEntitySourceToDisplay('cabin', booking.cabinId);
  }
  if (isPopulatedEntityRef(booking.cabinTypeId)) {
    return mapEntitySourceToDisplay('cabinType', booking.cabinTypeId);
  }
  return { ...FALLBACK_ENTITY };
}

function buildUnitLabel(booking) {
  const unit = toPlainSubdoc(booking.unitId);
  if (!unit) return null;
  const displayName = String(unit.displayName || '').trim();
  const unitNumber = String(unit.unitNumber || '').trim();
  if (displayName) return displayName;
  if (unitNumber) return `Unit ${unitNumber}`;
  return null;
}

function centsToMajor(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n) / 100;
}

/**
 * Guest-facing paid state — never infer from paymentMethod alone (defaults to stripe on pending rows).
 */
function derivePaymentSummary(booking) {
  const status = String(booking.status || '');
  const paymentMethod = String(booking.paymentMethod || 'stripe');
  const hasPi = Boolean(booking.stripePaymentIntentId && String(booking.stripePaymentIntentId).trim());
  const stripeCents = Number(booking.stripePaidAmountCents || 0);
  const giftCents = Number(booking.giftVoucherAppliedCents || 0);
  const displayAmount = Number(booking.totalPrice);
  const cardPaidAmount = centsToMajor(stripeCents);
  const voucherAppliedAmount = centsToMajor(giftCents);

  const paid =
    status === 'confirmed' &&
    (hasPi ||
      paymentMethod === 'gift_voucher' ||
      (paymentMethod === 'stripe_plus_gift_voucher' && (stripeCents > 0 || giftCents > 0)));

  let method = 'pay_on_arrival';
  let copyKey = 'success.paymentPendingOnArrival';

  if (paid) {
    const fullVoucher =
      paymentMethod === 'gift_voucher' && giftCents > 0 && (!hasPi || stripeCents <= 0);
    const mixed =
      paymentMethod === 'stripe_plus_gift_voucher' && giftCents > 0 && stripeCents > 0;

    if (fullVoucher) {
      method = 'gift_voucher';
      copyKey = 'success.paymentCoveredByVoucher';
    } else if (mixed) {
      method = 'stripe_plus_gift_voucher';
      copyKey = 'success.paymentCardAndVoucher';
    } else {
      method = hasPi ? 'stripe' : paymentMethod;
      copyKey = 'success.paymentPaidOnline';
    }
  }

  return {
    paid,
    method,
    displayAmount: Number.isFinite(displayAmount) ? displayAmount : 0,
    currency: 'EUR',
    cardPaidAmount,
    voucherAppliedAmount,
    copyKey
  };
}

function buildBookingRef(bookingId, checkInDateOnly) {
  const idStr = String(bookingId || '');
  if (!checkInDateOnly || typeof checkInDateOnly !== 'string') {
    return `DW-UNKNOWN-${idStr.slice(-3)}`;
  }
  const parts = checkInDateOnly.split('-');
  if (parts.length !== 3) {
    return `DW-UNKNOWN-${idStr.slice(-3)}`;
  }
  const [year, month, day] = parts;
  return `DW-${year}${month}${day}-${idStr.slice(-3)}`;
}

function maskGuestInfo(guestInfo, isOwner) {
  const base = guestInfo && typeof guestInfo === 'object' ? { ...guestInfo } : {};
  if (isOwner) {
    return {
      firstName: String(base.firstName || '').trim(),
      lastName: String(base.lastName || '').trim(),
      email: String(base.email || '').trim()
    };
  }
  const e = String(base.email || '');
  const [local, domain] = e.split('@');
  const maskedEmail = local ? `${local.slice(0, 3)}***@${domain || ''}` : '';
  const p = String(base.phone || '');
  const maskedPhone = p.length > 4 ? `***${p.slice(-4)}` : '****';
  return {
    firstName: String(base.firstName || '').trim(),
    lastName: String(base.lastName || '').trim(),
    email: maskedEmail,
    phone: maskedPhone
  };
}

function buildBookingConfirmation(booking, { queryEmail } = {}) {
  const bookingObj = booking.toObject ? booking.toObject() : booking;
  const bookingId = String(bookingObj._id);
  const checkInDateOnly = bookingObj.checkIn
    ? formatSofiaDateOnly(bookingObj.checkIn)
    : '';
  const checkOutDateOnly = bookingObj.checkOut
    ? formatSofiaDateOnly(bookingObj.checkOut)
    : '';
  const ownerEmail = String(bookingObj.guestInfo?.email || '')
    .trim()
    .toLowerCase();
  const normalizedQuery = String(queryEmail || '')
    .trim()
    .toLowerCase();
  const isOwner = Boolean(normalizedQuery && ownerEmail && normalizedQuery === ownerEmail);

  const totalNights = moment(bookingObj.checkOut).diff(moment(bookingObj.checkIn), 'days');

  return {
    bookingId,
    status: bookingObj.status,
    bookingRef: buildBookingRef(bookingId, checkInDateOnly),
    checkInDateOnly,
    checkOutDateOnly,
    checkIn: bookingObj.checkIn,
    checkOut: bookingObj.checkOut,
    displayEntity: buildDisplayEntity(bookingObj),
    unitLabel: buildUnitLabel(bookingObj),
    paymentSummary: derivePaymentSummary(bookingObj),
    guest: maskGuestInfo(bookingObj.guestInfo, isOwner),
    adults: Number(bookingObj.adults || 0),
    children: Number(bookingObj.children || 0),
    totalNights: Number.isFinite(totalNights) && totalNights > 0 ? totalNights : 0,
    tripType: bookingObj.tripType || null,
    transportMethod: bookingObj.transportMethod || null,
    romanticSetup: Boolean(bookingObj.romanticSetup),
    specialRequests: bookingObj.specialRequests || null,
    promoCode: bookingObj.promoCode || null,
    idempotentReplay: false,
    existingBookingRedirect: null
  };
}

module.exports = {
  ENTITY_POPULATE_FIELDS,
  FALLBACK_ENTITY,
  buildDisplayEntity,
  buildUnitLabel,
  derivePaymentSummary,
  buildBookingRef,
  buildBookingConfirmation,
  maskGuestInfo
};
