const express = require('express');
const { adminAuth } = require('../middleware/adminAuth');
const CabinChannelSyncState = require('../models/CabinChannelSyncState');
const { runManualIcalSync, CHANNEL } = require('../services/ops/ingestion/icalSyncScheduler');

const router = express.Router();
router.use(adminAuth);

router.post('/airbnb-ical/run', async (req, res) => {
  try {
    const { cabinId, feedUrl } = req.body || {};
    if (!cabinId) {
      return res.status(400).json({ success: false, message: 'cabinId is required' });
    }

    let effectiveFeedUrl = feedUrl || null;
    if (!effectiveFeedUrl) {
      const state = await CabinChannelSyncState.findOne({ cabinId, channel: CHANNEL }).lean();
      effectiveFeedUrl = state?.feedUrl || null;
    }

    const data = await runManualIcalSync({ cabinId: String(cabinId), feedUrl: effectiveFeedUrl, channel: CHANNEL });
    if (data?.status === 'in_progress') {
      return res.status(409).json({
        success: false,
        errorType: 'sync_in_progress',
        message: data?.message || 'Sync already running for this cabin+channel',
        details: { cabinId: String(cabinId), channel: CHANNEL }
      });
    }

    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/airbnb-ical/configure', async (req, res) => {
  try {
    const { cabinId, feedUrl } = req.body || {};
    if (!cabinId || !feedUrl) {
      return res.status(400).json({ success: false, message: 'cabinId and feedUrl are required' });
    }
    const state = await CabinChannelSyncState.findOneAndUpdate(
      { cabinId, channel: 'airbnb_ical' },
      { $set: { feedUrl } },
      { new: true, upsert: true }
    );
    return res.json({
      success: true,
      data: {
        cabinId: String(state.cabinId),
        channel: state.channel,
        feedUrl: state.feedUrl
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
