'use strict';

const PAID_STATUSES = new Set(['active', 'partially_redeemed', 'redeemed', 'expired']);
const CLEANABLE_STATUSES = ['pending_payment', 'voided', 'draft', 'refunded'];

const NOISE_PURCHASE_REQUEST_PREFIXES = ['gvr_smoke_', 'gvr_audit_', 'gvr_ratelimit_'];

function isTruthyEnv(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function isDryRunEnv(env = process.env) {
  const raw = env.DRY_RUN;
  if (raw === '0' || String(raw).toLowerCase() === 'false') return false;
  return true;
}

function parseOlderThanHours(env = process.env) {
  const parsed = Number.parseInt(String(env.CLEANUP_OLDER_THAN_HOURS || '0'), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function hasPaymentSuccessEvidence(voucher, events = []) {
  if (!voucher) return false;
  if (PAID_STATUSES.has(voucher.status)) return true;
  if (voucher.code) return true;
  if (voucher.activatedAt) return true;
  if (Array.isArray(voucher.stripeEventIdsProcessed) && voucher.stripeEventIdsProcessed.length > 0) {
    return true;
  }
  return events.some((event) => event?.type === 'paid' || event?.type === 'activated');
}

function collectNoiseReasons(voucher, { includeJoseKremenaTests = false } = {}) {
  const reasons = [];
  const purchaseRequestId = String(voucher.purchaseRequestId || '');
  for (const prefix of NOISE_PURCHASE_REQUEST_PREFIXES) {
    if (purchaseRequestId.toLowerCase().startsWith(prefix)) {
      reasons.push(`${prefix.replace(/_$/, '')}_purchase_request`);
    }
  }

  const buyerName = String(voucher.buyerName || '');
  const recipientName = String(voucher.recipientName || '');
  const buyerEmail = String(voucher.buyerEmail || '').toLowerCase();
  const recipientEmail = String(voucher.recipientEmail || '').toLowerCase();

  if (/^SMOKE PAYMENTS/i.test(buyerName)) reasons.push('smoke_buyer_name');
  if (/^Audit Buyer/i.test(buyerName)) reasons.push('audit_buyer_name');
  if (buyerEmail.includes('example.com')) reasons.push('example_com_buyer_email');
  if (recipientEmail.includes('example.com')) reasons.push('example_com_recipient_email');

  if (/^R[1-6]$/i.test(recipientName.trim()) && (buyerEmail.includes('example.com') || recipientEmail.includes('example.com'))) {
    reasons.push('example_com_r_recipient_name');
  }
  if (/^R[1-6]$/i.test(buyerName.trim()) && buyerEmail.includes('example.com')) {
    reasons.push('example_com_r_buyer_name');
  }

  if (voucher.issuanceSource && voucher.issuanceSource !== 'purchase') {
    reasons.push('non_purchase_issuance');
  }

  if (includeJoseKremenaTests && voucher.status === 'pending_payment') {
    const joseKremenaPattern = /jose|kremena/i;
    if (
      joseKremenaPattern.test(buyerName) ||
      joseKremenaPattern.test(recipientName) ||
      joseKremenaPattern.test(buyerEmail) ||
      joseKremenaPattern.test(recipientEmail)
    ) {
      reasons.push('jose_kremena_test');
    }
  }

  return [...new Set(reasons)];
}

function isOlderThanCutoff(voucher, olderThanHours) {
  if (!olderThanHours || olderThanHours <= 0) return true;
  const createdAt = voucher?.createdAt ? new Date(voucher.createdAt) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime())) return true;
  const cutoff = Date.now() - olderThanHours * 60 * 60 * 1000;
  return createdAt.getTime() <= cutoff;
}

function classifyGiftVoucherNoiseRecord(voucher, options = {}) {
  const events = Array.isArray(options.events) ? options.events : [];
  const includeJoseKremenaTests = Boolean(options.includeJoseKremenaTests);
  const olderThanHours = Number(options.olderThanHours || 0);

  if (!voucher) {
    return { matched: false, skippedSafety: true, reason: 'missing_voucher' };
  }

  if (PAID_STATUSES.has(voucher.status)) {
    return { matched: false, skippedPaid: true, reason: 'paid_status' };
  }

  if (!CLEANABLE_STATUSES.includes(voucher.status)) {
    return { matched: false, skippedSafety: true, reason: 'non_cleanable_status' };
  }

  if (!isOlderThanCutoff(voucher, olderThanHours)) {
    return { matched: false, skippedSafety: true, reason: 'too_recent' };
  }

  const reasons = collectNoiseReasons(voucher, { includeJoseKremenaTests });
  if (reasons.length === 0) {
    return { matched: false, skippedSafety: true, reason: 'no_noise_markers' };
  }

  if (hasPaymentSuccessEvidence(voucher, events)) {
    return { matched: false, skippedSafety: true, reason: 'payment_success_evidence', reasons };
  }

  const alreadyVoided = voucher.status === 'voided';
  return {
    matched: true,
    reasons,
    alreadyVoided,
    wouldUpdate: !alreadyVoided,
    action: alreadyVoided ? 'leave_voided' : 'void'
  };
}

function buildCandidateQuery({ includeJoseKremenaTests = false } = {}) {
  const orClauses = [
    { purchaseRequestId: { $regex: '^gvr_smoke_', $options: 'i' } },
    { purchaseRequestId: { $regex: '^gvr_audit_', $options: 'i' } },
    { purchaseRequestId: { $regex: '^gvr_ratelimit_', $options: 'i' } },
    { buyerName: { $regex: '^SMOKE PAYMENTS', $options: 'i' } },
    { buyerName: { $regex: '^Audit Buyer', $options: 'i' } },
    { buyerEmail: { $regex: 'example\\.com', $options: 'i' } },
    { recipientEmail: { $regex: 'example\\.com', $options: 'i' } },
    { issuanceSource: { $ne: 'purchase' } }
  ];

  if (includeJoseKremenaTests) {
    const joseKremena = { $regex: 'jose|kremena', $options: 'i' };
    orClauses.push(
      { buyerName: joseKremena },
      { recipientName: joseKremena },
      { buyerEmail: joseKremena },
      { recipientEmail: joseKremena }
    );
  }

  return {
    status: { $in: CLEANABLE_STATUSES },
    $or: orClauses
  };
}

function groupReasonCounts(classifications) {
  const grouped = {};
  for (const item of classifications) {
    for (const reason of item.reasons || []) {
      grouped[reason] = (grouped[reason] || 0) + 1;
    }
    if (item.reason && !item.reasons?.length) {
      grouped[item.reason] = (grouped[item.reason] || 0) + 1;
    }
  }
  return grouped;
}

module.exports = {
  PAID_STATUSES,
  CLEANABLE_STATUSES,
  isDryRunEnv,
  isTruthyEnv,
  parseOlderThanHours,
  hasPaymentSuccessEvidence,
  collectNoiseReasons,
  classifyGiftVoucherNoiseRecord,
  buildCandidateQuery,
  groupReasonCounts
};
