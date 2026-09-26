'use strict';

const express = require('express');
const {
  PricingOverrideManagementError,
  getPricingCalendar,
  upsertPricingOverrides,
  clearPricingOverrides
} = require('../../../services/pricingOverrideManagementService');

const router = express.Router();

function actorFromRequest(req) {
  return req.user || {};
}

function handleError(res, error) {
  if (error instanceof PricingOverrideManagementError) {
    return res.status(error.status || 400).json({
      success: false,
      code: error.code,
      message: error.message
    });
  }
  console.error('[ops-pricing-overrides] request failed', error);
  return res.status(500).json({
    success: false,
    message: 'Unable to process pricing override request'
  });
}

router.get('/', async (req, res) => {
  try {
    const data = await getPricingCalendar({
      ...req.query,
      accommodations: Array.isArray(req.query.accommodations)
        ? req.query.accommodations
        : req.query.accommodations
          ? [req.query.accommodations]
          : undefined
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
});

router.put('/range', async (req, res) => {
  try {
    const data = await upsertPricingOverrides({
      ...req.body,
      actor: actorFromRequest(req)
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
});

router.delete('/range', async (req, res) => {
  try {
    const data = await clearPricingOverrides(req.body || {});
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
});

module.exports = router;
