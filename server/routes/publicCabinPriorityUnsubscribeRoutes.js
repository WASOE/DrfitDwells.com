'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  getUnsubscribeState,
  confirmUnsubscribe
} = require('../services/cabinPriorityList/unsubscribeService');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again shortly.' }
});

// GET is safe for email security scanners and never changes subscription state.
router.get('/:token', limiter, async (req, res) => {
  try {
    const result = await getUnsubscribeState(req.params.token);
    if (!result.ok) {
      return res.status(result.reason === 'expired_token' ? 410 : 400).json({
        success: false,
        reason: result.reason
      });
    }
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('[cabin-priority-unsubscribe] load failed', error?.message || error);
    return res.status(500).json({ success: false, message: 'Could not load subscription' });
  }
});

// POST performs the actual Cabin-only unsubscribe.
router.post('/:token', limiter, async (req, res) => {
  try {
    const result = await confirmUnsubscribe(req.params.token);
    if (!result.ok) {
      return res.status(result.reason === 'expired_token' ? 410 : 400).json({
        success: false,
        reason: result.reason
      });
    }
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('[cabin-priority-unsubscribe] update failed', error?.message || error);
    return res.status(500).json({ success: false, message: 'Could not update subscription' });
  }
});

module.exports = router;
