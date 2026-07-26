'use strict';

const express = require('express');
const {
  getInsightsSummaryReadModel,
  getInsightsDataQualityReadModel,
  getInsightsBookingsReadModel,
  getInsightsFilterOptionsReadModel,
  getInsightsReconciliationReadModel,
  getInsightsPerformanceReadModel,
  getInsightsHistoricalDataQualityReadModel
} = require('../../../services/ops/readModels/insightsReadModel');

const router = express.Router();

function parseRevenueBasis(revenueBasis) {
  if (!revenueBasis) return 'checkIn';
  if (!['checkIn', 'booked'].includes(revenueBasis)) {
    const error = new Error('revenueBasis must be checkIn or booked');
    error.statusCode = 400;
    throw error;
  }
  return revenueBasis;
}

router.get('/summary', async (req, res) => {
  try {
    const { propertyKind, from, to, revenueBasis, cabinId, cabinTypeId, unitId, channel } =
      req.query;
    if (!propertyKind || !from || !to) {
      return res.status(400).json({
        success: false,
        message: 'propertyKind, from, and to are required'
      });
    }

    const data = await getInsightsSummaryReadModel({
      propertyKind,
      from,
      to,
      revenueBasis: parseRevenueBasis(revenueBasis),
      cabinId,
      cabinTypeId,
      unitId,
      channel
    });
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

router.get('/filter-options', async (req, res) => {
  try {
    const { propertyKind } = req.query;
    if (!propertyKind) {
      return res.status(400).json({ success: false, message: 'propertyKind is required' });
    }
    const data = await getInsightsFilterOptionsReadModel({ propertyKind });
    return res.json({ success: true, data });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ success: false, message: error.message });
  }
});

router.get('/bookings', async (req, res) => {
  try {
    const {
      propertyKind,
      from,
      to,
      revenueBasis,
      cabinId,
      cabinTypeId,
      unitId,
      channel,
      status,
      page,
      limit
    } = req.query;
    if (!propertyKind || !from || !to) {
      return res.status(400).json({
        success: false,
        message: 'propertyKind, from, and to are required'
      });
    }

    const data = await getInsightsBookingsReadModel({
      propertyKind,
      from,
      to,
      revenueBasis: parseRevenueBasis(revenueBasis),
      cabinId,
      cabinTypeId,
      unitId,
      channel,
      status,
      page,
      limit
    });
    return res.json({ success: true, data });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ success: false, message: error.message });
  }
});

router.get('/reconciliation', async (req, res) => {
  try {
    const { propertyKind, from, to, revenueBasis, cabinId, cabinTypeId, unitId } = req.query;
    if (!propertyKind || !from || !to) {
      return res.status(400).json({
        success: false,
        message: 'propertyKind, from, and to are required'
      });
    }

    const data = await getInsightsReconciliationReadModel({
      propertyKind,
      from,
      to,
      revenueBasis: parseRevenueBasis(revenueBasis),
      cabinId,
      cabinTypeId,
      unitId
    });
    return res.json({ success: true, data });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ success: false, message: error.message });
  }
});

router.get('/performance', async (req, res) => {
  try {
    const {
      propertyKind,
      from,
      to,
      groupBy,
      cabinId,
      cabinTypeId,
      unitId,
      channel,
      confidence,
      revenueBasis
    } = req.query;
    if (!propertyKind || !from || !to) {
      return res.status(400).json({
        success: false,
        message: 'propertyKind, from, and to are required'
      });
    }
    if (confidence && !['all', 'verified', 'usable'].includes(String(confidence))) {
      return res.status(400).json({
        success: false,
        message: 'confidence must be all, verified, or usable'
      });
    }
    if (groupBy && !['day', 'week', 'month'].includes(String(groupBy))) {
      return res.status(400).json({
        success: false,
        message: 'groupBy must be day, week, or month'
      });
    }

    const data = await getInsightsPerformanceReadModel({
      propertyKind,
      from,
      to,
      groupBy: groupBy || 'month',
      cabinId,
      cabinTypeId,
      unitId,
      channel,
      confidence: confidence || 'all',
      revenueBasis: parseRevenueBasis(revenueBasis)
    });
    return res.json({ success: true, data });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ success: false, message: error.message });
  }
});

router.get('/historical-data-quality', async (req, res) => {
  try {
    const { propertyKind } = req.query;
    if (!propertyKind) {
      return res.status(400).json({ success: false, message: 'propertyKind is required' });
    }
    const data = await getInsightsHistoricalDataQualityReadModel({ propertyKind });
    return res.json({ success: true, data });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ success: false, message: error.message });
  }
});

module.exports = router;
