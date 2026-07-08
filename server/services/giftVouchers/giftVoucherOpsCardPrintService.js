const GiftVoucher = require('../../models/GiftVoucher');
const { renderGiftVoucherCard } = require('./giftVoucherCardRenderer');
const { buildGiftVoucherPrintDocument } = require('./giftVoucherCardPrintDocument');

const PRINTABLE_STATUSES = new Set(['active', 'partially_redeemed', 'expired']);
const BLOCKED_PRINT_STATUSES = new Set(['voided', 'refunded', 'pending_payment', 'draft', 'redeemed']);

async function renderOpsGiftVoucherPrintHtml(giftVoucherId) {
  const voucher = await GiftVoucher.findById(giftVoucherId).lean();
  if (!voucher) {
    const err = new Error('Gift voucher not found');
    err.code = 'GIFT_VOUCHER_NOT_FOUND';
    throw err;
  }
  if (BLOCKED_PRINT_STATUSES.has(voucher.status) || !PRINTABLE_STATUSES.has(voucher.status)) {
    const err = new Error(`Cannot print voucher in status ${voucher.status}`);
    err.code = 'GIFT_VOUCHER_NOT_PRINTABLE';
    throw err;
  }

  const { html: cardHtml, templateId } = renderGiftVoucherCard({
    voucher,
    mode: 'print'
  });

  return buildGiftVoucherPrintDocument({
    cardHtml,
    title: `Drift & Dwells gift voucher — ${templateId}`
  });
}

module.exports = {
  renderOpsGiftVoucherPrintHtml,
  PRINTABLE_STATUSES,
  BLOCKED_PRINT_STATUSES
};
