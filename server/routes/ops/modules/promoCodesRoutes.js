const express = require('express');
const { body, validationResult } = require('express-validator');
const { validateId } = require('../../../middleware/validateId');
const {
  listPromoCodes,
  createPromoCode,
  updatePromoCode
} = require('../../../services/promo/promoManagementService');

const router = express.Router();

const createPromoValidators = [
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
];

const patchPromoValidators = [
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
];

router.get('/', async (req, res) => {
  try {
    const promoCodes = await listPromoCodes();
    return res.json({ success: true, data: { promoCodes } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/', createPromoValidators, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }
    const promoCode = await createPromoCode(req.body);
    return res.status(201).json({ success: true, data: { promoCode } });
  } catch (error) {
    if (error.code === 'VALIDATION') {
      return res.status(error.status || 400).json({ success: false, message: error.message });
    }
    if (error.code === 'DUPLICATE_CODE') {
      return res.status(409).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.patch('/:id', validateId('id'), patchPromoValidators, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }
    const promoCode = await updatePromoCode(req.params.id, req.body);
    return res.json({ success: true, data: { promoCode } });
  } catch (error) {
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.code === 'VALIDATION') {
      return res.status(error.status || 400).json({ success: false, message: error.message });
    }
    if (error.code === 'DUPLICATE_CODE') {
      return res.status(409).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
