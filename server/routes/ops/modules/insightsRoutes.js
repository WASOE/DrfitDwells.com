'use strict';

const express = require('express');
const {
  getInsightsSummaryReadModel,
  getInsightsDataQualityReadModel
} = require('../../../services/ops/readModels/insightsReadModel');

const router = express.Router();

router.get('/summary', async (req, res) => {
  try {
    const { propertyKind, from, to, revenueBasis } = req.query;
    if (!propertyKind || !from || !to) {
      return res.status(400).json({
        success: false,
        message: 'propertyKind, from, and to are required'
      });
    }
    if (revenueBasis && !['checkIn', 'booked'].includes(revenueBasis)) {
      return res.status(400).json({
        success: false,
        message: 'revenueBasis must be checkIn or booked'
      });
    }

    const data = await getInsightsSummaryReadModel({ propertyKind, from, to, revenueBasis });
    return res.json({ success: true, data });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ success: false, message: error.message });
  }
});

router.get('/data-quality', async (req, res) => {
  try {
    const { propertyKind } = req.query;
    if (!propertyKind) {
      return res.status(400).json({ success: false, message: 'propertyKind is required' });
    }
    const data = await getInsightsDataQualityReadModel({ propertyKind });
    return res.json({ success: true, data });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ success: false, message: error.message });
  }
});

module.exports = router;
