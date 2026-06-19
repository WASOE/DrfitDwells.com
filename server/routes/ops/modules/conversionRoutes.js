'use strict';

const express = require('express');
const { getConversionSummaryReadModel } = require('../../../services/ops/readModels/conversionReadModel');

const router = express.Router();

router.get('/summary', async (req, res) => {
  try {
    const { propertyKind, from, to } = req.query;
    if (!propertyKind || !from || !to) {
      return res.status(400).json({
        success: false,
        message: 'propertyKind, from, and to are required'
      });
    }

    const data = await getConversionSummaryReadModel({ propertyKind, from, to });
    return res.json({ success: true, data });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ success: false, message: error.message });
  }
});

module.exports = router;
