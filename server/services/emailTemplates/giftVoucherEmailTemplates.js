const {
  buildBuyerReceiptDesignedEmail,
  buildRecipientVoucherDesignedEmail,
  buildRecipientResendDesignedEmail
} = require('../giftVouchers/giftVoucherDesignedEmailBuilder');

function buildBuyerReceiptTemplate({ voucher, variant = null, cardDownloadUrl = null } = {}) {
  return buildBuyerReceiptDesignedEmail({ voucher, variant, cardDownloadUrl });
}

function buildRecipientVoucherTemplate({ voucher, recipientEmail, cardDownloadUrl = null } = {}) {
  return buildRecipientVoucherDesignedEmail({ voucher, recipientEmail, cardDownloadUrl });
}

function buildRecipientResendTemplate({ voucher, recipientEmail }) {
  return buildRecipientResendDesignedEmail({ voucher, recipientEmail });
}

module.exports = {
  buildBuyerReceiptTemplate,
  buildRecipientVoucherTemplate,
  buildRecipientResendTemplate
};
