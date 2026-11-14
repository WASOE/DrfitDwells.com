'use strict';

const express = require('express');
const mongoose = require('mongoose');
const CorporateGiftLead = require('../../../models/CorporateGiftLead');
const { attemptDelivery } = require('../../../services/corporateGiftLeads/service');
const router = express.Router();
const statuses = ['new', 'researching', 'contacted', 'negotiating', 'won', 'lost'];

router.get('/', async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
    if (status && !statuses.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });
    const filter = {};
    if (status) filter.status = status;
    if (q) filter.company = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
    const [items, total] = await Promise.all([
      CorporateGiftLead.find(filter).select('company type status email notification createdAt hrEmails')
        .sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).lean(),
      CorporateGiftLead.countDocuments(filter)
    ]);
    return res.json({ success: true, data: { items, total, page } });
  } catch (error) {
    console.error('[ops/corporate-gift-leads] list failed', error.message);
    return res.status(500).json({ success: false, message: 'Failed to load corporate gift leads' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: 'Lead not found' });
    const lead = await CorporateGiftLead.findById(req.params.id).select('-requestKeys -requestDigests -nominationKey').lean();
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    return res.json({ success: true, data: lead });
  } catch (error) {
    console.error('[ops/corporate-gift-leads] detail failed', error.message);
    return res.status(500).json({ success: false, message: 'Failed to load lead' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: 'Lead not found' });
    const { status, notes } = req.body || {};
    if (!statuses.includes(status) || typeof notes !== 'string' || notes.length > 10000) {
      return res.status(400).json({ success: false, message: 'Invalid status or notes' });
    }
    const lead = await CorporateGiftLead.findByIdAndUpdate(req.params.id, { status, notes }, { new: true, runValidators: true }).select('-requestKeys -requestDigests -nominationKey').lean();
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    return res.json({ success: true, data: lead });
  } catch (error) {
    console.error('[ops/corporate-gift-leads] update failed', error.message);
    return res.status(500).json({ success: false, message: 'Failed to update lead' });
  }
});

router.post('/:id/retry/:lane', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id) || !['email', 'notification'].includes(req.params.lane)) {
      return res.status(400).json({ success: false, message: 'Invalid lead or delivery lane' });
    }
    if (!await CorporateGiftLead.exists({ _id: req.params.id })) return res.status(404).json({ success: false, message: 'Lead not found' });
    const result = await attemptDelivery(req.params.id, req.params.lane, { force: true });
    if (result.status === 'failed') return res.status(503).json({ success: false, message: 'Delivery failed; see lead for details' });
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('[ops/corporate-gift-leads] retry failed', error.message);
    return res.status(500).json({ success: false, message: 'Failed to retry delivery' });
  }
});
module.exports = router;
