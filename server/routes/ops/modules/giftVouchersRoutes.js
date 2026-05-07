const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { validateId } = require('../../../middleware/validateId');
const {
  getGiftVouchersWorkspaceReadModel,
  getGiftVoucherDetailReadModel
} = require('../../../services/ops/readModels/giftVouchersReadModel');
const {
  ensureReadPermission,
  resendVoucher,
  voidVoucher,
  extendVoucherExpiry,
  adjustVoucherBalance,
  updateRecipientEmailBeforeSend
} = require('../../../services/ops/domain/giftVoucherWriteService');

const router = express.Router();

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
  }
  return next();
}

function handleDomainError(res, error) {
  if (error.code === 'PERMISSION_DENIED') {
    return res.status(error.status || 403).json({ success: false, message: error.message });
  }
  const mappings = {
    IDEMPOTENCY_KEY_REQUIRED: 400,
    NOTE_REQUIRED: 400,
    REASON_REQUIRED: 400,
    INVALID_EXPIRES_AT: 400,
    INVALID_EXPIRY_EXTENSION: 400,
    INVALID_DELTA_CENTS: 400,
    INVALID_RECIPIENT_EMAIL: 400,
    MISSING_RECIPIENT_EMAIL: 400,
    GIFT_VOUCHER_NOT_FOUND: 404,
    RECIPIENT_EMAIL_ALREADY_SENT: 409,
    GIFT_VOUCHER_NOT_RESENDABLE: 409,
    INVALID_VOUCHER_STATUS_FOR_VOID: 409,
    INVALID_VOUCHER_STATUS_FOR_EXPIRY_EXTENSION: 409,
    INVALID_VOUCHER_STATUS_FOR_ADJUSTMENT: 409,
    BALANCE_BELOW_ZERO: 422,
    BALANCE_EXCEEDS_ORIGINAL: 422,
    EMAIL_SEND_FAILED: 502
  };
  const status = mappings[error.code] || 500;
  return res.status(status).json({
    success: false,
    message: error.message || 'Operation failed',
    code: error.code || 'INTERNAL_ERROR'
  });
}

router.get(
  '/',
  [
    query('search').optional().isString().isLength({ max: 120 }).withMessage('search is invalid'),
    query('status').optional().isString().isLength({ max: 60 }).withMessage('status is invalid'),
    query('deliveryMode').optional().isString().isLength({ max: 40 }).withMessage('deliveryMode is invalid'),
    query('page').optional().isInt({ min: 1 }).withMessage('page must be >= 1'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be 1-100')
  ],
  handleValidation,
  async (req, res) => {
    try {
      ensureReadPermission({ user: req.user });
      const data = await getGiftVouchersWorkspaceReadModel(req.query);
      return res.json({ success: true, data });
    } catch (error) {
      return handleDomainError(res, error);
    }
  }
);

router.get('/:id', validateId('id'), async (req, res) => {
  try {
    ensureReadPermission({ user: req.user });
    const data = await getGiftVoucherDetailReadModel(req.params.id);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Gift voucher not found', code: 'GIFT_VOUCHER_NOT_FOUND' });
    }
    return res.json({ success: true, data });
  } catch (error) {
    return handleDomainError(res, error);
  }
});

router.post(
  '/:id/actions/resend',
  [
    validateId('id'),
    body('idempotencyKey').isString().isLength({ min: 3, max: 120 }).withMessage('idempotencyKey is required'),
    body('recipientOverride').optional({ checkFalsy: true }).isEmail().withMessage('recipientOverride must be valid'),
    body('note').optional().isString().isLength({ max: 500 }).withMessage('note is invalid')
  ],
  handleValidation,
  async (req, res) => {
    try {
      const data = await resendVoucher({
        giftVoucherId: req.params.id,
        recipientOverride: req.body.recipientOverride || null,
        note: req.body.note || '',
        ctx: {
          req,
          user: req.user,
          route: 'POST /api/ops/gift-vouchers/:id/actions/resend',
          idempotencyKey: req.body.idempotencyKey
        }
      });
      return res.json({ success: true, data });
    } catch (error) {
      return handleDomainError(res, error);
    }
  }
);

router.post(
  '/:id/actions/void',
  [
    validateId('id'),
    body('idempotencyKey').isString().isLength({ min: 3, max: 120 }).withMessage('idempotencyKey is required'),
    body('note').isString().isLength({ min: 1, max: 500 }).withMessage('note is required'),
    body('reason').isString().isLength({ min: 1, max: 500 }).withMessage('reason is required')
  ],
  handleValidation,
  async (req, res) => {
    try {
      const data = await voidVoucher({
        giftVoucherId: req.params.id,
        note: req.body.note,
        reason: req.body.reason,
        ctx: {
          req,
          user: req.user,
          route: 'POST /api/ops/gift-vouchers/:id/actions/void',
          idempotencyKey: req.body.idempotencyKey
        }
      });
      return res.json({ success: true, data });
    } catch (error) {
      return handleDomainError(res, error);
    }
  }
);

router.post(
  '/:id/actions/extend-expiry',
  [
    validateId('id'),
    body('idempotencyKey').isString().isLength({ min: 3, max: 120 }).withMessage('idempotencyKey is required'),
    body('expiresAt').isISO8601().withMessage('expiresAt must be ISO date'),
    body('note').isString().isLength({ min: 1, max: 500 }).withMessage('note is required'),
    body('reason').isString().isLength({ min: 1, max: 500 }).withMessage('reason is required')
  ],
  handleValidation,
  async (req, res) => {
    try {
      const data = await extendVoucherExpiry({
        giftVoucherId: req.params.id,
        expiresAt: req.body.expiresAt,
        note: req.body.note,
        reason: req.body.reason,
        ctx: {
          req,
          user: req.user,
          route: 'POST /api/ops/gift-vouchers/:id/actions/extend-expiry',
          idempotencyKey: req.body.idempotencyKey
        }
      });
      return res.json({ success: true, data });
    } catch (error) {
      return handleDomainError(res, error);
    }
  }
);

router.post(
  '/:id/actions/adjust-balance',
  [
    validateId('id'),
    body('idempotencyKey').isString().isLength({ min: 3, max: 120 }).withMessage('idempotencyKey is required'),
    body('deltaCents').isInt().withMessage('deltaCents must be integer'),
    body('note').isString().isLength({ min: 1, max: 500 }).withMessage('note is required'),
    body('reason').optional().isString().isLength({ max: 500 }).withMessage('reason is invalid')
  ],
  handleValidation,
  async (req, res) => {
    try {
      const data = await adjustVoucherBalance({
        giftVoucherId: req.params.id,
        deltaCents: Number(req.body.deltaCents),
        note: req.body.note,
        reason: req.body.reason,
        ctx: {
          req,
          user: req.user,
          route: 'POST /api/ops/gift-vouchers/:id/actions/adjust-balance',
          idempotencyKey: req.body.idempotencyKey
        }
      });
      return res.json({ success: true, data });
    } catch (error) {
      return handleDomainError(res, error);
    }
  }
);

router.post(
  '/:id/actions/update-recipient-email',
  [
    validateId('id'),
    body('idempotencyKey').isString().isLength({ min: 3, max: 120 }).withMessage('idempotencyKey is required'),
    body('recipientEmail').isEmail().withMessage('recipientEmail must be valid'),
    body('note').isString().isLength({ min: 1, max: 500 }).withMessage('note is required')
  ],
  handleValidation,
  async (req, res) => {
    try {
      const data = await updateRecipientEmailBeforeSend({
        giftVoucherId: req.params.id,
        recipientEmail: req.body.recipientEmail,
        note: req.body.note,
        ctx: {
          req,
          user: req.user,
          route: 'POST /api/ops/gift-vouchers/:id/actions/update-recipient-email',
          idempotencyKey: req.body.idempotencyKey
        }
      });
      return res.json({ success: true, data });
    } catch (error) {
      return handleDomainError(res, error);
    }
  }
);

module.exports = router;
