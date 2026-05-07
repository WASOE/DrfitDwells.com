const GiftVoucher = require('../../../models/GiftVoucher');
const GiftVoucherEvent = require('../../../models/GiftVoucherEvent');
const { appendVoucherEvent, appendFinancialVoucherEvent } = require('../../giftVouchers/giftVoucherEventService');
const { resendRecipientGiftVoucherEmail } = require('../../giftVouchers/giftVoucherEmailService');
const { requirePermission, ACTIONS } = require('../../permissionService');

const ALLOWED_VOID_STATUSES = new Set(['pending_payment', 'active', 'partially_redeemed', 'expired']);
const BLOCKED_VOID_STATUSES = new Set(['redeemed', 'refunded']);
const ALLOWED_EXTEND_STATUSES = new Set(['active', 'partially_redeemed', 'expired']);
const BLOCKED_EXTEND_STATUSES = new Set(['voided', 'refunded', 'redeemed']);

function getIdempotencyKey(ctx = {}) {
  const fromCtx = ctx.idempotencyKey ? String(ctx.idempotencyKey).trim() : '';
  const fromHeader = ctx.req?.headers?.['x-idempotency-key']
    ? String(ctx.req.headers['x-idempotency-key']).trim()
    : '';
  const key = fromCtx || fromHeader;
  if (!key) {
    const err = new Error('idempotencyKey is required');
    err.code = 'IDEMPOTENCY_KEY_REQUIRED';
    throw err;
  }
  return key.slice(0, 120);
}

function ensureManagePermission(ctx = {}) {
  requirePermission({
    role: ctx.user?.role,
    action: ACTIONS.OPS_GIFT_VOUCHER_MANAGE
  });
}

function ensureReadPermission(ctx = {}) {
  requirePermission({
    role: ctx.user?.role,
    action: ACTIONS.OPS_GIFT_VOUCHER_READ
  });
}

function actorFromCtx(ctx = {}) {
  return String(ctx.user?.id || ctx.user?.email || 'ops').trim();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function parseFutureDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const err = new Error('expiresAt must be a valid ISO date');
    err.code = 'INVALID_EXPIRES_AT';
    throw err;
  }
  return date;
}

function ensureNoteReason(note, reason) {
  if (!String(note || '').trim()) {
    const err = new Error('note is required');
    err.code = 'NOTE_REQUIRED';
    throw err;
  }
  if (!String(reason || '').trim()) {
    const err = new Error('reason is required');
    err.code = 'REASON_REQUIRED';
    throw err;
  }
}

async function findIdempotentEventByKey({ giftVoucherId, action, idempotencyKey }) {
  return GiftVoucherEvent.findOne({
    giftVoucherId,
    'metadata.action': action,
    'metadata.idempotencyKey': idempotencyKey
  })
    .select('_id type metadata createdAt')
    .lean();
}

function statusFromBalance(balance, original) {
  if (balance === 0) return 'redeemed';
  if (balance === original) return 'active';
  return 'partially_redeemed';
}

async function resendVoucher({
  giftVoucherId,
  recipientOverride = null,
  note = '',
  ctx = {}
}) {
  ensureManagePermission(ctx);
  const idempotencyKey = getIdempotencyKey(ctx);
  const actor = actorFromCtx(ctx);

  const existing = await findIdempotentEventByKey({
    giftVoucherId,
    action: 'ops_resend',
    idempotencyKey
  });
  if (existing) {
    return { ok: true, idempotentReplay: true, eventType: existing.type };
  }

  const result = await resendRecipientGiftVoucherEmail({
    giftVoucherId,
    actor,
    recipientOverride
  });

  await appendVoucherEvent({
    giftVoucherId,
    type: 'sent',
    actor,
    note: String(note || '').trim() || 'ops resend recipient voucher',
    metadata: {
      action: 'ops_resend',
      idempotencyKey,
      recipientOverride: recipientOverride ? normalizeEmail(recipientOverride) : null,
      recipientOverrideUsed: Boolean(recipientOverride)
    }
  });

  return {
    ok: true,
    idempotentReplay: false,
    recipientEmail: result.recipientEmail,
    recipientOverrideUsed: result.recipientOverrideUsed
  };
}

async function voidVoucher({
  giftVoucherId,
  note,
  reason,
  ctx = {}
}) {
  ensureManagePermission(ctx);
  ensureNoteReason(note, reason);
  const idempotencyKey = getIdempotencyKey(ctx);
  const actor = actorFromCtx(ctx);

  const existing = await findIdempotentEventByKey({
    giftVoucherId,
    action: 'ops_void',
    idempotencyKey
  });
  if (existing) return { ok: true, idempotentReplay: true, status: 'voided' };

  const voucher = await GiftVoucher.findById(giftVoucherId);
  if (!voucher) {
    const err = new Error('Gift voucher not found');
    err.code = 'GIFT_VOUCHER_NOT_FOUND';
    throw err;
  }
  if (BLOCKED_VOID_STATUSES.has(voucher.status) || !ALLOWED_VOID_STATUSES.has(voucher.status)) {
    const err = new Error(`Cannot void voucher in status ${voucher.status}`);
    err.code = 'INVALID_VOUCHER_STATUS_FOR_VOID';
    throw err;
  }

  voucher.status = 'voided';
  await voucher.save();

  await appendVoucherEvent({
    giftVoucherId: voucher._id,
    type: 'voided',
    actor,
    note: String(note).trim(),
    metadata: {
      action: 'ops_void',
      idempotencyKey,
      reason: String(reason).trim()
    }
  });

  return { ok: true, idempotentReplay: false, status: voucher.status };
}

async function extendVoucherExpiry({
  giftVoucherId,
  expiresAt,
  note,
  reason,
  ctx = {}
}) {
  ensureManagePermission(ctx);
  ensureNoteReason(note, reason);
  const idempotencyKey = getIdempotencyKey(ctx);
  const actor = actorFromCtx(ctx);

  const existing = await findIdempotentEventByKey({
    giftVoucherId,
    action: 'ops_extend_expiry',
    idempotencyKey
  });
  if (existing) return { ok: true, idempotentReplay: true };

  const voucher = await GiftVoucher.findById(giftVoucherId);
  if (!voucher) {
    const err = new Error('Gift voucher not found');
    err.code = 'GIFT_VOUCHER_NOT_FOUND';
    throw err;
  }
  if (BLOCKED_EXTEND_STATUSES.has(voucher.status) || !ALLOWED_EXTEND_STATUSES.has(voucher.status)) {
    const err = new Error(`Cannot extend expiry for status ${voucher.status}`);
    err.code = 'INVALID_VOUCHER_STATUS_FOR_EXPIRY_EXTENSION';
    throw err;
  }

  const nextExpiresAt = parseFutureDate(expiresAt);
  if (voucher.expiresAt && nextExpiresAt <= voucher.expiresAt) {
    const err = new Error('New expiry must be later than current expiresAt');
    err.code = 'INVALID_EXPIRY_EXTENSION';
    throw err;
  }

  const previousExpiresAt = voucher.expiresAt || null;
  voucher.expiresAt = nextExpiresAt;
  if (voucher.status === 'expired') {
    voucher.status = voucher.balanceRemainingCents === 0 ? 'redeemed' : statusFromBalance(voucher.balanceRemainingCents, voucher.amountOriginalCents);
  }
  await voucher.save();

  await appendVoucherEvent({
    giftVoucherId: voucher._id,
    type: 'expiry_extended',
    actor,
    note: String(note).trim(),
    metadata: {
      action: 'ops_extend_expiry',
      idempotencyKey,
      reason: String(reason).trim(),
      previousExpiresAt,
      newExpiresAt: nextExpiresAt
    }
  });

  return { ok: true, idempotentReplay: false, expiresAt: voucher.expiresAt, status: voucher.status };
}

async function adjustVoucherBalance({
  giftVoucherId,
  deltaCents,
  note,
  reason = '',
  ctx = {}
}) {
  ensureManagePermission(ctx);
  const idempotencyKey = getIdempotencyKey(ctx);
  const actor = actorFromCtx(ctx);
  if (!String(note || '').trim()) {
    const err = new Error('note is required');
    err.code = 'NOTE_REQUIRED';
    throw err;
  }
  if (!Number.isInteger(deltaCents) || deltaCents === 0) {
    const err = new Error('deltaCents must be a non-zero integer');
    err.code = 'INVALID_DELTA_CENTS';
    throw err;
  }

  const existing = await findIdempotentEventByKey({
    giftVoucherId,
    action: 'ops_adjust_balance',
    idempotencyKey
  });
  if (existing) {
    return { ok: true, idempotentReplay: true };
  }

  const voucher = await GiftVoucher.findById(giftVoucherId);
  if (!voucher) {
    const err = new Error('Gift voucher not found');
    err.code = 'GIFT_VOUCHER_NOT_FOUND';
    throw err;
  }
  if (voucher.status === 'voided' || voucher.status === 'refunded') {
    const err = new Error(`Cannot adjust voucher in status ${voucher.status}`);
    err.code = 'INVALID_VOUCHER_STATUS_FOR_ADJUSTMENT';
    throw err;
  }

  const previousBalanceCents = voucher.balanceRemainingCents;
  const newBalanceCents = previousBalanceCents + deltaCents;
  if (newBalanceCents < 0) {
    const err = new Error('Balance cannot become negative');
    err.code = 'BALANCE_BELOW_ZERO';
    throw err;
  }
  if (newBalanceCents > voucher.amountOriginalCents) {
    const err = new Error('Balance cannot exceed original amount');
    err.code = 'BALANCE_EXCEEDS_ORIGINAL';
    throw err;
  }

  voucher.balanceRemainingCents = newBalanceCents;
  voucher.status = statusFromBalance(newBalanceCents, voucher.amountOriginalCents);
  await voucher.save();

  await appendFinancialVoucherEvent({
    giftVoucherId: voucher._id,
    type: 'adjusted',
    actor,
    note: String(note).trim(),
    previousBalanceCents,
    newBalanceCents,
    deltaCents,
    metadata: {
      action: 'ops_adjust_balance',
      idempotencyKey,
      reason: String(reason || '').trim() || null
    }
  });

  return {
    ok: true,
    idempotentReplay: false,
    previousBalanceCents,
    newBalanceCents,
    deltaCents,
    status: voucher.status
  };
}

async function updateRecipientEmailBeforeSend({
  giftVoucherId,
  recipientEmail,
  note,
  ctx = {}
}) {
  ensureManagePermission(ctx);
  const idempotencyKey = getIdempotencyKey(ctx);
  const actor = actorFromCtx(ctx);
  if (!String(note || '').trim()) {
    const err = new Error('note is required');
    err.code = 'NOTE_REQUIRED';
    throw err;
  }
  const email = normalizeEmail(recipientEmail);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const err = new Error('recipientEmail must be a valid email');
    err.code = 'INVALID_RECIPIENT_EMAIL';
    throw err;
  }

  const existing = await findIdempotentEventByKey({
    giftVoucherId,
    action: 'ops_update_recipient_email',
    idempotencyKey
  });
  if (existing) return { ok: true, idempotentReplay: true };

  const voucher = await GiftVoucher.findById(giftVoucherId);
  if (!voucher) {
    const err = new Error('Gift voucher not found');
    err.code = 'GIFT_VOUCHER_NOT_FOUND';
    throw err;
  }

  const alreadySentRecipient = await GiftVoucherEvent.findOne({
    giftVoucherId: voucher._id,
    $or: [
      { type: 'sent', 'metadata.templateKind': 'recipient_voucher' },
      { type: 'resent' }
    ]
  })
    .select('_id')
    .lean();
  if (alreadySentRecipient) {
    const err = new Error('Recipient email is locked after voucher delivery send');
    err.code = 'RECIPIENT_EMAIL_ALREADY_SENT';
    throw err;
  }

  const previousRecipientEmail = voucher.recipientEmail || null;
  voucher.recipientEmail = email;
  await voucher.save();

  await appendVoucherEvent({
    giftVoucherId: voucher._id,
    type: 'recipient_email_updated',
    actor,
    note: String(note).trim(),
    metadata: {
      action: 'ops_update_recipient_email',
      idempotencyKey,
      previousRecipientEmail,
      newRecipientEmail: email
    }
  });

  return {
    ok: true,
    idempotentReplay: false,
    previousRecipientEmail,
    recipientEmail: email
  };
}

module.exports = {
  ensureReadPermission,
  resendVoucher,
  voidVoucher,
  extendVoucherExpiry,
  adjustVoucherBalance,
  updateRecipientEmailBeforeSend
};
