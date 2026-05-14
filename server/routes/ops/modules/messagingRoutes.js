'use strict';

const express = require('express');
const { validateId } = require('../../../middleware/validateId');
const { requirePermission, ACTIONS } = require('../../../services/permissionService');
const {
  getMessagingSystemStateReadModel,
  getMessagingRulesWithTemplateReadiness,
  getDeliveryEventsForDispatch
} = require('../../../services/ops/readModels/guestMessageAutomationOpsReadModel');

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

module.exports = router;
