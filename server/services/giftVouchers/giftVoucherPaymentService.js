const crypto = require('crypto');
const Stripe = require('stripe');
const GiftVoucher = require('../../models/GiftVoucher');
const GiftVoucherEvent = require('../../models/GiftVoucherEvent');
const { appendVoucherEvent } = require('./giftVoucherEventService');
const { generateUniqueVoucherCode } = require('./giftVoucherCodeService');
const { openManualReviewItem } = require('../ops/ingestion/manualReviewService');
const { handleActivatedGiftVoucherDelivery } = require('./giftVoucherEmailService');
const { ensureGiftVoucherCreatorCommissionAfterActivation } = require('./giftVoucherCommissionService');

const DEFAULT_TERMS_VERSION = 'v1';
const EUR = 'EUR';
const MIN_AMOUNT_CENTS = 1500;
const PURCHASE_ID_PATTERN = /^[A-Za-z0-9:_-]{8,128}$/;

let stripeClient = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

function setStripeClientForTesting(client) {
  stripeClient = client;
}

function normalizeText(value, maxLen = 500) {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v) return null;
  return v.slice(0, maxLen);
}

function normalizeEmail(value) {
  const v = normalizeText(value, 320);
  return v ? v.toLowerCase() : null;
}

function normalizeDeliveryMode(value) {
  const mode = normalizeText(value, 20);
  if (!mode) return 'email';
  if (mode !== 'email' && mode !== 'postal' && mode !== 'manual') {
    const err = new Error('deliveryMode must be email, postal, or manual');
    err.code = 'INVALID_DELIVERY_MODE';
    throw err;
  }
  return mode;
}

function normalizeDeliveryAddress(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const addressLine1 = normalizeText(raw.addressLine1, 200);
  const addressLine2 = normalizeText(raw.addressLine2, 200);
  const city = normalizeText(raw.city, 120);
  const postalCode = normalizeText(raw.postalCode, 40);
  const country = normalizeText(raw.country, 120);
  if (!addressLine1 && !addressLine2 && !city && !postalCode && !country) {
    return undefined;
  }
  return { addressLine1, addressLine2, city, postalCode, country };
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeAttribution(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const ref = normalizeText(raw.referralCode, 100);
  const out = {
    referralCode: ref ? ref.toLowerCase() : null,
    creatorPartnerId: raw.creatorPartnerId || null,
    landingPath: normalizeText(raw.landingPath, 500),
    utmSource: normalizeText(raw.utmSource, 200),
    utmMedium: normalizeText(raw.utmMedium, 200),
    utmCampaign: normalizeText(raw.utmCampaign, 200),
    utmTerm: normalizeText(raw.utmTerm, 200),
    utmContent: normalizeText(raw.utmContent, 200)
  };
  if (!Object.values(out).some(Boolean)) return undefined;
  return out;
}

function normalizePurchaseRequestId(value) {
  const maybe = normalizeText(value, 128);
  if (!maybe) return `gvr_${crypto.randomUUID()}`;
  if (!PURCHASE_ID_PATTERN.test(maybe)) {
    const err = new Error('purchaseRequestId is invalid');
    err.code = 'INVALID_PURCHASE_REQUEST_ID';
    throw err;
  }
  return maybe;
}

function buildPurchaseFingerprint(payload) {
  const canonical = JSON.stringify({
    amountOriginalCents: payload.amountOriginalCents,
    currency: payload.currency,
    buyerName: payload.buyerName,
    buyerEmail: payload.buyerEmail,
    recipientName: payload.recipientName,
    recipientEmail: payload.recipientEmail,
    deliveryMode: payload.deliveryMode,
    deliveryDate: payload.deliveryDate ? payload.deliveryDate.toISOString() : null,
    deliveryAddress: {
      addressLine1: payload.deliveryAddress?.addressLine1 || null,
      addressLine2: payload.deliveryAddress?.addressLine2 || null,
      city: payload.deliveryAddress?.city || null,
      postalCode: payload.deliveryAddress?.postalCode || null,
      country: payload.deliveryAddress?.country || null
    }
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function assertIntegerCents(value, fieldName) {
  if (!Number.isInteger(value)) {
    const err = new Error(`${fieldName} must be integer cents`);
    err.code = 'INVALID_AMOUNT_CENTS';
    throw err;
  }
}

function normalizeQuoteInput(input = {}) {
  const amountOriginalCents = Number(input.amountOriginalCents);
  assertIntegerCents(amountOriginalCents, 'amountOriginalCents');
  if (amountOriginalCents < MIN_AMOUNT_CENTS) {
    const err = new Error('Minimum amount is EUR 15');
    err.code = 'AMOUNT_BELOW_MINIMUM';
    throw err;
  }
  const currency = String(input.currency || EUR).toUpperCase();
  if (currency !== EUR) {
    const err = new Error('Only EUR is supported');
    err.code = 'UNSUPPORTED_CURRENCY';
    throw err;
  }
  return { amountOriginalCents, currency };
}

function quoteGiftVoucherPurchase(input = {}) {
  const normalized = normalizeQuoteInput(input);
  return {
    ok: true,
    amountOriginalCents: normalized.amountOriginalCents,
    currency: normalized.currency,
    minimumAmountCents: MIN_AMOUNT_CENTS
  };
}

async function ensureVoucherEventOnce({ giftVoucherId, type, stripeEventId = null, paymentIntentId = null, actor, note, metadata = {} }) {
  if ((type === 'paid' || type === 'activated') && !stripeEventId && !paymentIntentId) {
    const err = new Error('paid/activated events require stripeEventId or paymentIntentId');
    err.code = 'EVENT_IDEMPOTENCY_KEY_REQUIRED';
    throw err;
  }

  const eventMetadata = {
    ...(metadata || {}),
    ...(stripeEventId ? { stripeEventId: String(stripeEventId) } : {}),
    ...(paymentIntentId ? { paymentIntentId: String(paymentIntentId) } : {})
  };

  try {
    await appendVoucherEvent({
      giftVoucherId,
      type,
      actor,
      note,
      metadata: eventMetadata
    });
    return true;
  } catch (error) {
    if (error?.code === 11000) {
      return false;
    }
    throw error;
  }
}

function buildStripeMetadata({ voucher, purchaseRequestId, attribution }) {
  return {
    type: 'gift_voucher',
    giftVoucherId: String(voucher._id),
    purchaseRequestId: String(purchaseRequestId),
    referralCode: attribution?.referralCode || '',
    creatorPartnerId: attribution?.creatorPartnerId ? String(attribution.creatorPartnerId) : '',
    landingPath: attribution?.landingPath || '',
    utmSource: attribution?.utmSource || '',
    utmMedium: attribution?.utmMedium || '',
    utmCampaign: attribution?.utmCampaign || '',
    utmTerm: attribution?.utmTerm || '',
    utmContent: attribution?.utmContent || ''
  };
}

function normalizeCreateInput(input = {}) {
  const quote = normalizeQuoteInput(input);
  const buyerName = normalizeText(input.buyerName, 120);
  const buyerEmail = normalizeEmail(input.buyerEmail);
  const recipientName = normalizeText(input.recipientName, 120);
  const recipientEmail = normalizeEmail(input.recipientEmail);
  const message = normalizeText(input.message, 1000);
  const deliveryMode = normalizeDeliveryMode(input.deliveryMode);
  const deliveryAddress = normalizeDeliveryAddress(input.deliveryAddress);
  const deliveryDate = parseDate(input.deliveryDate);
  const termsAccepted = input.termsAccepted === true;
  if (!termsAccepted) {
    const err = new Error('Terms acceptance is required');
    err.code = 'TERMS_NOT_ACCEPTED';
    throw err;
  }
  if (!buyerName || !buyerEmail || !recipientName) {
    const err = new Error('buyerName, buyerEmail and recipientName are required');
    err.code = 'MISSING_REQUIRED_FIELDS';
    throw err;
  }
  if (deliveryMode === 'email' && !recipientEmail) {
    const err = new Error('recipientEmail is required for email delivery mode');
    err.code = 'MISSING_REQUIRED_FIELDS';
    throw err;
  }
  if (deliveryMode === 'postal') {
    if (!deliveryAddress?.addressLine1 || !deliveryAddress?.city || !deliveryAddress?.postalCode || !deliveryAddress?.country) {
      const err = new Error('deliveryAddress.addressLine1, city, postalCode and country are required for postal delivery mode');
      err.code = 'MISSING_REQUIRED_FIELDS';
      throw err;
    }
  }
  const purchaseRequestId = normalizePurchaseRequestId(input.purchaseRequestId);
  const attribution = normalizeAttribution(input.attribution);
  const termsVersion = normalizeText(input.termsVersion, 50) || DEFAULT_TERMS_VERSION;

  return {
    ...quote,
    buyerName,
    buyerEmail,
    recipientName,
    recipientEmail,
    message,
    deliveryMode,
    deliveryAddress,
    deliveryDate,
    purchaseRequestId,
    attribution,
    termsAcceptedAt: new Date(),
    termsVersion
  };
}

async function createGiftVoucherPaymentIntent(input = {}) {
  if (!stripeClient) {
    const err = new Error('Payment is not configured');
    err.code = 'PAYMENT_NOT_CONFIGURED';
    throw err;
  }

  const normalized = normalizeCreateInput(input);
  const purchaseFingerprint = buildPurchaseFingerprint(normalized);
  const existing = await GiftVoucher.findOne({ purchaseRequestId: normalized.purchaseRequestId });
  if (existing) {
    if (existing.purchaseFingerprint !== purchaseFingerprint) {
      const err = new Error('purchaseRequestId conflicts with an existing purchase');
      err.code = 'PURCHASE_REQUEST_CONFLICT';
      throw err;
    }
    if (existing.status === 'voided') {
      const err = new Error('purchaseRequestId is closed');
      err.code = 'PURCHASE_REQUEST_CLOSED';
      throw err;
    }
    if (existing.status === 'pending_payment' && existing.stripePaymentIntentId) {
      const existingPi = await stripeClient.paymentIntents.retrieve(existing.stripePaymentIntentId);
      return {
        ok: true,
        idempotentReplay: true,
        purchaseRequestId: normalized.purchaseRequestId,
        giftVoucherId: String(existing._id),
        stripePaymentIntentId: String(existing.stripePaymentIntentId),
        clientSecret: existingPi.client_secret || null
      };
    }
    const err = new Error('purchaseRequestId cannot be reused for current state');
    err.code = 'PURCHASE_REQUEST_CLOSED';
    throw err;
  }

  const voucher = await GiftVoucher.create({
    code: null,
    amountOriginalCents: normalized.amountOriginalCents,
    balanceRemainingCents: normalized.amountOriginalCents,
    currency: normalized.currency,
    status: 'pending_payment',
    buyerName: normalized.buyerName,
    buyerEmail: normalized.buyerEmail,
    recipientName: normalized.recipientName,
    recipientEmail: normalized.recipientEmail,
    message: normalized.message,
    deliveryMode: normalized.deliveryMode,
    deliveryAddress: normalized.deliveryAddress,
    deliveryDate: normalized.deliveryDate,
    purchaseRequestId: normalized.purchaseRequestId,
    purchaseFingerprint,
    termsAcceptedAt: normalized.termsAcceptedAt,
    termsVersion: normalized.termsVersion,
    attribution: normalized.attribution
  });

  await appendVoucherEvent({
    giftVoucherId: voucher._id,
    type: 'payment_pending',
    actor: 'guest',
    note: 'payment intent requested',
    metadata: {
      purchaseRequestId: normalized.purchaseRequestId,
      purchaseFingerprint
    }
  });

  try {
    const paymentIntent = await stripeClient.paymentIntents.create({
      amount: normalized.amountOriginalCents,
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      metadata: buildStripeMetadata({ voucher, purchaseRequestId: normalized.purchaseRequestId, attribution: normalized.attribution })
    });

    await GiftVoucher.updateOne(
      { _id: voucher._id, status: 'pending_payment' },
      {
        $set: {
          stripePaymentIntentId: String(paymentIntent.id)
        }
      }
    );

    return {
      ok: true,
      idempotentReplay: false,
      purchaseRequestId: normalized.purchaseRequestId,
      giftVoucherId: String(voucher._id),
      stripePaymentIntentId: String(paymentIntent.id),
      clientSecret: paymentIntent.client_secret || null
    };
  } catch (error) {
    await GiftVoucher.updateOne(
      { _id: voucher._id, status: 'pending_payment' },
      { $set: { status: 'voided' } }
    );
    await appendVoucherEvent({
      giftVoucherId: voucher._id,
      type: 'voided',
      actor: 'system',
      note: 'payment intent initialization failed',
      metadata: {
        purchaseRequestId: normalized.purchaseRequestId,
        reasonCode: 'PAYMENT_INTENT_INIT_FAILED'
      }
    });
    const err = new Error('Unable to initialize payment');
    err.code = 'PAYMENT_INTENT_INIT_FAILED';
    throw err;
  }
}

function resolvePaymentIntentFromEvent(event) {
  const type = event?.type;
  const obj = event?.data?.object || {};
  if (type !== 'payment_intent.succeeded' || obj.object !== 'payment_intent') {
    return null;
  }
  return obj;
}

async function openVoucherPaymentManualReview({
  category,
  severity,
  title,
  details,
  event,
  voucherId = null,
  paymentIntentId = null,
  evidence = {}
}) {
  await openManualReviewItem({
    category,
    severity,
    entityType: 'GiftVoucher',
    entityId: voucherId ? String(voucherId) : null,
    title,
    details,
    provenance: {
      source: 'stripe_webhook',
      sourceReference: String(event.id)
    },
    evidence: {
      stripeEventId: String(event.id),
      paymentIntentId: paymentIntentId ? String(paymentIntentId) : null,
      ...evidence
    }
  });
}

async function activatePaidVoucherFromStripeEvent(event) {
  const paymentIntent = resolvePaymentIntentFromEvent(event);
  if (!paymentIntent || paymentIntent.metadata?.type !== 'gift_voucher') {
    return { ok: true, ignored: true };
  }

  const metadata = paymentIntent.metadata || {};
  const voucherId = metadata.giftVoucherId ? String(metadata.giftVoucherId) : null;
  const purchaseRequestId = metadata.purchaseRequestId ? String(metadata.purchaseRequestId) : null;
  const paymentIntentId = paymentIntent.id ? String(paymentIntent.id) : null;

  if (!voucherId) {
    await openVoucherPaymentManualReview({
      category: 'payment_unlinked',
      severity: 'high',
      title: 'Gift voucher payment missing voucher reference',
      details: 'Stripe payment_intent.succeeded metadata does not include giftVoucherId',
      event,
      paymentIntentId,
      evidence: { metadata }
    });
    return { ok: false, code: 'VOUCHER_REFERENCE_MISSING' };
  }

  const voucher = await GiftVoucher.findById(voucherId);
  if (!voucher) {
    await openVoucherPaymentManualReview({
      category: 'payment_unlinked',
      severity: 'high',
      title: 'Gift voucher payment references missing voucher',
      details: `No GiftVoucher found for id ${voucherId}`,
      event,
      voucherId,
      paymentIntentId,
      evidence: { metadata }
    });
    return { ok: false, code: 'VOUCHER_NOT_FOUND' };
  }

  if (!purchaseRequestId || String(voucher.purchaseRequestId || '') !== purchaseRequestId) {
    await openVoucherPaymentManualReview({
      category: 'payment_finalization_failure',
      severity: 'high',
      title: 'Gift voucher purchaseRequestId mismatch',
      details: 'Stripe metadata purchaseRequestId does not align with voucher',
      event,
      voucherId: voucher._id,
      paymentIntentId,
      evidence: {
        expectedPurchaseRequestId: voucher.purchaseRequestId,
        receivedPurchaseRequestId: purchaseRequestId
      }
    });
    return { ok: false, code: 'PURCHASE_REQUEST_MISMATCH' };
  }

  if (!paymentIntentId || String(voucher.stripePaymentIntentId || '') !== paymentIntentId) {
    await openVoucherPaymentManualReview({
      category: 'payment_finalization_failure',
      severity: 'high',
      title: 'Gift voucher payment intent mismatch',
      details: 'Stripe payment intent id does not align with voucher',
      event,
      voucherId: voucher._id,
      paymentIntentId,
      evidence: {
        expectedPaymentIntentId: voucher.stripePaymentIntentId,
        receivedPaymentIntentId: paymentIntentId
      }
    });
    return { ok: false, code: 'PAYMENT_INTENT_MISMATCH' };
  }

  const amountCents = Number(paymentIntent.amount_received || paymentIntent.amount || 0);
  const currency = String(paymentIntent.currency || '').toUpperCase();

  if (amountCents !== voucher.amountOriginalCents) {
    await openVoucherPaymentManualReview({
      category: 'payment_finalization_failure',
      severity: 'high',
      title: 'Gift voucher payment amount mismatch',
      details: 'Payment amount does not match voucher original amount',
      event,
      voucherId: voucher._id,
      paymentIntentId,
      evidence: {
        expectedAmountCents: voucher.amountOriginalCents,
        receivedAmountCents: amountCents
      }
    });
    return { ok: false, code: 'PAYMENT_AMOUNT_MISMATCH' };
  }
  if (currency !== EUR) {
    await openVoucherPaymentManualReview({
      category: 'payment_finalization_failure',
      severity: 'high',
      title: 'Gift voucher payment currency mismatch',
      details: 'Payment currency is not EUR',
      event,
      voucherId: voucher._id,
      paymentIntentId,
      evidence: {
        expectedCurrency: EUR,
        receivedCurrency: currency
      }
    });
    return { ok: false, code: 'PAYMENT_CURRENCY_MISMATCH' };
  }

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  let latestVoucher = voucher;
  if (!(voucher.status === 'active' && voucher.code && voucher.activatedAt)) {
    const { code } = await generateUniqueVoucherCode();
    const updated = await GiftVoucher.findOneAndUpdate(
      {
        _id: voucher._id,
        status: 'pending_payment',
        stripePaymentIntentId: paymentIntentId
      },
      {
        $set: {
          status: 'active',
          code,
          activatedAt: now,
          expiresAt
        },
        $addToSet: {
          stripeEventIdsProcessed: String(event.id)
        }
      },
      { new: true }
    );
    if (!updated) {
      latestVoucher = await GiftVoucher.findById(voucher._id);
      if (!latestVoucher || latestVoucher.status !== 'active' || !latestVoucher.code || !latestVoucher.activatedAt) {
        await openVoucherPaymentManualReview({
          category: 'payment_finalization_failure',
          severity: 'critical',
          title: 'Gift voucher activation update failed',
          details: 'Could not apply guarded activation update for paid voucher',
          event,
          voucherId: voucher._id,
          paymentIntentId
        });
        return { ok: false, code: 'ACTIVATION_UPDATE_FAILED' };
      }
    } else {
      latestVoucher = updated;
    }
  } else {
    await GiftVoucher.updateOne(
      { _id: voucher._id },
      { $addToSet: { stripeEventIdsProcessed: String(event.id) } }
    );
  }

  try {
    await ensureVoucherEventOnce({
      giftVoucherId: latestVoucher._id,
      type: 'paid',
      stripeEventId: event.id,
      paymentIntentId,
      actor: 'system',
      note: 'voucher payment confirmed from stripe webhook',
      metadata: {
        stripeEventId: String(event.id),
        paymentIntentId
      }
    });
    await ensureVoucherEventOnce({
      giftVoucherId: latestVoucher._id,
      type: 'activated',
      stripeEventId: event.id,
      paymentIntentId,
      actor: 'system',
      note: 'voucher activated after successful stripe payment',
      metadata: {
        stripeEventId: String(event.id),
        paymentIntentId
      }
    });
  } catch (eventErr) {
    await openVoucherPaymentManualReview({
      category: 'payment_finalization_failure',
      severity: 'critical',
      title: 'Gift voucher activation event write failed',
      details: 'Voucher is active but paid/activated event write failed',
      event,
      voucherId: latestVoucher._id,
      paymentIntentId,
      evidence: {
        error: eventErr.message
      }
    });
    return {
      ok: true,
      activationCompleted: true,
      requiresManualReview: true,
      code: 'ACTIVATION_EVENT_WRITE_FAILED'
    };
  }

  let emailDelivery = null;
  try {
    emailDelivery = await handleActivatedGiftVoucherDelivery({
      giftVoucherId: latestVoucher._id,
      actor: 'system'
    });
  } catch (emailErr) {
    emailDelivery = {
      ok: false,
      code: emailErr.code || 'EMAIL_DELIVERY_FAILED',
      message: emailErr.message
    };
  }

  let giftVoucherCommission = null;
  try {
    giftVoucherCommission = await ensureGiftVoucherCreatorCommissionAfterActivation(latestVoucher);
  } catch (commissionErr) {
    console.error('[gift voucher] creator commission hook failed:', commissionErr?.message || commissionErr);
    giftVoucherCommission = {
      ok: false,
      error: commissionErr?.message || String(commissionErr)
    };
  }

  return {
    ok: true,
    activationCompleted: true,
    giftVoucherId: String(latestVoucher._id),
    status: latestVoucher.status,
    emailDelivery,
    giftVoucherCommission
  };
}

module.exports = {
  setStripeClientForTesting,
  quoteGiftVoucherPurchase,
  createGiftVoucherPaymentIntent,
  activatePaidVoucherFromStripeEvent,
  buildPurchaseFingerprint
};
