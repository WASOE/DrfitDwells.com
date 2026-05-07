const GiftVoucher = require('../../models/GiftVoucher');
const GiftVoucherEvent = require('../../models/GiftVoucherEvent');
const { appendVoucherEvent } = require('./giftVoucherEventService');
const { openManualReviewItem } = require('../ops/ingestion/manualReviewService');
const emailService = require('../emailService');
const {
  buildBuyerReceiptTemplate,
  buildRecipientVoucherTemplate,
  buildRecipientResendTemplate
} = require('../emailTemplates/giftVoucherEmailTemplates');

const EMAIL_FAILED_CATEGORY = 'gift_voucher_email_failed';
const PHYSICAL_CARD_REQUIRED_CATEGORY = 'gift_voucher_physical_card_required';

function lifecycleKey(kind, giftVoucherId) {
  return `${kind}:${String(giftVoucherId)}`;
}

async function appendEventOnce(payload) {
  try {
    await appendVoucherEvent(payload);
    return { inserted: true };
  } catch (error) {
    if (error?.code === 11000) {
      return { inserted: false };
    }
    throw error;
  }
}

async function ensureLifecycleProgressOrThrow({ giftVoucherId, emailLifecycleKey }) {
  const terminal = await GiftVoucherEvent.findOne({
    giftVoucherId,
    type: { $in: ['sent', 'send_failed'] },
    'metadata.emailLifecycleKey': emailLifecycleKey
  }).lean();
  if (terminal) return terminal;

  const err = new Error('Email send was previously attempted but terminal state is missing');
  err.code = 'EMAIL_SEND_STATE_INCOMPLETE_REQUIRES_REVIEW';
  err.giftVoucherId = String(giftVoucherId);
  err.emailLifecycleKey = emailLifecycleKey;
  throw err;
}

async function ensureLifecycleProgressOrEscalate({ voucher, emailLifecycleKey, templateKind, recipientEmail, actor = 'system' }) {
  const terminalTypes =
    templateKind === 'physical_card_required'
      ? ['manual_review_created']
      : ['sent', 'send_failed'];
  try {
    const terminal = await GiftVoucherEvent.findOne({
      giftVoucherId: voucher._id,
      type: { $in: terminalTypes },
      'metadata.emailLifecycleKey': emailLifecycleKey
    }).lean();
    if (terminal) return terminal;
    const err = new Error('Email send was previously attempted but terminal state is missing');
    err.code = 'EMAIL_SEND_STATE_INCOMPLETE_REQUIRES_REVIEW';
    err.giftVoucherId = String(voucher._id);
    err.emailLifecycleKey = emailLifecycleKey;
    throw err;
  } catch (err) {
    if (err.code !== 'EMAIL_SEND_STATE_INCOMPLETE_REQUIRES_REVIEW') {
      throw err;
    }
    if (templateKind === 'physical_card_required') {
      throw err;
    }
    await openEmailFailureReview({
      voucher,
      title: 'Gift voucher email lifecycle is incomplete',
      details: `${templateKind} has send_attempted without sent/send_failed terminal event`,
      evidence: {
        giftVoucherId: String(voucher._id),
        templateKind,
        recipientEmail: recipientEmail || null,
        emailLifecycleKey,
        reason: 'missing_terminal_event'
      }
    });
    throw err;
  }
}

async function recordManualReviewCreatedEvent({ giftVoucherId, actor, note, metadata }) {
  await appendVoucherEvent({
    giftVoucherId,
    type: 'manual_review_created',
    actor,
    note,
    metadata
  });
}

async function openEmailFailureReview({ voucher, title, details, evidence }) {
  const item = await openManualReviewItem({
    category: EMAIL_FAILED_CATEGORY,
    severity: 'high',
    entityType: 'GiftVoucher',
    entityId: voucher._id,
    title,
    details,
    provenance: {
      source: 'gift_voucher_email'
    },
    evidence
  });
  await recordManualReviewCreatedEvent({
    giftVoucherId: voucher._id,
    actor: 'system',
    note: 'manual review opened for gift voucher email failure',
    metadata: {
      manualReviewItemId: String(item._id),
      category: EMAIL_FAILED_CATEGORY
    }
  });
  return item;
}

async function performLifecycleSend({
  voucher,
  recipientEmail,
  templateKind,
  templateBuilder,
  actor = 'system',
  trigger
}) {
  const key = lifecycleKey(templateKind, voucher._id);
  const attempted = await appendEventOnce({
    giftVoucherId: voucher._id,
    type: 'send_attempted',
    actor,
    note: `${templateKind} delivery attempted`,
    metadata: {
      emailLifecycleKey: key,
      templateKind,
      recipientEmail
    }
  });

  if (!attempted.inserted) {
    const terminal = await ensureLifecycleProgressOrEscalate({
      voucher,
      emailLifecycleKey: key,
      templateKind,
      recipientEmail,
      actor
    });
    return {
      ok: true,
      skipped: true,
      reason: terminal.type === 'sent' ? 'already_sent' : 'already_failed',
      emailLifecycleKey: key
    };
  }

  const template = templateBuilder({ voucher, recipientEmail });
  let sendResult;
  try {
    sendResult = await emailService.sendEmail({
      to: recipientEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
      trigger,
      skipIdempotencyWindow: true
    });
  } catch (sendErr) {
    await appendEventOnce({
      giftVoucherId: voucher._id,
      type: 'send_failed',
      actor,
      note: `${templateKind} delivery failed`,
      metadata: {
        emailLifecycleKey: key,
        templateKind,
        recipientEmail,
        error: sendErr.message || 'unknown_send_exception',
        thrown: true
      }
    });
    await openEmailFailureReview({
      voucher,
      title: 'Gift voucher email delivery failed',
      details: `${templateKind} email threw while sending`,
      evidence: {
        giftVoucherId: String(voucher._id),
        templateKind,
        recipientEmail,
        error: sendErr.message || null,
        thrown: true
      }
    });
    return {
      ok: false,
      status: 'failed',
      code: 'EMAIL_SEND_FAILED',
      emailLifecycleKey: key
    };
  }

  if (sendResult.success) {
    await appendEventOnce({
      giftVoucherId: voucher._id,
      type: 'sent',
      actor,
      note: `${templateKind} delivery sent`,
      metadata: {
        emailLifecycleKey: key,
        templateKind,
        recipientEmail,
        messageId: sendResult.messageId || null
      }
    });
    return {
      ok: true,
      status: 'sent',
      emailLifecycleKey: key
    };
  }

  await appendEventOnce({
    giftVoucherId: voucher._id,
    type: 'send_failed',
    actor,
    note: `${templateKind} delivery failed`,
    metadata: {
      emailLifecycleKey: key,
      templateKind,
      recipientEmail,
      error: sendResult.error || 'unknown_send_failure'
    }
  });
  await openEmailFailureReview({
    voucher,
    title: 'Gift voucher email delivery failed',
    details: `${templateKind} email could not be delivered`,
    evidence: {
      giftVoucherId: String(voucher._id),
      templateKind,
      recipientEmail,
      error: sendResult.error || null
    }
  });
  return {
    ok: false,
    status: 'failed',
    code: 'EMAIL_SEND_FAILED',
    emailLifecycleKey: key
  };
}

async function createPhysicalCardManualReview({ voucher, actor = 'system' }) {
  const key = lifecycleKey('physical_card_required', voucher._id);
  const attempted = await appendEventOnce({
    giftVoucherId: voucher._id,
    type: 'send_attempted',
    actor,
    note: 'physical card preparation review requested',
    metadata: {
      emailLifecycleKey: key,
      templateKind: 'physical_card_required'
    }
  });

  if (!attempted.inserted) {
    const terminal = await ensureLifecycleProgressOrEscalate({
      voucher,
      emailLifecycleKey: key,
      templateKind: 'physical_card_required',
      recipientEmail: null,
      actor
    });
    return {
      ok: true,
      skipped: true,
      reason: terminal.type === 'manual_review_created' ? 'already_processed' : 'already_failed',
      emailLifecycleKey: key
    };
  }

  const item = await openManualReviewItem({
    category: PHYSICAL_CARD_REQUIRED_CATEGORY,
    severity: 'medium',
    entityType: 'GiftVoucher',
    entityId: voucher._id,
    title: 'Gift voucher physical card preparation required',
    details: 'Voucher delivery mode is postal and requires manual card preparation',
    provenance: {
      source: 'gift_voucher_email'
    },
    evidence: {
      giftVoucherId: String(voucher._id),
      buyerEmail: voucher.buyerEmail || null,
      recipientName: voucher.recipientName || null,
      deliveryAddress: voucher.deliveryAddress || null,
      amountOriginalCents: voucher.amountOriginalCents,
      expiresAt: voucher.expiresAt || null
    }
  });
  await recordManualReviewCreatedEvent({
    giftVoucherId: voucher._id,
    actor,
    note: 'manual review opened for physical card preparation',
    metadata: {
      emailLifecycleKey: key,
      manualReviewItemId: String(item._id),
      category: PHYSICAL_CARD_REQUIRED_CATEGORY
    }
  });
  await appendEventOnce({
    giftVoucherId: voucher._id,
    type: 'sent',
    actor,
    note: 'physical card preparation review created',
    metadata: {
      emailLifecycleKey: key,
      templateKind: 'physical_card_required',
      manualReviewItemId: String(item._id)
    }
  });
  return { ok: true, status: 'manual_review_created', emailLifecycleKey: key };
}

async function handleActivatedGiftVoucherDelivery({ giftVoucherId, actor = 'system' }) {
  const voucher = await GiftVoucher.findById(giftVoucherId);
  if (!voucher) {
    const err = new Error('Gift voucher not found for delivery');
    err.code = 'GIFT_VOUCHER_NOT_FOUND';
    throw err;
  }
  if (voucher.status !== 'active' || !voucher.code) {
    const err = new Error('Gift voucher must be active with code before delivery');
    err.code = 'GIFT_VOUCHER_NOT_DELIVERABLE';
    throw err;
  }

  const outcomes = [];
  outcomes.push(
    await performLifecycleSend({
      voucher,
      recipientEmail: voucher.buyerEmail,
      templateKind: 'buyer_receipt',
      templateBuilder: buildBuyerReceiptTemplate,
      actor,
      trigger: 'gift_voucher_buyer_receipt'
    })
  );

  if (voucher.deliveryMode === 'postal') {
    outcomes.push(await createPhysicalCardManualReview({ voucher, actor }));
  } else {
    outcomes.push(
      await performLifecycleSend({
        voucher,
        recipientEmail: voucher.recipientEmail,
        templateKind: 'recipient_voucher',
        templateBuilder: buildRecipientVoucherTemplate,
        actor,
        trigger: 'gift_voucher_recipient'
      })
    );
  }

  const failed = outcomes.filter((o) => o && o.ok === false);
  return {
    ok: failed.length === 0,
    steps: outcomes
  };
}

async function resendRecipientGiftVoucherEmail({ giftVoucherId, actor = 'ops', recipientOverride = null }) {
  const voucher = await GiftVoucher.findById(giftVoucherId);
  if (!voucher) {
    const err = new Error('Gift voucher not found');
    err.code = 'GIFT_VOUCHER_NOT_FOUND';
    throw err;
  }
  if (voucher.status !== 'active' || !voucher.code) {
    const err = new Error('Only active vouchers with code can be resent');
    err.code = 'GIFT_VOUCHER_NOT_RESENDABLE';
    throw err;
  }

  const recipientEmail = String(recipientOverride || voucher.recipientEmail || '').trim().toLowerCase();
  if (!recipientEmail) {
    const err = new Error('Recipient email is required for resend');
    err.code = 'MISSING_RECIPIENT_EMAIL';
    throw err;
  }

  const template = buildRecipientResendTemplate({ voucher, recipientEmail });
  const sendResult = await emailService.sendEmail({
    to: recipientEmail,
    subject: template.subject,
    html: template.html,
    text: template.text,
    trigger: 'gift_voucher_recipient_resend',
    skipIdempotencyWindow: true
  });
  if (!sendResult.success) {
    await appendVoucherEvent({
      giftVoucherId: voucher._id,
      type: 'send_failed',
      actor,
      note: 'recipient voucher resend failed',
      metadata: {
        resend: true,
        recipientOverrideUsed: Boolean(recipientOverride),
        recipientEmail,
        error: sendResult.error || 'unknown_send_failure'
      }
    });
    await openEmailFailureReview({
      voucher,
      title: 'Gift voucher resend failed',
      details: 'Recipient voucher resend could not be delivered',
      evidence: {
        giftVoucherId: String(voucher._id),
        resend: true,
        recipientOverrideUsed: Boolean(recipientOverride),
        recipientEmail,
        error: sendResult.error || null
      }
    });
    const err = new Error('Recipient voucher resend failed');
    err.code = 'EMAIL_SEND_FAILED';
    throw err;
  }

  await appendVoucherEvent({
    giftVoucherId: voucher._id,
    type: 'resent',
    actor,
    note: 'recipient voucher resent',
    metadata: {
      recipientOverrideUsed: Boolean(recipientOverride),
      recipientOverride: recipientOverride ? String(recipientOverride).trim().toLowerCase() : null,
      recipientEmail,
      messageId: sendResult.messageId || null
    }
  });
  return {
    ok: true,
    giftVoucherId: String(voucher._id),
    recipientEmail,
    recipientOverrideUsed: Boolean(recipientOverride)
  };
}

module.exports = {
  handleActivatedGiftVoucherDelivery,
  resendRecipientGiftVoucherEmail,
  EMAIL_FAILED_CATEGORY,
  PHYSICAL_CARD_REQUIRED_CATEGORY
};
