const express = require('express');
const { body, validationResult } = require('express-validator');
const PromoCode = require('../models/PromoCode');
const { validateId } = require('../middleware/validateId');

const router = express.Router();

function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase();
}

// GET /api/admin/promo-codes
router.get('/', async (req, res) => {
  try {
    const codes = await PromoCode.find({}).sort({ createdAt: -1 }).lean();
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
      const {
        internalName,
        discountType,
        discountValue,
        isActive = true,
        validFrom,
        validUntil,
        startsAt,
        endsAt,
        usageLimit: usageLimitRaw,
        minSubtotal: minSubtotalRaw
      } = req.body;
      const code = normalizeCode(req.body.code);
      if (!code) {
        return res.status(400).json({ success: false, message: 'Invalid code' });
      }
      if (discountType === 'percent' && discountValue > 100) {
        return res.status(400).json({ success: false, message: 'Percent discount cannot exceed 100' });
      }

      const usageLimit =
        usageLimitRaw != null && usageLimitRaw !== ''
          ? Math.max(0, Math.floor(Number(usageLimitRaw)))
          : null;

      const doc = await PromoCode.create({
        code,
        internalName: String(internalName).trim(),
        discountType,
        discountValue: Number(discountValue),
        isActive: !!isActive,
        validFrom: validFrom ? new Date(validFrom) : null,
        validUntil: validUntil ? new Date(validUntil) : null,
        startsAt: startsAt ? new Date(startsAt) : null,
        endsAt: endsAt ? new Date(endsAt) : null,
        usageLimit,
        minSubtotal:
          minSubtotalRaw != null && minSubtotalRaw !== ''
            ? Math.max(0, Number(minSubtotalRaw))
            : null
      });
      return res.status(201).json({ success: true, data: { promoCode: doc } });
    } catch (e) {
      if (e.code === 11000) {
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
      const doc = await PromoCode.findById(req.params.id);
      if (!doc) {
        return res.status(404).json({ success: false, message: 'Promo code not found' });
      }

      const {
        internalName,
        discountType,
        discountValue,
        isActive,
        validFrom,
        validUntil,
        startsAt,
        endsAt,
        usageLimit,
        minSubtotal
      } = req.body;

      if (req.body.code != null) {
        const c = normalizeCode(req.body.code);
        if (!c) {
          return res.status(400).json({ success: false, message: 'Invalid code' });
        }
        doc.code = c;
      }
      if (internalName != null) doc.internalName = String(internalName).trim();
      if (discountType != null) doc.discountType = discountType;
      if (discountValue != null) doc.discountValue = Number(discountValue);
      if (isActive != null) doc.isActive = !!isActive;
      if (validFrom !== undefined) doc.validFrom = validFrom ? new Date(validFrom) : null;
      if (validUntil !== undefined) doc.validUntil = validUntil ? new Date(validUntil) : null;
      if (startsAt !== undefined) doc.startsAt = startsAt ? new Date(startsAt) : null;
      if (endsAt !== undefined) doc.endsAt = endsAt ? new Date(endsAt) : null;
      if (usageLimit !== undefined) {
        doc.usageLimit =
          usageLimit != null && usageLimit !== ''
            ? Math.max(0, Math.floor(Number(usageLimit)))
            : null;
      }
      if (minSubtotal !== undefined) {
        doc.minSubtotal =
          minSubtotal != null && minSubtotal !== ''
            ? Math.max(0, Number(minSubtotal))
            : null;
      }

      const dt = doc.discountType;
      const dv = doc.discountValue;
      if (dt === 'percent' && dv > 100) {
        return res.status(400).json({ success: false, message: 'Percent discount cannot exceed 100' });
      }

      await doc.save();
      return res.json({ success: true, data: { promoCode: doc } });
    } catch (e) {
      if (e.code === 11000) {
        return res.status(409).json({ success: false, message: 'A promo code with this value already exists' });
      }
      return res.status(500).json({ success: false, message: e.message });
    }
  }
);

module.exports = router;
