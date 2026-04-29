const express = require('express');
const { body, validationResult } = require('express-validator');
const { validateId } = require('../middleware/validateId');
const {
  listPromoCodes,
  createPromoCode,
  updatePromoCode
} = require('../services/promo/promoManagementService');

const router = express.Router();

// GET /api/admin/promo-codes
router.get('/', async (req, res) => {
  try {
    const codes = await listPromoCodes();
    return res.json({ success: true, data: { promoCodes: codes } });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/admin/promo-codes
router.post(
  '/',
  [
    body('code').trim().isLength({ min: 2, max: 40 }).withMessage('Code is required (2–40 characters)'),
    body('internalName').trim().isLength({ min: 1, max: 120 }).withMessage('Internal name is required'),
    body('discountType').isIn(['fixed', 'percent']).withMessage('discountType must be fixed or percent'),
    body('discountValue').isFloat({ gt: 0 }).withMessage('discountValue must be greater than 0'),
    body('isActive').optional().isBoolean(),
    body('validFrom').optional({ values: 'null' }),
    body('validUntil').optional({ values: 'null' }),
    body('startsAt').optional({ values: 'null' }),
    body('endsAt').optional({ values: 'null' }),
    body('usageLimit').optional({ values: 'null' }),
    body('minSubtotal').optional({ values: 'null' })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }
      const doc = await createPromoCode(req.body);
      return res.status(201).json({ success: true, data: { promoCode: doc } });
    } catch (e) {
      if (e.code === 'VALIDATION') {
        return res.status(e.status || 400).json({ success: false, message: e.message });
      }
      if (e.code === 'DUPLICATE_CODE') {
        return res.status(409).json({ success: false, message: 'A promo code with this value already exists' });
      }
      return res.status(500).json({ success: false, message: e.message });
    }
  }
);

// PATCH /api/admin/promo-codes/:id
router.patch(
  '/:id',
  validateId('id'),
  [
    body('code').optional().trim().isLength({ min: 2, max: 40 }),
    body('internalName').optional().trim().isLength({ min: 1, max: 120 }),
    body('discountType').optional().isIn(['fixed', 'percent']),
    body('discountValue').optional().isFloat({ gt: 0 }),
    body('isActive').optional().isBoolean(),
    body('validFrom').optional({ values: 'null' }),
    body('validUntil').optional({ values: 'null' }),
    body('startsAt').optional({ values: 'null' }),
    body('endsAt').optional({ values: 'null' }),
    body('usageLimit').optional({ values: 'null' }),
    body('minSubtotal').optional({ values: 'null' })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }
      const doc = await updatePromoCode(req.params.id, req.body);
      return res.json({ success: true, data: { promoCode: doc } });
    } catch (e) {
      if (e.code === 'NOT_FOUND') {
        return res.status(404).json({ success: false, message: e.message });
      }
      if (e.code === 'VALIDATION') {
        return res.status(e.status || 400).json({ success: false, message: e.message });
      }
      if (e.code === 'DUPLICATE_CODE') {
        return res.status(409).json({ success: false, message: 'A promo code with this value already exists' });
      }
      return res.status(500).json({ success: false, message: e.message });
    }
  }
);

module.exports = router;
