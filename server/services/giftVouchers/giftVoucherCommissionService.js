const mongoose = require('mongoose');
const GiftVoucherCreatorCommission = require('../../models/GiftVoucherCreatorCommission');
const CreatorPartner = require('../../models/CreatorPartner');
const { normalizeReferralCode } = require('../../models/CreatorPartner');
const { openManualReviewItem } = require('../ops/ingestion/manualReviewService');

const CREATOR_STATUSES_ATTRIBUTABLE = new Set(['active', 'paused', 'archived']);

/** Paid / redeemable voucher lifecycle statuses eligible for commission accrual. */
const COMMISSION_ELIGIBLE_VOUCHER_STATUSES = new Set([
  'active',
  'partially_redeemed',
  'redeemed',
  'expired'
]);

function computeCommissionAmountCents(amountOriginalCents, rateBps) {
  const amt = Math.max(0, Math.trunc(Number(amountOriginalCents) || 0));
  const bps = Math.max(0, Math.min(10000, Math.trunc(Number(rateBps) || 0)));
  return Math.floor((amt * bps) / 10000);
}

function toObjectIdMaybe(value) {
  if (value == null) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const s = String(value).trim();
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

/**
 * Resolve creator for voucher purchase commission.
 * @returns {Promise<{ ok: true, creator: object, referralCode: string|null } | { ok: false, code: string, conflict?: boolean, byReferral?: object, byId?: object, refNorm?: string }>}
 */
async function resolveCreatorAttributionForVoucher(voucherDoc) {
  const attr = voucherDoc?.attribution || {};
  const refNorm = normalizeReferralCode(attr.referralCode);
  const idObj = toObjectIdMaybe(attr.creatorPartnerId);

  let byReferral = null;
  if (refNorm) {
    byReferral = await CreatorPartner.findOne({ 'referral.code': refNorm })
      .select('_id status referral commission')
      .lean();
    if (byReferral && !CREATOR_STATUSES_ATTRIBUTABLE.has(byReferral.status)) {
      byReferral = null;
    }
  }

  let byId = null;
  if (idObj) {
    byId = await CreatorPartner.findById(idObj).select('_id status referral commission').lean();
    if (byId && !CREATOR_STATUSES_ATTRIBUTABLE.has(byId.status)) {
      byId = null;
    }
  }

  if (!refNorm && !idObj) {
    return { ok: false, code: 'no_attribution' };
  }

  if (refNorm && idObj) {
    if (byReferral && byId && String(byReferral._id) === String(byId._id)) {
      return {
        ok: true,
        creator: byReferral,
        referralCode: refNorm
      };
    }
    if (byReferral && byId) {
      return {
        ok: false,
        code: 'attribution_conflict',
        conflict: true,
        byReferral,
        byId,
        refNorm
      };
    }
    if (byReferral && !byId) {
      return { ok: false, code: 'invalid_creator_partner_id', conflict: true, byReferral, refNorm };
    }
    if (!byReferral && byId) {
      return { ok: false, code: 'referral_unknown_for_creator_id', conflict: true, byId, refNorm };
    }
    return { ok: false, code: 'unknown_attribution', conflict: true, refNorm };
  }

  if (!refNorm && idObj) {
    if (!byId) return { ok: false, code: 'unknown_creator_partner_id' };
    return {
      ok: true,
      creator: byId,
      referralCode: normalizeReferralCode(byId.referral?.code) || null
    };
  }

  if (!byReferral) return { ok: false, code: 'unknown_referral' };
  return {
    ok: true,
    creator: byReferral,
    referralCode: refNorm
  };
}

function hasEnoughEvidenceForGiftVoucherAttributionConflictReview(voucherDoc, resolved) {
  const attr = voucherDoc?.attribution;
  const hasPayload = !!(attr?.referralCode || attr?.creatorPartnerId);
  const hasResolvedContext = !!(resolved?.byReferral || resolved?.byId || resolved?.refNorm);
  return hasPayload || hasResolvedContext;
}

async function maybeOpenCommissionConflictReview({ voucherDoc, resolved, actor = 'system' }) {
  if (!hasEnoughEvidenceForGiftVoucherAttributionConflictReview(voucherDoc, resolved)) {
    return;
  }
  try {
    await openManualReviewItem({
      category: 'gift_voucher_commission_conflict',
      severity: 'medium',
      entityType: 'GiftVoucher',
      entityId: String(voucherDoc._id),
      title: 'Gift voucher purchase attribution conflict',
      details: 'creatorPartnerId and referralCode disagree or one side is invalid.',
      provenance: { source: 'gift_voucher_commission', sourceReference: actor },
      evidence: {
        voucherId: String(voucherDoc._id),
        attribution: voucherDoc.attribution || {},
        resolutionCode: resolved.code,
        conflictPair:
          resolved.byReferral?._id || resolved.byId?._id
            ? {
                referralCreatorId: resolved.byReferral?._id ? String(resolved.byReferral._id) : null,
                idCreatorId: resolved.byId?._id ? String(resolved.byId._id) : null
              }
            : undefined
      }
    });
  } catch {
    /* non-fatal */
  }
}

/**
 * Idempotent commission row creation after voucher activation.
 * Never throws to caller of activation (caller should still try/catch).
 */
async function ensureGiftVoucherCreatorCommissionAfterActivation(voucherDoc, { actor = 'system' } = {}) {
  const voucherId = voucherDoc?._id;
  if (!voucherId) {
    return { ok: false, code: 'missing_voucher' };
  }

  const existing = await GiftVoucherCreatorCommission.findOne({ giftVoucherId: voucherId }).lean();
  if (existing) {
    return { ok: true, idempotent: true, giftVoucherCreatorCommissionId: String(existing._id) };
  }

  const voucherStatus = String(voucherDoc?.status || '').trim();
  if (!COMMISSION_ELIGIBLE_VOUCHER_STATUSES.has(voucherStatus)) {
    return { ok: true, skipped: true, code: 'voucher_status_ineligible_for_commission' };
  }

  const resolved = await resolveCreatorAttributionForVoucher(voucherDoc);
  if (!resolved.ok) {
    if (resolved.conflict) {
      await maybeOpenCommissionConflictReview({ voucherDoc, resolved, actor });
      return {
        ok: true,
        skipped: true,
        blocked: true,
        code: resolved.code
      };
    }
    return { ok: true, skipped: true, code: resolved.code };
  }

  const rateBps = Math.max(0, Math.min(10000, Number(resolved.creator?.commission?.rateBps) || 0));
  const commissionableRevenueCents = Math.max(0, Math.trunc(Number(voucherDoc.amountOriginalCents) || 0));
  const commissionAmountCents = computeCommissionAmountCents(commissionableRevenueCents, rateBps);

  try {
    const row = await GiftVoucherCreatorCommission.create({
      giftVoucherId: voucherId,
      creatorPartnerId: resolved.creator._id,
      referralCode: resolved.referralCode,
      stripePaymentIntentId: voucherDoc.stripePaymentIntentId ? String(voucherDoc.stripePaymentIntentId) : null,
      amountOriginalCents: voucherDoc.amountOriginalCents,
      commissionableRevenueCents,
      commissionRateBps: rateBps,
      commissionAmountCents,
      status: 'pending',
      eligibilityStatus: 'pending_manual_approval',
      source: 'gift_voucher_referral',
      metadata: {}
    });
    return {
      ok: true,
      created: true,
      giftVoucherCreatorCommissionId: String(row._id),
      creatorPartnerId: String(resolved.creator._id)
    };
  } catch (e) {
    if (e?.code === 11000) {
      return { ok: true, idempotent: true };
    }
    throw e;
  }
}

module.exports = {
  ensureGiftVoucherCreatorCommissionAfterActivation,
  resolveCreatorAttributionForVoucher,
  computeCommissionAmountCents
};
