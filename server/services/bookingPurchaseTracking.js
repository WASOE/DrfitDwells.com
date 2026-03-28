const Booking = require('../models/Booking');
const { sendPurchaseEvent } = require('./metaCapiService');

const TRACKING_CURRENCY = (process.env.BOOKING_TRACKING_CURRENCY || 'EUR').toUpperCase();

/**
 * GA4-compatible ecommerce payload + shared Meta event_id (browser dedup).
 * @param {import('mongoose').Document} booking — populated cabinId.name or cabinTypeId.name when possible
 */
function buildPurchaseTrackingPayload(booking) {
  const eventId = `pur_${booking._id}`;
  const transactionId = String(booking._id);
  const propertyName =
    booking.cabinId?.name || booking.cabinTypeId?.name || 'Drift & Dwells stay';
  const value = Number(booking.totalPrice);
  const items = [
    {
      item_id: transactionId,
      item_name: propertyName,
      item_category: 'lodging',
      price: value,
      quantity: 1,
      currency: TRACKING_CURRENCY
    }
  ];

  return {
    event_id: eventId,
    transaction_id: transactionId,
    value,
    currency: TRACKING_CURRENCY,
    items,
    property_name: propertyName
  };
}

async function populateBookingForTracking(booking) {
  if (booking.cabinId) await booking.populate('cabinId', 'name');
  else if (booking.cabinTypeId) await booking.populate('cabinTypeId', 'name');
  return booking;
}

/**
 * Send Meta CAPI Purchase once per booking. Sets metaPurchaseSentAt only on Graph API success.
 * Does not set metaPurchaseSentAt when CAPI is skipped (missing env) so a later retry can succeed.
 *
 * @param {import('mongoose').Document} booking
 * @param {{ clientIp?: string; userAgent?: string }} ctx
 */
async function trySendMetaCapiPurchase(booking, ctx = {}) {
  if (!booking || booking.status !== 'confirmed') {
    return { ok: false, skipped: true, reason: 'not_confirmed' };
  }
  if (booking.metaPurchaseSentAt) {
    return { ok: true, skipped: true, reason: 'already_sent' };
  }

  const payload = buildPurchaseTrackingPayload(booking);
  const capi = await sendPurchaseEvent({
    eventId: payload.event_id,
    email: booking.guestInfo?.email,
    value: payload.value,
    currency: payload.currency,
    clientIp: ctx.clientIp,
    userAgent: ctx.userAgent
  });

  if (capi.ok && !capi.skipped) {
    booking.metaPurchaseSentAt = new Date();
    await booking.save();
  }

  return capi;
}

/**
 * Load booking by id, populate property name, send Meta CAPI if eligible.
 * Used after POST /bookings confirms payment (does not depend on success page).
 *
 * @param {string} bookingId
 * @param {{ ip?: string; get?: (h: string) => string | undefined }} req
 */
async function processMetaPurchaseAfterConfirm(bookingId, req) {
  const booking = await Booking.findById(bookingId);
  if (!booking) return { ok: false, skipped: true, reason: 'not_found' };
  await populateBookingForTracking(booking);
  const clientIp = req?.ip;
  const userAgent = typeof req?.get === 'function' ? req.get('user-agent') : undefined;
  return trySendMetaCapiPurchase(booking, { clientIp, userAgent });
}

module.exports = {
  TRACKING_CURRENCY,
  buildPurchaseTrackingPayload,
  populateBookingForTracking,
  trySendMetaCapiPurchase,
  processMetaPurchaseAfterConfirm
};
