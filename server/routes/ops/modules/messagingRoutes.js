'use strict';

const express = require('express');
const { validateId } = require('../../../middleware/validateId');
const { requirePermission, ACTIONS } = require('../../../services/permissionService');
const {
  getMessagingSystemStateReadModel,
  getMessagingRulesWithTemplateReadiness,
  getDeliveryEventsForDispatch
} = require('../../../services/ops/readModels/guestMessageAutomationOpsReadModel');
const { cancelScheduledMessageJobFromOps } = require('../../../services/ops/domain/guestMessageAutomationOpsWriteService');

const router = express.Router();

router.get('/system-state', (req, res) => {
  try {
    requirePermission({ role: req.user?.role, action: ACTIONS.OPS_MESSAGING_READ });
    const data = getMessagingSystemStateReadModel();
    return res.json({ success: true, data });
  } catch (err) {
    if (err?.code === 'PERMISSION_DENIED') {
      return res.status(err.status || 403).json({ success: false, errorType: 'permission', message: err.message });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/rules', async (req, res) => {
  try {
    requirePermission({ role: req.user?.role, action: ACTIONS.OPS_MESSAGING_READ });
    const data = await getMessagingRulesWithTemplateReadiness();
    return res.json({ success: true, data });
  } catch (err) {
    if (err?.code === 'PERMISSION_DENIED') {
      return res.status(err.status || 403).json({ success: false, errorType: 'permission', message: err.message });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/dispatches/:dispatchId/delivery-events', validateId('dispatchId'), async (req, res) => {
  try {
    requirePermission({ role: req.user?.role, action: ACTIONS.OPS_MESSAGING_READ });
    const data = await getDeliveryEventsForDispatch(req.params.dispatchId);
    if (!data) {
      return res.status(400).json({ success: false, message: 'Invalid dispatch id' });
    }
    return res.json({ success: true, data });
  } catch (err) {
    if (err?.code === 'PERMISSION_DENIED') {
      return res.status(err.status || 403).json({ success: false, errorType: 'permission', message: err.message });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/jobs/:jobId/actions/cancel', express.json(), validateId('jobId'), async (req, res) => {
  try {
    const result = await cancelScheduledMessageJobFromOps({
      jobId: req.params.jobId,
      expectedBookingId: req.body?.bookingId || null,
      reason: req.body?.reason || null,
      ctx: {
        req,
        user: req.user,
        route: 'POST /api/ops/messaging/jobs/:jobId/actions/cancel'
      }
    });
    return res.json({
      success: true,
      data: {
        job: result.job,
        idempotent: result.idempotent
      }
    });
  } catch (err) {
    if (err?.code === 'PERMISSION_DENIED') {
      return res.status(err.status || 403).json({ success: false, errorType: 'permission', message: err.message });
    }
    if (err?.code === 'AUDIT_WRITE_FAILED') {
      return res.status(500).json({ success: false, errorType: 'audit_failure', message: err.message });
    }
    const status = err.status || 500;
    if (status >= 400 && status < 500) {
      return res.status(status).json({
        success: false,
        errorType: err.errorType || 'validation',
        message: err.message
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
