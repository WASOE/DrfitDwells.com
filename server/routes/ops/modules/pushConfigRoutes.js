const express = require('express');
const { getPublicPushConfig } = require('../../../services/ops/push/opsPushVapidConfig');

const router = express.Router();

// GET /api/ops/push-config — any authenticated OPS user (adminAuth + module exempt).
router.get('/', (req, res) => {
  return res.json({
    success: true,
    data: getPublicPushConfig()
  });
});

module.exports = router;
