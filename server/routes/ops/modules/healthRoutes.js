const express = require('express');
const { getOpsHealthReadModel } = require('../../../services/ops/readModels/healthReadModel');

const router = express.Router();

router.get('/readiness', async (req, res) => {
  try {
    const data = await getOpsHealthReadModel();
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
