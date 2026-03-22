const express = require('express');
const mongoose = require('mongoose');
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
    if (!mongoose.Types.ObjectId.isValid(String(cabinId))) {
      return res.status(400).json({ success: false, message: 'Invalid cabinId' });
    }
    const cabinOid = new mongoose.Types.ObjectId(String(cabinId));

    const overrideUrl = feedUrl != null && String(feedUrl).trim() !== '' ? String(feedUrl).trim() : null;
    let effectiveFeedUrl = overrideUrl;
    if (!effectiveFeedUrl) {
      const state = await CabinChannelSyncState.findOne({ cabinId: cabinOid, channel: CHANNEL }).lean();
      effectiveFeedUrl = state?.feedUrl && String(state.feedUrl).trim() !== '' ? String(state.feedUrl).trim() : null;
    }

    const data = await runManualIcalSync({ cabinId: String(cabinOid), feedUrl: effectiveFeedUrl, channel: CHANNEL });
    if (data?.status === 'in_progress') {
      return res.status(409).json({
        success: false,
        errorType: 'sync_in_progress',
        message: data?.message || 'Sync already running for this cabin+channel',
        details: { cabinId: String(cabinOid), channel: CHANNEL }
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
