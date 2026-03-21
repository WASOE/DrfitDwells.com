const express = require('express');
const { getSyncCenterReadModel } = require('../../../services/ops/readModels/syncCenterReadModel');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const data = await getSyncCenterReadModel({ cabinId: req.query.cabinId || null });
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
