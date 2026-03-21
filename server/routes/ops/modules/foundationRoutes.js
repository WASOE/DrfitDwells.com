const express = require('express');
const { adminAuth } = require('../../../middleware/adminAuth');
const { runAvailabilityBackfillDryRun } = require('../../../services/availabilityBackfillService');

const router = express.Router();

router.use(adminAuth);

router.get('/availability-backfill/dry-run', async (req, res) => {
  try {
    const report = await runAvailabilityBackfillDryRun();
    return res.json({
      success: true,
      data: report
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to run availability backfill dry run',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
