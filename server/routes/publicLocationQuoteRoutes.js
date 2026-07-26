const express = require('express');
const rateLimit = require('express-rate-limit');
const { buildPublicLocationQuote } = require('../services/locationQuote/locationQuoteService');
const { resolveLocationKeyFromParam } = require('../services/locationQuote/locationSlugRegistry');
const {
  upsertSavedQuoteFromLocationQuote,
  scheduleSavedQuoteTask
} = require('../services/savedQuotes/savedQuoteService');

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
  let funnelOutcome = null;
  try {
    const locationKey = resolveLocationKeyFromParam(req.params.locationKeyOrSlug);
    const quote = await buildPublicLocationQuote(locationKey, req.body);
    if (quote?.available) {
      scheduleSavedQuoteTask('upsert-from-location-quote', () =>
        upsertSavedQuoteFromLocationQuote({ req, quote })
      );
      funnelOutcome = {
        kind: 'received',
        propertyKind: 'valley',
        result: {
          ok: true,
          totalPrice: quote.totalPrice,
          quoteId: quote.quoteId || null
        }
      };
    } else {
      funnelOutcome = {
        kind: 'unavailable',
        propertyKind: 'valley',
        quoteFailureClass: 'unavailable',
        result: {
          status: 200,
          unavailableReason: quote?.unavailableReason || 'unavailable',
          message: quote?.unavailableReason || 'unavailable'
        }
      };
    }
    // Ensure location identity is visible to funnel sanitizer
    req.body = {
      ...req.body,
      locationKey,
      locationId: locationKey,
      checkInDateOnly: req.body?.checkIn ? String(req.body.checkIn).slice(0, 10) : req.body?.checkInDateOnly,
      checkOutDateOnly: req.body?.checkOut ? String(req.body.checkOut).slice(0, 10) : req.body?.checkOutDateOnly
    };
    return res.json({ success: true, data: quote });
  } catch (err) {
    funnelOutcome = {
      kind: 'failed',
      propertyKind: 'valley',
      validationFailed: err?.code === 'validation',
      httpStatus: err?.status || 500,
      result: { status: err?.status || 500, message: err?.message }
    };
    if (err?.code === 'validation' && err?.status === 404) {
      return res.status(404).json({ success: false, message: err.message });
    }
    return handleQuoteError(err, res);
  } finally {
    if (funnelOutcome) {
      const { recordQuoteFunnelOutcome } = require('../services/conversion/funnelEventService');
      void recordQuoteFunnelOutcome(req, funnelOutcome).catch((funnelErr) => {
        console.error('[funnel] location quote outcome record failed', {
          message: funnelErr?.message || String(funnelErr)
        });
      });
    }
  }
});

module.exports = router;
