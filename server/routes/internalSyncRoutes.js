const express = require('express');
const mongoose = require('mongoose');
const { adminAuth } = require('../middleware/adminAuth');
const { requireOpsAdminRole } = require('../middleware/requireOpsAdminRole');
const CabinChannelSyncState = require('../models/CabinChannelSyncState');
const { runManualIcalSync, CHANNEL } = require('../services/ops/ingestion/icalSyncScheduler');
const { appendAuditEvent } = require('../services/auditWriter');

const router = express.Router();
router.use(adminAuth);
router.use(requireOpsAdminRole);

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

    try {
      await appendAuditEvent(
        {
          actorType: 'user',
          actorId: req.user?.id || 'admin',
          entityType: 'Cabin',
          entityId: String(cabinOid),
          action: 'sync_manual_run',
          beforeSnapshot: { feedUrlOverride: overrideUrl || null },
          afterSnapshot: { summary: data?.status || data?.outcome || data || null },
          reason: null,
          metadata: { channel: CHANNEL },
          sourceContext: { route: 'POST /api/internal/sync/airbnb-ical/run', namespace: 'maintenance' }
        },
        { req }
      );
    } catch (auditErr) {
      if (auditErr.code === 'AUDIT_WRITE_FAILED') {
        console.error('[internal-sync] audit failed after manual run', auditErr);
        return res.status(500).json({
          success: false,
          errorType: 'audit_after_sync',
          message: 'Sync ran but audit logging failed; check server logs',
          data
        });
      }
      throw auditErr;
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
    const before = await CabinChannelSyncState.findOne({ cabinId, channel: 'airbnb_ical' }).lean();
    try {
      await appendAuditEvent(
        {
          actorType: 'user',
          actorId: req.user?.id || 'admin',
          entityType: 'CabinChannelSyncState',
          entityId: `${String(cabinId)}:airbnb_ical`,
          action: 'sync_feed_configure',
          beforeSnapshot: before ? { feedUrl: before.feedUrl } : null,
          afterSnapshot: { feedUrl: String(feedUrl).trim() },
          reason: null,
          metadata: { channel: 'airbnb_ical' },
          sourceContext: { route: 'POST /api/internal/sync/airbnb-ical/configure', namespace: 'maintenance' }
        },
        { req }
      );
    } catch (auditErr) {
      if (auditErr.code === 'AUDIT_WRITE_FAILED') {
        return res.status(500).json({ success: false, message: 'Audit write failed; feed URL was not changed' });
      }
      throw auditErr;
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
