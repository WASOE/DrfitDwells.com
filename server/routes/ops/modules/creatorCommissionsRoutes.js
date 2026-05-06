const express = require('express');
const { body, validationResult } = require('express-validator');
const { validateId } = require('../../../middleware/validateId');
const CreatorCommission = require('../../../models/CreatorCommission');

const router = express.Router();

function getOpsIdentity(req) {
  return req.user?.email || req.user?.id || process.env.ADMIN_EMAIL || 'admin';
}

function appendNote(existing, addition) {
  const trimmed = (addition || '').trim();
  if (!trimmed) return existing || null;
  const prefix = existing ? `${existing}\n` : '';
  return `${prefix}${trimmed}`.slice(0, 4000);
}

router.post(
  '/:id/approve',
  validateId('id'),
  [body('notes').optional().isString().isLength({ max: 2000 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const row = await CreatorCommission.findById(req.params.id);
      if (!row) return res.status(404).json({ success: false, message: 'Creator commission not found' });
      if (row.status !== 'pending') {
        return res.status(409).json({ success: false, message: 'Only pending rows can be approved' });
      }
      if (row.eligibilityStatus !== 'eligible') {
        return res.status(409).json({ success: false, message: 'Only eligible rows can be approved' });
      }

      row.status = 'approved';
      row.approvedAt = new Date();
      row.notes = appendNote(row.notes, req.body?.notes);
      row.notes = appendNote(row.notes, `approved_by=${getOpsIdentity(req)}`);
      await row.save();

      return res.json({ success: true, data: { id: String(row._id), status: row.status, approvedAt: row.approvedAt } });
    } catch {
      return res.status(500).json({ success: false, message: 'Unable to approve creator commission row' });
    }
  }
);

router.post(
  '/:id/mark-paid',
  validateId('id'),
  [body('notes').optional().isString().isLength({ max: 2000 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const row = await CreatorCommission.findById(req.params.id);
      if (!row) return res.status(404).json({ success: false, message: 'Creator commission not found' });
      if (row.status !== 'approved') {
        return res.status(409).json({ success: false, message: 'Only approved rows can be marked paid' });
      }

      row.status = 'paid';
      row.paidAt = new Date();
      row.notes = appendNote(row.notes, req.body?.notes);
      row.notes = appendNote(row.notes, `paid_by=${getOpsIdentity(req)}`);
      await row.save();

      return res.json({ success: true, data: { id: String(row._id), status: row.status, paidAt: row.paidAt } });
    } catch {
      return res.status(500).json({ success: false, message: 'Unable to mark creator commission row as paid' });
    }
  }
);

router.post(
  '/:id/void',
  validateId('id'),
  [
    body('voidReason').isString().trim().isLength({ min: 3, max: 500 }).withMessage('voidReason is required'),
    body('notes').optional().isString().isLength({ max: 2000 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const row = await CreatorCommission.findById(req.params.id);
      if (!row) return res.status(404).json({ success: false, message: 'Creator commission not found' });
      if (row.status === 'paid') {
        return res.status(409).json({ success: false, message: 'Paid rows cannot be voided' });
      }
      if (row.status === 'void') {
        return res.status(409).json({ success: false, message: 'Row is already void' });
      }

      row.status = 'void';
      row.voidReason = String(req.body.voidReason).trim();
      row.notes = appendNote(row.notes, req.body?.notes);
      row.notes = appendNote(row.notes, `voided_by=${getOpsIdentity(req)}`);
      await row.save();

      return res.json({ success: true, data: { id: String(row._id), status: row.status, voidReason: row.voidReason } });
    } catch {
      return res.status(500).json({ success: false, message: 'Unable to void creator commission row' });
    }
  }
);

module.exports = router;
