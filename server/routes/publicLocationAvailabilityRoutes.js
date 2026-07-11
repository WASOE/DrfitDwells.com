const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  buildPublicLocationAvailability,
  MAX_AVAILABILITY_WINDOW_MONTHS
} = require('../services/locationQuote/locationAvailabilityService');
const { resolveLocationKeyFromParam } = require('../services/locationQuote/locationSlugRegistry');

const router = express.Router();

/**
 * GET /api/public/location-availability/:locationKeyOrSlug?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Window is [from, to) in Europe/Sofia. Maximum span: 12 months (400 if exceeded).
 */
const locationAvailabilityLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many availability requests. Please try again shortly.'
  }
});

router.get(
  '/location-availability/:locationKeyOrSlug',
  locationAvailabilityLimiter,
  async (req, res) => {
    try {
      const locationKey = resolveLocationKeyFromParam(req.params.locationKeyOrSlug);
      const availability = await buildPublicLocationAvailability(locationKey, {
        from: req.query.from,
        to: req.query.to
      });
      return res.json({ success: true, data: availability });
    } catch (err) {
      if (err?.code === 'validation') {
        const status = err.status || 400;
        return res.status(status).json({
          success: false,
          message: err.message,
          ...(err.details ? { details: err.details } : {})
        });
      }
      console.error('Location availability error:', err);
      return res.status(500).json({ success: false, message: 'Error loading location availability' });
    }
  }
);

module.exports = router;
module.exports.MAX_AVAILABILITY_WINDOW_MONTHS = MAX_AVAILABILITY_WINDOW_MONTHS;
