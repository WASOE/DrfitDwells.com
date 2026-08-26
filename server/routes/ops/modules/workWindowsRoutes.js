const express = require('express');
const { getWorkWindowsReadModel } = require('../../../services/ops/readModels/workWindowsReadModel');

const router = express.Router();

function handleError(res, error) {
  if (error && error.code === 'PERMISSION_DENIED') {
    return res.status(error.status || 403).json({
      success: false,
      errorType: 'permission',
      message: error.message
    });
  }
  if (error && error.type) {
    const status =
      error.status || (error.type === 'conflict' ? 409 : error.type === 'dependency_failure' ? 502 : 400);
    return res.status(status).json({
      success: false,
      errorType: error.type,
      message: error.message,
      details: error.details || null
    });
  }
  return res.status(500).json({
    success: false,
    errorType: 'dependency_failure',
    message: error?.message || 'Work Windows failed'
  });
}

/**
 * GET /api/ops/work-windows?locationKey=&from=&to=
 * On-demand planning snapshot. Exclusive-end [from, to) in Europe/Sofia. Max 92 days.
 */
router.get('/', async (req, res) => {
  try {
    const data = await getWorkWindowsReadModel({
      locationKey: req.query.locationKey,
      from: req.query.from,
      to: req.query.to
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
});

module.exports = router;
