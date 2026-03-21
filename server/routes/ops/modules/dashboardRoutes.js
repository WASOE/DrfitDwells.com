const express = require('express');
const { getDashboardReadModel } = require('../../../services/ops/readModels/dashboardReadModel');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const data = await getDashboardReadModel();
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
