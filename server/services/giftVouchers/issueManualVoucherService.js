const { createHash } = require('node:crypto');
const GiftVoucher = require('../../models/GiftVoucher');
const GiftVoucherEvent = require('../../models/GiftVoucherEvent');
const { requirePermission, ACTIONS } = require('../permissionService');
const { MIN_GIFT_VOUCHER_AMOUNT_CENTS } = require('./giftVoucherConstants');
const { ISSUANCE_SOURCE_GOODWILL_OPS } = require('./giftVoucherIssuance');
const { generateUniqueVoucherCode } = require('./giftVoucherCodeService');
const { issueCardAccessToken } = require('./giftVoucherCardAccessService');
const { appendVoucherEvent } = require('./giftVoucherEventService');

function invalid(message, code = 'INVALID_MANUAL_ISSUANCE') {
  return Object.assign(new Error(message), { code });
}

async function assertManualIssuanceIndex() {
  const indexes = await GiftVoucher.collection.indexes();
  const spec = GiftVoucher.MANUAL_ISSUANCE_INDEX;
  const index = indexes.find((entry) => entry.name === spec.options.name);
  if (!index || index.unique !== true ||
      JSON.stringify(index.key) !== JSON.stringify(spec.keys) ||
      JSON.stringify(index.partialFilterExpression) !== JSON.stringify(spec.options.partialFilterExpression) ||
      index.sparse || index.hidden || index.collation) {
    throw invalid('Manual issuance index must be installed before issuing vouchers', 'MANUAL_ISSUANCE_INDEX_REQUIRED');
  }
}

async function ensureIssuanceEvent(voucher) {
  // The voucher holds the original audit data atomically; retry repairs a failed event append.
  // Using its ID in this separate collection gives the event an unconditional unique key.
  try {
    await appendVoucherEvent({
      eventId: voucher._id,
      giftVoucherId: voucher._id,
      type: 'created',
      actor: voucher.issuedByActorId,
      note: voucher.compensationNote,
      createdAt: voucher.activatedAt,
      metadata: {
        action: 'ops_issue_manual',
        issuanceSource: ISSUANCE_SOURCE_GOODWILL_OPS,
        idempotencyKey: voucher.manualIssuanceKey,
        amountCents: voucher.amountOriginalCents
      }
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const existing = await GiftVoucherEvent.findById(voucher._id).lean();
    if (!existing || String(existing.giftVoucherId) !== String(voucher._id) ||
        existing.metadata?.action !== 'ops_issue_manual') throw error;
  }
}

async function issueManualVoucher({ amountCents, recipientName = '', recipientEmail = '', reason, ctx = {} } = {}) {
  requirePermission({ role: ctx.user?.role, action: ACTIONS.OPS_GIFT_VOUCHER_ISSUE });
  const actor = String(ctx.user?.id || '').trim();
  if (!actor) throw invalid('Issuer identity is required');
  const key = ctx.idempotencyKey;
  if (typeof key !== 'string' || key.trim().length < 3 || key.trim().length > 120) {
    throw invalid('idempotencyKey must be 3-120 characters', 'IDEMPOTENCY_KEY_REQUIRED');
  }
  if (!Number.isSafeInteger(amountCents) || amountCents < MIN_GIFT_VOUCHER_AMOUNT_CENTS) {
    throw invalid(`amountCents must be integer cents, at least ${MIN_GIFT_VOUCHER_AMOUNT_CENTS}`);
  }
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) {
    throw invalid('Internal reason is required (maximum 500 characters)');
  }
  if (typeof recipientName !== 'string' || recipientName.trim().length > 200) {
    throw invalid('recipientName must be at most 200 characters');
  }
  if (typeof recipientEmail !== 'string' || recipientEmail.trim().length > 254 ||
      (recipientEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail.trim()))) {
    throw invalid('recipientEmail must be a valid email', 'INVALID_RECIPIENT_EMAIL');
  }
  const payload = {
    amountCents,
    recipientName: recipientName.trim(),
    recipientEmail: recipientEmail.trim().toLowerCase(),
    reason: reason.trim(),
    actor
  };
  const manualIssuanceKey = key.trim();
  const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  await assertManualIssuanceIndex();
  let voucher = await GiftVoucher.findOne({ manualIssuanceKey }).lean();
  let idempotentReplay = Boolean(voucher);
  if (!voucher) {
    const { code } = await generateUniqueVoucherCode();
    const { tokenHash } = issueCardAccessToken();
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    try {
      const created = await GiftVoucher.create({
        code,
        status: 'active',
        amountOriginalCents: amountCents,
        balanceRemainingCents: amountCents,
        currency: 'EUR',
        deliveryMode: 'manual',
        issuanceSource: ISSUANCE_SOURCE_GOODWILL_OPS,
        issuedByActorId: actor,
        compensationNote: payload.reason,
        recipientName: payload.recipientName || null,
        recipientEmail: payload.recipientEmail || null,
        activatedAt: now,
        expiresAt,
        cardAccessTokenHash: tokenHash,
        manualIssuanceKey,
        manualIssuanceFingerprint: fingerprint
      });
      voucher = created.toObject();
    } catch (error) {
      if (error.code !== 11000) throw error;
      voucher = await GiftVoucher.findOne({ manualIssuanceKey }).lean();
      if (!voucher) throw error;
      idempotentReplay = true;
    }
  }
  if (voucher.manualIssuanceFingerprint !== fingerprint) {
    throw invalid('This idempotency key was already used with a different payload or issuer', 'IDEMPOTENCY_CONFLICT');
  }
  await ensureIssuanceEvent(voucher);
  return {
    ok: true,
    idempotentReplay,
    giftVoucherId: String(voucher._id),
    code: voucher.code,
    balanceRemainingCents: voucher.balanceRemainingCents,
    amountOriginalCents: voucher.amountOriginalCents,
    currency: voucher.currency,
    expiresAt: voucher.expiresAt,
    issuanceSource: voucher.issuanceSource
  };
}

module.exports = { issueManualVoucher, assertManualIssuanceIndex };
