const { effectiveDeliveryOption } = require('./giftVoucherDeliveryOption');

const SENT_AT_TEMPLATE_KINDS = new Set(['recipient_voucher', 'buyer_gift_card']);

function isManualIssuanceVoucher(voucher = {}) {
  return (
    voucher.deliveryMode === 'manual' ||
    voucher.issuanceSource === 'cancellation_compensation'
  );
}

/**
 * Resolve activation delivery steps for a paid, active voucher.
 * @returns {{ skip: boolean, reason?: string, steps: Array<object> }}
 */
function resolveActivationDeliverySteps(voucher = {}) {
  if (isManualIssuanceVoucher(voucher)) {
    return { skip: true, reason: 'manual_issuance', steps: [] };
  }

  const deliveryOption = effectiveDeliveryOption(voucher);
  const steps = [];

  switch (deliveryOption) {
    case 'recipient_now':
      steps.push({
        type: 'email',
        templateKind: 'buyer_receipt',
        recipientEmail: voucher.buyerEmail,
        includeDownloadLink: true
      });
      steps.push({
        type: 'email',
        templateKind: 'recipient_voucher',
        recipientEmail: voucher.recipientEmail,
        includeDownloadLink: true,
        setsSentAt: true
      });
      break;
    case 'send_to_buyer':
      steps.push({
        type: 'email',
        templateKind: 'buyer_gift_card',
        recipientEmail: voucher.buyerEmail,
        includeDownloadLink: true,
        setsSentAt: true
      });
      break;
    case 'scheduled':
      steps.push({
        type: 'email',
        templateKind: 'buyer_receipt',
        recipientEmail: voucher.buyerEmail,
        includeDownloadLink: true,
        variant: 'scheduled'
      });
      steps.push({
        type: 'defer_recipient',
        scheduledDeliveryDate: voucher.deliveryDate || null
      });
      break;
    case 'postal':
      steps.push({
        type: 'email',
        templateKind: 'buyer_receipt',
        recipientEmail: voucher.buyerEmail,
        includeDownloadLink: true,
        variant: 'postal'
      });
      steps.push({ type: 'physical_card_review' });
      break;
    default:
      steps.push({
        type: 'email',
        templateKind: 'buyer_receipt',
        recipientEmail: voucher.buyerEmail,
        includeDownloadLink: true
      });
      steps.push({
        type: 'email',
        templateKind: 'recipient_voucher',
        recipientEmail: voucher.recipientEmail,
        includeDownloadLink: true,
        setsSentAt: true
      });
  }

  return { skip: false, steps };
}

function templateKindSetsSentAt(templateKind) {
  return SENT_AT_TEMPLATE_KINDS.has(templateKind);
}

module.exports = {
  resolveActivationDeliverySteps,
  isManualIssuanceVoucher,
  templateKindSetsSentAt,
  SENT_AT_TEMPLATE_KINDS
};
