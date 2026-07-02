'use strict';

function normalizeRecipientEmail(email) {
  if (email == null) return '';
  return String(email).trim().toLowerCase();
}

function bookingLifecycleCorrelationKey({ bookingId, templateKey, recipientEmail }) {
  const id = bookingId != null ? String(bookingId) : '';
  const template = templateKey != null ? String(templateKey).trim() : '';
  const recipient = normalizeRecipientEmail(recipientEmail);
  if (!id || !template || !recipient) {
    throw new Error('bookingLifecycleCorrelationKey requires bookingId, templateKey, and recipientEmail');
  }
  return `booking:${id}:${template}:${recipient}`;
}

function giftVoucherRecipientCorrelationKey({ giftVoucherId, recipientEmail }) {
  const id = giftVoucherId != null ? String(giftVoucherId) : '';
  const recipient = normalizeRecipientEmail(recipientEmail);
  if (!id || !recipient) {
    throw new Error('giftVoucherRecipientCorrelationKey requires giftVoucherId and recipientEmail');
  }
  return `gift_voucher:${id}:recipient_voucher:${recipient}`;
}

function giftVoucherBuyerReceiptCorrelationKey({ giftVoucherId, buyerEmail }) {
  const id = giftVoucherId != null ? String(giftVoucherId) : '';
  const recipient = normalizeRecipientEmail(buyerEmail);
  if (!id || !recipient) {
    throw new Error('giftVoucherBuyerReceiptCorrelationKey requires giftVoucherId and buyerEmail');
  }
  return `gift_voucher:${id}:buyer_receipt:${recipient}`;
}

function giftVoucherBuyerGiftCardCorrelationKey({ giftVoucherId, buyerEmail }) {
  const id = giftVoucherId != null ? String(giftVoucherId) : '';
  const recipient = normalizeRecipientEmail(buyerEmail);
  if (!id || !recipient) {
    throw new Error('giftVoucherBuyerGiftCardCorrelationKey requires giftVoucherId and buyerEmail');
  }
  return `gift_voucher:${id}:buyer_gift_card:${recipient}`;
}

function giftVoucherCorrelationKey({ giftVoucherId, templateKind, recipientEmail }) {
  const kind = templateKind != null ? String(templateKind).trim() : '';
  if (kind === 'buyer_receipt') {
    return giftVoucherBuyerReceiptCorrelationKey({ giftVoucherId, buyerEmail: recipientEmail });
  }
  if (kind === 'buyer_gift_card') {
    return giftVoucherBuyerGiftCardCorrelationKey({ giftVoucherId, buyerEmail: recipientEmail });
  }
  if (kind === 'recipient_voucher' || kind === 'recipient_resend') {
    return giftVoucherRecipientCorrelationKey({ giftVoucherId, recipientEmail });
  }
  throw new Error(`giftVoucherCorrelationKey: unsupported templateKind ${kind}`);
}

const GUEST_BOOKING_TEMPLATE_KEYS = new Set([
  'booking_received',
  'booking_confirmed',
  'booking_cancelled'
]);

function isGuestBookingTemplateKey(templateKey) {
  return GUEST_BOOKING_TEMPLATE_KEYS.has(String(templateKey || '').trim());
}

module.exports = {
  normalizeRecipientEmail,
  bookingLifecycleCorrelationKey,
  giftVoucherRecipientCorrelationKey,
  giftVoucherBuyerReceiptCorrelationKey,
  giftVoucherBuyerGiftCardCorrelationKey,
  giftVoucherCorrelationKey,
  isGuestBookingTemplateKey,
  GUEST_BOOKING_TEMPLATE_KEYS
};
