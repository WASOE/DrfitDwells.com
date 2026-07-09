const express = require('express');
const rateLimit = require('express-rate-limit');
const { buildPublicLocationInventory } = require('../services/locationQuote/locationInventoryCatalogService');
const { resolveLocationKeyFromParam } = require('../services/locationQuote/locationSlugRegistry');

const router = express.Router();

const locationInventoryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many inventory requests. Please try again shortly.'
  }
});

router.get('/location-inventory/:locationKeyOrSlug', locationInventoryLimiter, async (req, res) => {
  try {
    const locationKey = resolveLocationKeyFromParam(req.params.locationKeyOrSlug);
    const inventory = await buildPublicLocationInventory(locationKey);
    return res.json({ success: true, data: inventory });
  } catch (err) {
    if (err?.code === 'validation') {
      const status = err.status || 400;
      return res.status(status).json({
        success: false,
        message: err.message,
        ...(err.details ? { details: err.details } : {})
      });
    }
    console.error('Location inventory error:', err);
    return res.status(500).json({ success: false, message: 'Error loading location inventory' });
  }
});

module.exports = router;
