'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  getPublicPreferenceState,
  applyPublicPreferenceWithdrawal
} = require('../../services/savedQuotes/preferenceAccessTokenService');
const {
  resolveContinuationDestination
} = require('../../services/savedQuotes/recoveryContinuationService');

const router = express.Router();

const preferenceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again shortly.' }
});

router.get('/communication-preferences/:token', preferenceLimiter, async (req, res) => {
  try {
    const data = await getPublicPreferenceState(req.params.token);
    if (!data.ok) {
      const status = data.reason === 'expired_token' ? 410 : 400;
      return res.status(status).json({ success: false, reason: data.reason });
    }
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[public-preferences] get failed', err?.message || err);
    return res.status(500).json({ success: false, message: 'Could not load preferences' });
  }
});

router.post('/communication-preferences/:token', preferenceLimiter, async (req, res) => {
  try {
    const result = await applyPublicPreferenceWithdrawal(req.params.token, req.body || {});
    if (!result.ok) {
      const status =
        result.reason === 'expired_token'
          ? 410
          : result.reason === 'grant_not_allowed'
            ? 403
            : 400;
      return res.status(status).json({ success: false, reason: result.reason });
    }
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('[public-preferences] withdraw failed', err?.message || err);
    return res.status(500).json({ success: false, message: 'Could not update preferences' });
  }
});

router.get('/booking-continuation/:token', preferenceLimiter, async (req, res) => {
  try {
    const data = await resolveContinuationDestination(req.params.token);
    if (!data.ok) {
      const status = data.reason === 'expired_token' ? 410 : 400;
      return res.status(status).json({ success: false, reason: data.reason });
    }
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[booking-continuation] resolve failed', err?.message || err);
    return res.status(500).json({ success: false, message: 'Could not resolve continuation' });
  }
});

module.exports = router;
