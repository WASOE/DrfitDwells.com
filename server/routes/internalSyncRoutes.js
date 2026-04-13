const express = require('express');
const mongoose = require('mongoose');
const { adminAuth } = require('../middleware/adminAuth');
const { requireOpsAdminRole } = require('../middleware/requireOpsAdminRole');
const CabinChannelSyncState = require('../models/CabinChannelSyncState');
const { syncStateFilter } = require('../services/ops/ingestion/icalIngestionService');
const { runManualIcalSync, CHANNEL } = require('../services/ops/ingestion/icalSyncScheduler');

function parseUnitIdBody(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const s = String(raw).trim();
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
}
const { appendAuditEvent } = require('../services/auditWriter');

const router = express.Router();
router.use(adminAuth);
router.use(requireOpsAdminRole);

router.post('/airbnb-ical/run', async (req, res) => {
  try {
    const { cabinId, feedUrl, unitId: unitIdBody } = req.body || {};
    if (!cabinId) {
      return res.status(400).json({ success: false, message: 'cabinId is required' });
    }
    if (!mongoose.Types.ObjectId.isValid(String(cabinId))) {
      return res.status(400).json({ success: false, message: 'Invalid cabinId' });
    }
    const cabinOid = new mongoose.Types.ObjectId(String(cabinId));
    const unitOid = parseUnitIdBody(unitIdBody);

    const overrideUrl = feedUrl != null && String(feedUrl).trim() !== '' ? String(feedUrl).trim() : null;
    let effectiveFeedUrl = overrideUrl;
    if (!effectiveFeedUrl) {
      const state = await CabinChannelSyncState.findOne(syncStateFilter(cabinOid, CHANNEL, unitOid)).lean();
      effectiveFeedUrl = state?.feedUrl && String(state.feedUrl).trim() !== '' ? String(state.feedUrl).trim() : null;
    }

    const data = await runManualIcalSync({
      cabinId: String(cabinOid),
      feedUrl: effectiveFeedUrl,
      channel: CHANNEL,
      unitId: unitOid
    });
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
    const { cabinId, feedUrl, unitId: unitIdBody } = req.body || {};
    if (!cabinId || !feedUrl) {
      return res.status(400).json({ success: false, message: 'cabinId and feedUrl are required' });
    }
    const unitOid = parseUnitIdBody(unitIdBody);
    const filter = syncStateFilter(cabinId, 'airbnb_ical', unitOid);
    const before = await CabinChannelSyncState.findOne(filter).lean();
    try {
      await appendAuditEvent(
        {
          actorType: 'user',
          actorId: req.user?.id || 'admin',
          entityType: 'CabinChannelSyncState',
          entityId: `${String(cabinId)}:airbnb_ical:${unitOid ? String(unitOid) : 'default'}`,
          action: 'sync_feed_configure',
          beforeSnapshot: before ? { feedUrl: before.feedUrl, unitId: before.unitId || null } : null,
          afterSnapshot: { feedUrl: String(feedUrl).trim(), unitId: unitOid ? String(unitOid) : null },
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
      filter,
      { $set: { feedUrl: String(feedUrl).trim() } },
      { new: true, upsert: true }
    );
    return res.json({
      success: true,
      data: {
        cabinId: String(state.cabinId),
        channel: state.channel,
        feedUrl: state.feedUrl,
        unitId: state.unitId ? String(state.unitId) : null
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
