'use strict';

const express = require('express');
const { getConversionSummaryReadModel } = require('../../../services/ops/readModels/conversionReadModel');
const {
  listRecoveryQuotes,
  getRecoveryQuoteDetail
} = require('../../../services/ops/readModels/recoveryReadModel');

const router = express.Router();

router.get('/summary', async (req, res) => {
  try {
    const { propertyKind, from, to, cabinId, cabinTypeId, unitId } = req.query;
    if (!propertyKind || !from || !to) {
      return res.status(400).json({
        success: false,
        message: 'propertyKind, from, and to are required'
      });
    }

    const data = await getConversionSummaryReadModel({
      propertyKind,
      from,
      to,
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

router.get('/recovery', async (req, res) => {
  try {
    const {
      propertyKind,
      from,
      to,
      status,
      eligibility,
      consentBasis,
      suppressed,
      hasEmail,
      entityType,
      cabinId,
      cabinTypeId,
      page,
      limit
    } = req.query;
    if (!propertyKind || !from || !to) {
      return res.status(400).json({
        success: false,
        message: 'propertyKind, from, and to are required'
      });
    }

    const data = await listRecoveryQuotes({
      propertyKind,
      from,
      to,
      status,
      eligibility,
      consentBasis,
      suppressed,
      hasEmail,
      entityType,
      cabinId,
      cabinTypeId,
      page,
      limit
    });
    return res.json({ success: true, data });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ success: false, message: error.message });
  }
});

router.get('/recovery/:id', async (req, res) => {
  try {
    const data = await getRecoveryQuoteDetail({ id: req.params.id });
    return res.json({ success: true, data });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ success: false, message: error.message });
  }
});

module.exports = router;
