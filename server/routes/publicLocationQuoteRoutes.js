const express = require('express');
const rateLimit = require('express-rate-limit');
const { buildPublicLocationQuote } = require('../services/locationQuote/locationQuoteService');
const { resolveLocationKeyFromParam } = require('../services/locationQuote/locationSlugRegistry');

const router = express.Router();

const locationQuoteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many quote requests. Please try again shortly.' }
});

function handleQuoteError(err, res) {
  if (err?.code === 'validation') {
    const status = err.status || 400;
    return res.status(status).json({
      success: false,
      message: err.message,
      ...(err.details ? { details: err.details } : {})
    });
  }
  console.error('Location quote error:', err);
  return res.status(500).json({ success: false, message: 'Error generating location quote' });
}

router.post('/location-quotes/:locationKeyOrSlug', locationQuoteLimiter, async (req, res) => {
  try {
    const locationKey = resolveLocationKeyFromParam(req.params.locationKeyOrSlug);
    const quote = await buildPublicLocationQuote(locationKey, req.body);
    return res.json({ success: true, data: quote });
  } catch (err) {
    if (err?.code === 'validation' && err?.status === 404) {
      return res.status(404).json({ success: false, message: err.message });
    }
    return handleQuoteError(err, res);
  }
});

module.exports = router;
