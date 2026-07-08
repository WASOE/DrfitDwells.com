const GiftVoucher = require('../../models/GiftVoucher');
const GiftVoucherEvent = require('../../models/GiftVoucherEvent');
const { appendVoucherEvent } = require('./giftVoucherEventService');
const {
  openManualReviewItem,
  openEmailDeliveryManualReview
} = require('../ops/ingestion/manualReviewService');
const { giftVoucherCorrelationKey } = require('../email/emailDeliveryCorrelation');
const { applyEmailDeliveryAttempt } = require('../email/emailDeliveryStateService');
const { buildCardDownloadUrl, rotateCardAccessTokenForVoucher } = require('./giftVoucherCardAccessService');
const {
  resolveActivationDeliverySteps,
  templateKindSetsSentAt
} = require('./giftVoucherDeliveryRouter');
const {
  buildBuyerReceiptDesignedEmail,
  buildRecipientVoucherDesignedEmail,
  buildBuyerGiftCardDesignedEmail,
  buildRecipientResendDesignedEmail
} = require('./giftVoucherDesignedEmailBuilder');
const emailService = require('../emailService');

const EMAIL_FAILED_CATEGORY = 'gift_voucher_email_failed';
const PHYSICAL_CARD_REQUIRED_CATEGORY = 'gift_voucher_physical_card_required';

const TEMPLATE_TRIGGERS = {
  buyer_receipt: 'gift_voucher_buyer_receipt',
  recipient_voucher: 'gift_voucher_recipient',
  buyer_gift_card: 'gift_voucher_buyer_gift_card'
};

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
      templateKind,
      recipientEmail,
      evidence: {
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

async function openEmailFailureReview({ voucher, title, details, evidence, templateKind = null, recipientEmail = null }) {
  let deliveryCorrelationKey = evidence?.deliveryCorrelationKey || null;
  if (!deliveryCorrelationKey && templateKind && recipientEmail) {
    deliveryCorrelationKey = giftVoucherCorrelationKey({
      giftVoucherId: voucher._id,
      templateKind,
      recipientEmail
    });
  }

  const mergedEvidence = {
    ...evidence,
    giftVoucherId: String(voucher._id),
    ...(deliveryCorrelationKey ? { deliveryCorrelationKey } : {})
  };

  let item;
  if (deliveryCorrelationKey) {
    item = await openEmailDeliveryManualReview({
      category: EMAIL_FAILED_CATEGORY,
      severity: 'high',
      entityType: 'GiftVoucher',
      entityId: voucher._id,
      title,
      details,
      provenance: {
        source: 'gift_voucher_email'
      },
      evidence: mergedEvidence
    });
  } else {
    item = await openManualReviewItem({
      category: EMAIL_FAILED_CATEGORY,
      severity: 'high',
      entityType: 'GiftVoucher',
      entityId: voucher._id,
      title,
      details,
      provenance: {
        source: 'gift_voucher_email'
      },
      evidence: mergedEvidence
    });
  }

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

async function markSentAtIfNeeded(voucherId, templateKind) {
  if (!templateKindSetsSentAt(templateKind)) return;
  await GiftVoucher.updateOne({ _id: voucherId, sentAt: null }, { $set: { sentAt: new Date() } });
}

async function findLifecycleState(giftVoucherId, emailLifecycleKey) {
  const [sent, sendFailed, sendAttempted] = await Promise.all([
    GiftVoucherEvent.findOne({
      giftVoucherId,
      type: 'sent',
      'metadata.emailLifecycleKey': emailLifecycleKey
    }).lean(),
    GiftVoucherEvent.findOne({
      giftVoucherId,
      type: 'send_failed',
      'metadata.emailLifecycleKey': emailLifecycleKey
    }).lean(),
    GiftVoucherEvent.findOne({
      giftVoucherId,
      type: 'send_attempted',
      'metadata.emailLifecycleKey': emailLifecycleKey
    }).lean()
  ]);
  return { sent, sendFailed, sendAttempted };
}

function buildTemplatePayload({
  templateKind,
  voucher,
  recipientEmail,
  cardDownloadUrl,
  variant = null
}) {
  switch (templateKind) {
    case 'buyer_receipt':
      return buildBuyerReceiptDesignedEmail({ voucher, cardDownloadUrl, variant });
    case 'recipient_voucher':
      return buildRecipientVoucherDesignedEmail({ voucher, recipientEmail, cardDownloadUrl });
    case 'buyer_gift_card':
      return buildBuyerGiftCardDesignedEmail({ voucher, cardDownloadUrl });
    default:
      throw new Error(`Unsupported templateKind ${templateKind}`);
  }
}

async function performLifecycleSend({
  voucher,
  recipientEmail,
  templateKind,
  actor = 'system',
  cardDownloadUrl = null,
  variant = null,
  allowRetryAfterFailure = false,
  lifecycleSource = 'automatic'
}) {
  if (templateKind === 'recipient_voucher' && !String(recipientEmail || '').trim()) {
    const err = new Error('Recipient email is required for recipient voucher delivery');
    err.code = 'MISSING_RECIPIENT_EMAIL';
    throw err;
  }

  const key = lifecycleKey(templateKind, voucher._id);
  let lifecycleState = await findLifecycleState(voucher._id, key);

  if (lifecycleState.sent) {
    return {
      ok: true,
      skipped: true,
      reason: 'already_sent',
      emailLifecycleKey: key
    };
  }

  const isRetryAfterFailure =
    allowRetryAfterFailure && lifecycleState.sendAttempted && lifecycleState.sendFailed;

  if (lifecycleState.sendAttempted && lifecycleState.sendFailed && !allowRetryAfterFailure) {
    return {
      ok: true,
      skipped: true,
      reason: 'already_failed',
      emailLifecycleKey: key
    };
  }

  if (!isRetryAfterFailure) {
    const attempted = await appendEventOnce({
      giftVoucherId: voucher._id,
      type: 'send_attempted',
      actor,
      note: `${templateKind} delivery attempted`,
      metadata: {
        emailLifecycleKey: key,
        templateKind,
        recipientEmail,
        ...(lifecycleSource !== 'automatic' ? { lifecycleSource } : {})
      }
    });

    if (!attempted.inserted) {
      lifecycleState = await findLifecycleState(voucher._id, key);
      if (lifecycleState.sent) {
        return {
          ok: true,
          skipped: true,
          reason: 'already_sent',
          emailLifecycleKey: key
        };
      }
      if (allowRetryAfterFailure && lifecycleState.sendAttempted && lifecycleState.sendFailed) {
        // Another worker won send_attempted first; continue as retry.
      } else {
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
    }
  } else if (lifecycleState.sendAttempted && !lifecycleState.sendFailed) {
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

  const template = buildTemplatePayload({
    templateKind,
    voucher,
    recipientEmail,
    cardDownloadUrl,
    variant
  });
  const normalizedRecipient = String(recipientEmail || '').trim().toLowerCase();
  const deliveryCorrelationKey = giftVoucherCorrelationKey({
    giftVoucherId: voucher._id,
    templateKind,
    recipientEmail: normalizedRecipient
  });
  const trigger = TEMPLATE_TRIGGERS[templateKind] || `gift_voucher_${templateKind}`;

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
    if (!isRetryAfterFailure) {
      await appendEventOnce({
        giftVoucherId: voucher._id,
        type: 'send_failed',
        actor,
        note: `${templateKind} delivery failed`,
        metadata: {
          emailLifecycleKey: key,
          templateKind,
          recipientEmail: normalizedRecipient,
          error: sendErr.message || 'unknown_send_exception',
          thrown: true,
          ...(lifecycleSource !== 'automatic' ? { lifecycleSource } : {})
        }
      });
      await applyEmailDeliveryAttempt({
        correlationKey: deliveryCorrelationKey,
        domain: 'gift_voucher',
        giftVoucherId: voucher._id,
        templateKind,
        recipient: normalizedRecipient,
        sendStatus: 'failed',
        lifecycleSource,
        errorMessage: sendErr.message || 'unknown_send_exception',
        actorRole: actor
      });
    }
    return {
      ok: false,
      status: 'failed',
      code: 'EMAIL_SEND_FAILED',
      emailLifecycleKey: key,
      isRetryAfterFailure
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
        recipientEmail: normalizedRecipient,
        messageId: sendResult.messageId || null,
        ...(lifecycleSource !== 'automatic' ? { lifecycleSource } : {})
      }
    });
    await applyEmailDeliveryAttempt({
      correlationKey: deliveryCorrelationKey,
      domain: 'gift_voucher',
      giftVoucherId: voucher._id,
      templateKind,
      recipient: normalizedRecipient,
      sendStatus: 'success',
      lifecycleSource,
      actorRole: actor
    });
    await markSentAtIfNeeded(voucher._id, templateKind);
    return {
      ok: true,
      status: 'sent',
      emailLifecycleKey: key,
      isRetryAfterFailure
    };
  }

  if (!isRetryAfterFailure) {
    await appendEventOnce({
      giftVoucherId: voucher._id,
      type: 'send_failed',
      actor,
      note: `${templateKind} delivery failed`,
      metadata: {
        emailLifecycleKey: key,
        templateKind,
        recipientEmail: normalizedRecipient,
        error: sendResult.error || 'unknown_send_failure',
        ...(lifecycleSource !== 'automatic' ? { lifecycleSource } : {})
      }
    });
    await applyEmailDeliveryAttempt({
      correlationKey: deliveryCorrelationKey,
      domain: 'gift_voucher',
      giftVoucherId: voucher._id,
      templateKind,
      recipient: normalizedRecipient,
      sendStatus: 'failed',
      lifecycleSource,
      errorMessage: sendResult.error || 'unknown_send_failure',
      actorRole: actor
    });
  }
  return {
    ok: false,
    status: 'failed',
    code: 'EMAIL_SEND_FAILED',
    emailLifecycleKey: key,
    isRetryAfterFailure
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

async function recordRecipientDeliveryDeferred({ voucher, actor = 'system', scheduledDeliveryDate = null }) {
  const key = lifecycleKey('recipient_delivery_deferred', voucher._id);
  const inserted = await appendEventOnce({
    giftVoucherId: voucher._id,
    type: 'recipient_delivery_deferred',
    actor,
    note: 'recipient gift card delivery deferred until scheduled date',
    metadata: {
      emailLifecycleKey: key,
      deliveryOption: 'scheduled',
      scheduledDeliveryDate: scheduledDeliveryDate ? new Date(scheduledDeliveryDate).toISOString() : null,
      reason: 'awaiting_scheduled_delivery_worker'
    }
  });
  if (!inserted.inserted) {
    return { ok: true, skipped: true, reason: 'already_deferred', emailLifecycleKey: key };
  }
  return { ok: true, status: 'deferred', emailLifecycleKey: key };
}

async function handleActivatedGiftVoucherDelivery({
  giftVoucherId,
  actor = 'system',
  cardAccessToken = null
} = {}) {
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

  const route = resolveActivationDeliverySteps(voucher);
  if (route.skip) {
    return { ok: true, skipped: true, reason: route.reason, steps: [] };
  }

  const cardDownloadUrl = cardAccessToken ? buildCardDownloadUrl(cardAccessToken) : null;
  const outcomes = [];

  for (const step of route.steps) {
    if (step.type === 'email') {
      const downloadUrl = step.includeDownloadLink ? cardDownloadUrl : null;
      outcomes.push(
        await performLifecycleSend({
          voucher,
          recipientEmail: step.recipientEmail,
          templateKind: step.templateKind,
          actor,
          cardDownloadUrl: downloadUrl,
          variant: step.variant || null
        })
      );
    } else if (step.type === 'defer_recipient') {
      outcomes.push(
        await recordRecipientDeliveryDeferred({
          voucher,
          actor,
          scheduledDeliveryDate: step.scheduledDeliveryDate
        })
      );
    } else if (step.type === 'physical_card_review') {
      outcomes.push(await createPhysicalCardManualReview({ voucher, actor }));
    }
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
  const resendableStatuses = new Set(['active', 'partially_redeemed']);
  if (!resendableStatuses.has(voucher.status) || !voucher.code) {
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

  const { rawToken } = await rotateCardAccessTokenForVoucher(voucher._id);
  const cardDownloadUrl = buildCardDownloadUrl(rawToken);

  const deliveryCorrelationKey = giftVoucherCorrelationKey({
    giftVoucherId: voucher._id,
    templateKind: 'recipient_voucher',
    recipientEmail
  });

  const template = buildRecipientResendDesignedEmail({ voucher, recipientEmail, cardDownloadUrl });
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
    await applyEmailDeliveryAttempt({
      correlationKey: deliveryCorrelationKey,
      domain: 'gift_voucher',
      giftVoucherId: voucher._id,
      templateKind: 'recipient_voucher',
      recipient: recipientEmail,
      sendStatus: 'failed',
      lifecycleSource: 'manual_resend',
      errorMessage: sendResult.error || 'unknown_send_failure',
      actorRole: actor
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
      messageId: sendResult.messageId || null,
      cardAccessTokenRotated: true
    }
  });
  await applyEmailDeliveryAttempt({
    correlationKey: deliveryCorrelationKey,
    domain: 'gift_voucher',
    giftVoucherId: voucher._id,
    templateKind: 'recipient_voucher',
    recipient: recipientEmail,
    sendStatus: 'success',
    lifecycleSource: 'manual_resend',
    actorRole: actor
  });
  return {
    ok: true,
    giftVoucherId: String(voucher._id),
    recipientEmail,
    recipientOverrideUsed: Boolean(recipientOverride),
    cardAccessTokenRotated: true,
    cardDownloadUrl
  };
}

module.exports = {
  handleActivatedGiftVoucherDelivery,
  resendRecipientGiftVoucherEmail,
  performLifecycleSend,
  findLifecycleState,
  lifecycleKey,
  appendEventOnce,
  openEmailFailureReview,
  EMAIL_FAILED_CATEGORY,
  PHYSICAL_CARD_REQUIRED_CATEGORY
};
