const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const GiftVoucher = require('../models/GiftVoucher');
const emailService = require('./emailService');

async function loadEntityForBooking(booking) {
  if (booking.cabinId) {
    const id = booking.cabinId._id || booking.cabinId;
    const cabin = await Cabin.findById(id).lean();
    if (cabin) return cabin;
  }
  if (booking.cabinTypeId) {
    const id = booking.cabinTypeId._id || booking.cabinTypeId;
    const cabinType = await CabinType.findById(id).lean();
    if (cabinType) return cabinType;
  }
  return { name: 'Your stay', location: '' };
}

function resolveRecipientEmail(booking, voucher) {
  const fromGuest = booking?.guestInfo?.email ? String(booking.guestInfo.email).trim().toLowerCase() : '';
  if (fromGuest) return fromGuest;
  const fromVoucher = voucher?.recipientEmail ? String(voucher.recipientEmail).trim().toLowerCase() : '';
  return fromVoucher || null;
}

async function sendCancellationStayCreditEmail({ booking, compensationVoucher, creditAmountCents }) {
  if (!booking || !compensationVoucher?.code) {
    return { success: false, method: 'invalid', error: 'Missing booking or stay credit code' };
  }

  const recipientEmail = resolveRecipientEmail(booking, null);
  if (!recipientEmail) {
    return { success: false, method: 'invalid', error: 'Guest email is missing for stay credit email' };
  }

  let voucher = null;
  if (compensationVoucher.giftVoucherId) {
    voucher = await GiftVoucher.findById(compensationVoucher.giftVoucherId).lean();
  }

  const entity = await loadEntityForBooking(booking);
  const amountCents =
    Number.isFinite(creditAmountCents) && creditAmountCents > 0
      ? creditAmountCents
      : voucher?.amountOriginalCents;

  const payload = emailService.generateCancellationStayCreditEmail(booking, entity, {
    code: compensationVoucher.code,
    creditAmountCents: amountCents,
    expiresAt: voucher?.expiresAt || null,
    guestFirstName: booking?.guestInfo?.firstName || voucher?.recipientName || null
  });

  return emailService.sendEmail({
    to: recipientEmail,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    trigger: 'cancellation_stay_credit',
    bookingId: String(booking._id)
  });
}

module.exports = {
  sendCancellationStayCreditEmail
};
